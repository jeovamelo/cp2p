import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import {
  CryptoEngine,
  MessageModel,
  CommunityModel,
  UserRoles,
  AuditLogModel,
  LocalDatabase,
  GossipMesh,
  NotificationService
} from '@comunidade-resiliente/core';

export class DesktopNodeDaemon {
  constructor(options = {}) {
    this.name = options.name || 'Nó P2P';
    this.port = parseInt(options.port || '5001', 10);
    this.p2pPort = parseInt(options.p2pPort || '6001', 10);
    this.dataPath = options.dataPath || `./data/node_${this.port}.json`;
    this.bootstrapUrl = options.bootstrapUrl || 'ws://localhost:5000';
    this.initialRole = options.role || (this.port === 5001 ? UserRoles.ADMIN : UserRoles.MEMBER);

    this.db = new LocalDatabase(this.dataPath);
    this.notificationService = new NotificationService(this.db);
    this.identity = null;
    this.mesh = null;
    this.httpServer = null;
    this.clientWss = null;
    this.p2pWss = null;
    this.clientConnections = new Set();
  }

  async start() {
    this._initIdentity();
    this._initDefaultCommunity();
    this._initP2PListener();
    this._initGossipMesh();
    this._initHttpAndClientApi();

    return this;
  }

  _initIdentity() {
    let id = this.db.getDefaultIdentity();
    if (!id) {
      const generated = CryptoEngine.generateIdentity();
      id = {
        ...generated,
        displayName: this.name,
        role: this.initialRole
      };
      this.db.saveIdentity(id);
      console.log(`[${this.name}] Nova identidade criptográfica Ed25519 gerada: ${id.id}`);
    } else {
      console.log(`[${this.name}] Identidade existente carregada: ${id.displayName || id.id}`);
    }
    this.identity = id;
  }

  _initDefaultCommunity() {
    let community = this.db.getCommunity('comm_principal');
    if (!community) {
      // Se este nó for ADMIN ou o criador inicial, cria a comunidade padrão
      const adminKey = this.initialRole === UserRoles.ADMIN ? this.identity.publicKey :
        '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAComunidadeResilienteAdminMasterKey123456789\n-----END PUBLIC KEY-----';

      community = CommunityModel.create({
        id: 'comm_principal',
        name: 'Comunidade Resiliente Brasil',
        description: 'Canal oficial resiliente e descentralizado.',
        adminPublicKey: adminKey
      });

      // Se este nó for ADMIN, adiciona ele mesmo
      if (this.initialRole === UserRoles.ADMIN) {
        CommunityModel.addMember(community, {
          publicKey: this.identity.publicKey,
          role: UserRoles.ADMIN,
          displayName: this.name
        });
      } else {
        CommunityModel.addMember(community, {
          publicKey: this.identity.publicKey,
          role: this.initialRole,
          displayName: this.name
        });
      }

      this.db.saveCommunity(community);
    }
  }

  _initP2PListener() {
    // Servidor WebSocket P2P direto onde OUTROS nós de computadores pessoais podem se conectar
    this.p2pWss = new WebSocketServer({ port: this.p2pPort });

    this.p2pWss.on('connection', (ws, req) => {
      const remoteIp = req.socket.remoteAddress;
      const tempId = `incoming_${Math.random().toString(36).slice(2, 7)}`;

      ws.once('message', (raw) => {
        try {
          const packet = JSON.parse(raw.toString());
          if (packet.type === 'HANDSHAKE' && packet.nodeId) {
            this.mesh.addPeerConnection(packet.nodeId, ws, {
              role: packet.role,
              address: `ws://${remoteIp}:${packet.p2pPort || 0}`,
              isBootstrap: false
            });
          }
        } catch {}
      });
    });

    console.log(`[${this.name}] Ouvinte P2P direto ATIVO na porta ${this.p2pPort}`);
  }

  _initGossipMesh() {
    this.mesh = new GossipMesh({
      nodeId: this.identity.id,
      displayName: this.name,
      role: this.identity.role || this.initialRole,
      publicKey: this.identity.publicKey,
      privateKey: this.identity.privateKey,
      db: this.db,
      p2pPort: this.p2pPort,
      bootstrapNodes: [this.bootstrapUrl],
      onMessageReceived: (message, meta) => {
        // Dispara notificação com preservação de privacidade
        const notif = this.notificationService.dispatchForMessage(message, 'Comunidade Resiliente');

        // Notifica clientes web via WebSocket local
        this._notifyClients({
          type: 'NEW_MESSAGE',
          message: this._decryptMessageForClient(message),
          meta
        });

        this._notifyClients({
          type: 'NOTIFICATION_ALERT',
          notification: notif
        });
      },
      onPeerStatusChange: (networkState) => {
        this._notifyClients({
          type: 'NETWORK_UPDATE',
          network: networkState
        });
      },
      onLeaderElected: (leaderInfo) => {
        console.log(`\n👑 [${this.name}] NOVO LÍDER DA MALHA ELEITO: ${leaderInfo.leaderId} (Este nó é o líder: ${leaderInfo.isSelf})\n`);

        this.db.saveAuditLog(AuditLogModel.create({
          communityId: 'comm_principal',
          event: 'LEADER_ELECTED',
          actorPublicKey: this.identity.publicKey,
          details: leaderInfo
        }));

        this._notifyClients({
          type: 'LEADER_ELECTED',
          leader: leaderInfo
        });
      }
    });

    // Inicia conexão com a VPS Bootstrap
    if (this.bootstrapUrl) {
      console.log(`[${this.name}] Conectando ao ponto de bootstrap: ${this.bootstrapUrl}`);
      this.mesh.connectToAddress(this.bootstrapUrl, true);
    }

    // Inicia batimentos cardíacos
    this.mesh.startHeartbeats(3000);
  }

  _initHttpAndClientApi() {
    this.httpServer = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      // Roteador de API
      if (url.pathname === '/api/status') {
        const net = this.mesh.getNetworkState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          nodeId: this.identity.id,
          name: this.name,
          role: this.identity.role || this.initialRole,
          publicKey: this.identity.publicKey,
          p2pPort: this.p2pPort,
          apiPort: this.port,
          network: net,
          communities: this.db.getAllCommunities().length
        }));
        return;
      }

      if (url.pathname === '/api/communities' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.db.getAllCommunities()));
        return;
      }

      // Buscar mensagens de uma comunidade
      const msgMatch = url.pathname.match(/^\/api\/communities\/([^/]+)\/messages$/);
      if (msgMatch && req.method === 'GET') {
        const commId = msgMatch[1];
        const messages = this.db.getMessagesByCommunity(commId);
        const decrypted = messages.map(m => this._decryptMessageForClient(m));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(decrypted));
        return;
      }

      // Publicar nova mensagem (Apenas Administrador)
      if (msgMatch && req.method === 'POST') {
        const commId = msgMatch[1];
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const community = this.db.getCommunity(commId);
            if (!community) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Comunidade não encontrada' }));
              return;
            }

            // Verifica se este nó possui permissão de Administrador
            const userRole = this.identity.role || this.initialRole;
            if (userRole !== UserRoles.ADMIN) {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: 'Acesso negado: Somente o Administrador possui a chave autorizada para publicar mensagens neste canal.'
              }));
              return;
            }

            const currentKey = CommunityModel.getEpochKey(community, community.currentEpoch);
            const stateVec = this.db.getCommunityStateVector(commId);
            const lastMsg = this.db.getMessagesByCommunity(commId).slice(-1)[0];
            const previousHash = lastMsg ? lastMsg.hash : '0000000000000000000000000000000000000000000000000000000000000000';

            const newMsg = MessageModel.create({
              communityId: commId,
              sequence: stateVec.maxSequence + 1,
              previousHash,
              content: data.text || '',
              attachments: data.attachments || [],
              authorPublicKey: this.identity.publicKey,
              authorPrivateKey: this.identity.privateKey,
              communityKeyHex: currentKey,
              epoch: community.currentEpoch
            });

            // Publica na malha P2P
            this.mesh.publishMessage(newMsg);

            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(this._decryptMessageForClient(newMsg)));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // Gerenciamento de Membros e Revogação
      const revokeMatch = url.pathname.match(/^\/api\/communities\/([^/]+)\/revoke$/);
      if (revokeMatch && req.method === 'POST') {
        const commId = revokeMatch[1];
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const community = this.db.getCommunity(commId);
            if (!community) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Comunidade não encontrada' }));
              return;
            }

            const result = CommunityModel.revokeMember(community, data.publicKey);
            this.db.saveCommunity(community);

            this.db.saveAuditLog(AuditLogModel.create({
              communityId: commId,
              event: 'MEMBER_REVOKED',
              actorPublicKey: this.identity.publicKey,
              actorPrivateKey: this.identity.privateKey,
              target: data.publicKey,
              details: { newEpoch: result.newEpoch }
            }));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              message: 'Membro revogado com sucesso e chave comunitária rotacionada!',
              result
            }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // Conexão manual a outro nó P2P
      if (url.pathname === '/api/connect-peer' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { address } = JSON.parse(body || '{}');
            if (!address) throw new Error('Endereço do nó ausente');
            this.mesh.connectToAddress(address, false);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: `Tentando conectar ao par ${address}...` }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // Simulação de desligamento da VPS principal
      if (url.pathname === '/api/simulate-vps-kill' && req.method === 'POST') {
        // Envia requisição HTTP POST para o endpoint /api/kill da VPS se estiver rodando localmente
        const vpsKillReq = http.request(
          {
            hostname: 'localhost',
            port: 5000,
            path: '/api/kill',
            method: 'POST'
          },
          (killRes) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              message: 'Sinal de desligamento da VPS enviado com sucesso! A malha P2P continuará funcionando de forma autônoma.'
            }));
          }
        );

        vpsKillReq.on('error', () => {
          // Se não conseguir conectar na VPS diretamente, força desconexão local do socket
          for (const [id, peer] of this.mesh.peers.entries()) {
            if (peer.isBootstrap) {
              try { peer.ws.close(); } catch {}
            }
          }
          this.mesh._handleVpsFailure();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            message: 'VPS já estava inacessível ou desconectada. Modo de sobrevivência ativado.'
          }));
        });

        vpsKillReq.end();
        return;
      }

      // Logs de Auditoria
      if (url.pathname === '/api/audit' && req.method === 'GET') {
        const logs = this.db.getAuditLogs();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(logs));
        return;
      }

      // Notificações pendentes
      if (url.pathname === '/api/notifications' && req.method === 'GET') {
        const notifs = this.db.getPendingNotifications();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(notifs));
        return;
      }

      // Exportação de Backup
      if (url.pathname === '/api/backup' && req.method === 'GET') {
        const backupData = {
          exportedAt: Date.now(),
          nodeId: this.identity.id,
          communities: this.db.getAllCommunities(),
          messages: this.db.getMessagesByCommunity('comm_principal'),
          audit: this.db.getAuditLogs()
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(backupData, null, 2));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint não encontrado' }));
    });

    // WebSocket Server para clientes locais (interface Web/PWA)
    this.clientWss = new WebSocketServer({ server: this.httpServer });
    this.clientWss.on('connection', (ws) => {
      this.clientConnections.add(ws);

      // Envia estado inicial da rede e do nó
      ws.send(JSON.stringify({
        type: 'INITIAL_STATE',
        node: {
          nodeId: this.identity.id,
          name: this.name,
          role: this.identity.role || this.initialRole,
          publicKey: this.identity.publicKey
        },
        network: this.mesh.getNetworkState()
      }));

      ws.on('close', () => this.clientConnections.delete(ws));
      ws.on('error', () => this.clientConnections.delete(ws));
    });

    this.httpServer.listen(this.port, () => {
      console.log(`[${this.name}] API HTTP e WebSocket do Cliente ATIVA em http://localhost:${this.port}`);
    });
  }

  _decryptMessageForClient(message) {
    try {
      const community = this.db.getCommunity(message.communityId);
      const key = CommunityModel.getEpochKey(community, message.epoch);
      const decrypted = MessageModel.decryptContent(message, key);
      return {
        ...message,
        content: decrypted.text,
        attachments: decrypted.attachments || [],
        isDecrypted: true
      };
    } catch (err) {
      return {
        ...message,
        content: '[Mensagem Criptografada - Chave Não Disponível]',
        isDecrypted: false
      };
    }
  }

  _notifyClients(event) {
    const data = JSON.stringify(event);
    for (const ws of this.clientConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(data); } catch {}
      }
    }
  }

  stop() {
    if (this.mesh) this.mesh.destroy();
    if (this.p2pWss) this.p2pWss.close();
    if (this.clientWss) this.clientWss.close();
    if (this.httpServer) this.httpServer.close();
    this.db.close();
    console.log(`[${this.name}] Nó finalizado com sucesso.`);
  }
}

// Se executado via CLI
if (process.argv[1] && process.argv[1].endsWith('daemon.js')) {
  const args = process.argv.slice(2);
  const getArg = (flag, def) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
  };

  const name = getArg('--name', 'Nó P2P Local');
  const port = getArg('--port', '5001');
  const p2pPort = getArg('--p2p-port', '6001');
  const dataPath = getArg('--data', `./data/node_${port}.json`);
  const bootstrapUrl = getArg('--bootstrap', 'ws://localhost:5000');
  const role = getArg('--role', port === '5001' ? UserRoles.ADMIN : UserRoles.MEMBER);

  const daemon = new DesktopNodeDaemon({
    name,
    port,
    p2pPort,
    dataPath,
    bootstrapUrl,
    role
  });

  daemon.start().then(() => {
    console.log(`🚀 Nó P2P iniciado com sucesso! Role: ${role} | HTTP: ${port} | P2P: ${p2pPort}`);
  });

  process.on('SIGINT', () => daemon.stop());
  process.on('SIGTERM', () => daemon.stop());
}
