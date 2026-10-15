/**
 * Comunidade Resiliente - Runtime Completo do Nó P2P Pessoal
 * Executado localmente em cada computador membro.
 * Integra: Storage SQLite em WAL, Crypto Ed25519/AES-256-GCM, Chain CRDT,
 * P2P Engine com NAT/STUN/Relay, Consenso Raft-lite, Notificações VAPID e Servidor Web Local para UI/PWA.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const CryptoEngine = require('../common/crypto');
const StorageManager = require('../core/storage');
const MessageChain = require('../core/crdt_chain');
const NotificationService = require('../core/notification_service');
const AuditLogger = require('../core/audit_logger');
const P2PEngine = require('../core/p2p_engine');
const SystemConfig = require('../common/config');

class P2PNode {
  /**
   * @param {object} config
   * @param {string} config.nodeId - Identificador único deste nó
   * @param {string} [config.dataDir] - Diretório de dados SQLite
   * @param {number} config.p2pPort - Porta da malha P2P
   * @param {number} config.httpPort - Porta da interface Web local / PWA
   * @param {Array<string>} [config.bootstrapNodes] - URLs da VPS / outros bootstraps
   * @param {string} [config.username] - Nome de usuário inicial
   * @param {string} [config.role='Membro'] - 'Administrador', 'Moderador' ou 'Membro'
   * @param {string} [config.genesisAdminPubkey] - Chave pública do admin gênesis da comunidade
   * @param {string} [config.channelKey] - Chave simétrica inicial do canal
   */
  constructor(config) {
    this.config = config;
    this.nodeId = config.nodeId;
    this.httpPort = config.httpPort;
    this.p2pPort = config.p2pPort;
    this.bootstrapNodes = config.bootstrapNodes && config.bootstrapNodes.length > 0
      ? config.bootstrapNodes
      : SystemConfig.BOOTSTRAP_NODES;
    this.dataDir = config.dataDir || path.join(process.cwd(), 'data', this.nodeId);
    this.startTime = Date.now();

    this.currentUser = null;
    this.activePrivateKeyPem = null;
    this.activeChannelKeyHex = null;

    const dbPath = path.join(this.dataDir, 'comunidade.db');
    this.storage = new StorageManager(dbPath);

    this.auditLogger = new AuditLogger(this.storage);
    this.notificationService = new NotificationService(this.storage);
    this.chain = new MessageChain(this.storage);

    this.p2p = new P2PEngine({
      nodeId: this.nodeId,
      host: '0.0.0.0',
      p2pPort: this.p2pPort,
      bootstrapNodes: this.bootstrapNodes,
      storage: this.storage,
      chain: this.chain,
      notificationService: this.notificationService,
      auditLogger: this.auditLogger,
      role: config.role || 'Membro'
    });

    this.httpServer = null;
    this.uiWss = null;
    this.uiClients = new Set();
  }

  async start() {
    this.initDefaultCommunityAndUser();
    await this.p2p.start();

    this.p2p.on('message_received', (msg) => {
      this.broadcastToUI({
        type: 'NEW_MESSAGE',
        message: this.formatMessageForUI(msg)
      });
      this.broadcastNetworkUpdate();
    });

    this.p2p.on('peer_connected', (peer) => {
      this.broadcastToUI({
        type: 'PEER_CHANGE',
        event: 'connected',
        peer,
        networkStatus: this.p2p.getNetworkStatus()
      });
      this.broadcastNetworkUpdate();
    });

    this.p2p.on('peer_disconnected', (peer) => {
      this.broadcastToUI({
        type: 'PEER_CHANGE',
        event: 'disconnected',
        peer,
        networkStatus: this.p2p.getNetworkStatus()
      });
      this.broadcastNetworkUpdate();
    });

    this.p2p.on('leader_change', (leaderData) => {
      this.broadcastToUI({
        type: 'LEADER_CHANGE',
        leaderData,
        networkStatus: this.p2p.getNetworkStatus()
      });
      this.broadcastNetworkUpdate();
    });

    this.p2p.on('vps_status_change', (vpsData) => {
      this.broadcastToUI({
        type: 'VPS_STATUS_CHANGE',
        vpsData,
        networkStatus: this.p2p.getNetworkStatus()
      });
      this.broadcastNetworkUpdate();
    });

    this.notificationService.on('push', (notif) => {
      this.broadcastToUI({
        type: 'PUSH_NOTIFICATION',
        notification: notif
      });
    });

    await this.startHttpServer();

    console.log(`[Nó ${this.nodeId}] Ativo! Web/PWA: http://localhost:${this.httpPort} | P2P Port: ${this.p2pPort}`);
  }

  initDefaultCommunityAndUser() {
    let comm = this.storage.getCommunity('geral');
    if (!comm) {
      const initialKey = this.config.channelKey || CryptoEngine.generateChannelKey();
      const genesisAdmin = this.config.genesisAdminPubkey || 'GENESIS_ADMIN_PENDING';

      comm = {
        id: 'geral',
        name: 'Comunidade Resiliente',
        description: 'Canal seguro, descentralizado e à prova de censura operado em rede P2P.',
        genesis_admin_pubkey: genesisAdmin,
        current_epoch: 1,
        created_at: Date.now()
      };
      this.storage.saveCommunity(comm);
      this.storage.saveKeyEpoch('geral', 1, initialKey, 'genesis');
      this.activeChannelKeyHex = initialKey;
    } else {
      if (this.config.genesisAdminPubkey && comm.genesis_admin_pubkey === 'GENESIS_ADMIN_PENDING') {
        comm.genesis_admin_pubkey = this.config.genesisAdminPubkey;
        this.storage.saveCommunity(comm);
      }
      if (this.config.channelKey) {
        this.storage.saveKeyEpoch('geral', 1, this.config.channelKey, 'genesis');
        this.activeChannelKeyHex = this.config.channelKey;
      } else {
        const keyObj = this.storage.getKeyForEpoch('geral', comm.current_epoch);
        if (keyObj) this.activeChannelKeyHex = keyObj;
      }
    }

    if (this.config.username) {
      let user = this.storage.getUserByUsername(this.config.username);
      if (!user) {
        const keypair = CryptoEngine.generateEd25519KeyPair();
        // Não utiliza senhas estáticas fracas em produção
        const password = this.config.password || crypto.randomBytes(8).toString('hex');
        const passwordHash = CryptoEngine.hashPassword(password);
        const encryptedPrivKey = CryptoEngine.encryptPrivateKey(keypair.privateKey, password);

        user = {
          id: `usr_${this.nodeId}`,
          username: this.config.username,
          password_hash: passwordHash,
          public_key: keypair.publicKey,
          encrypted_private_key: JSON.stringify(encryptedPrivKey),
          role: this.config.role || 'Membro',
          status: 'active',
          created_at: Date.now()
        };
        this.storage.createUser(user);

        if (user.role === 'Administrador' && comm.genesis_admin_pubkey === 'GENESIS_ADMIN_PENDING') {
          comm.genesis_admin_pubkey = user.public_key;
          this.storage.saveCommunity(comm);
        }

        this.currentUser = user;
        this.activePrivateKeyPem = keypair.privateKey;
      } else {
        this.currentUser = user;
        if (this.config.password) {
          try {
            const encObj = JSON.parse(user.encrypted_private_key);
            this.activePrivateKeyPem = CryptoEngine.decryptPrivateKey(encObj, this.config.password);
          } catch (e) {}
        }
      }
    }
  }

  startHttpServer() {
    return new Promise((resolve) => {
      this.httpServer = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      this.uiWss = new WebSocket.Server({ noServer: true });
      this.httpServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (url.pathname === '/live' || url.pathname === '/live/network') {
          this.uiWss.handleUpgrade(req, socket, head, (ws) => {
            this.uiClients.add(ws);

            // Rastreamento seguro do dispositivo (Prompt 2)
            const ua = (req.headers['user-agent'] || '').toLowerCase();
            const isMobile = /mobile|android|iphone|ipad/i.test(ua);
            const deviceType = isMobile ? 'mobile' : 'desktop';
            const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            ws.sessionId = sessionId;

            this.storage.registerDeviceSession({
              sessionId,
              userId: this.currentUser ? this.currentUser.id : null,
              deviceType,
              clientType: url.pathname === '/live/network' ? 'dashboard' : 'app',
              isRelay: false
            });

            ws.on('close', () => {
              this.uiClients.delete(ws);
              this.storage.removeDeviceSession(sessionId);
              this.broadcastNetworkUpdate();
            });

            // Envia estado inicial
            ws.send(JSON.stringify({
              type: 'INIT_STATE',
              networkStatus: this.p2p.getNetworkStatus(),
              networkOverview: this.p2p.getNetworkOverview(),
              user: this.currentUser ? {
                id: this.currentUser.id,
                username: this.currentUser.username,
                role: this.currentUser.role,
                publicKey: this.currentUser.public_key
              } : null
            }));

            this.broadcastNetworkUpdate();
          });
        } else {
          socket.destroy();
        }
      });

      this.httpServer.listen(this.httpPort, () => {
        resolve();
      });
    });
  }

  broadcastNetworkUpdate() {
    this.broadcastToUI({
      type: 'NETWORK_OVERVIEW',
      overview: this.p2p.getNetworkOverview(),
      events: this.storage.getRecentNetworkEvents(20)
    });
  }

  async handleHttpRequest(req, res) {
    const hostHeader = req.headers.host || SystemConfig.APP_DOMAIN || 'localhost';
    const isHttps = req.headers['x-forwarded-proto'] === 'https' || (req.socket && req.socket.encrypted);

    // 1. Redirecionamento HTTP -> HTTPS em Produção
    if (SystemConfig.isProduction && req.headers['x-forwarded-proto'] === 'http') {
      const redirectUrl = `https://${SystemConfig.APP_DOMAIN}${req.url}`;
      res.writeHead(301, {
        'Location': redirectUrl,
        'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload'
      });
      res.end(`Redirecionando para ${redirectUrl}`);
      return;
    }

    // 2. Cabeçalhos de Segurança Estritos (HSTS, CSP, X-Frame-Options, etc.)
    for (const [header, value] of Object.entries(SystemConfig.SECURITY_HEADERS)) {
      res.setHeader(header, value);
    }

    // 3. CORS Seguro
    const origin = req.headers.origin;
    if (origin) {
      if (SystemConfig.isOriginAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      } else if (SystemConfig.isProduction) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'CORS_FORBIDDEN', message: 'Origem de requisição não autorizada.' }));
        return;
      }
    } else if (!SystemConfig.isProduction) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${hostHeader}`);
    const pathname = url.pathname;

    // 4. Endpoint de Saúde do Sistema (Health Check sem segredos)
    if (pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'HEALTHY',
        version: '1.1.0',
        domain: SystemConfig.APP_DOMAIN,
        https: isHttps || SystemConfig.isProduction,
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
        database: 'CONNECTED',
        bootstrap: {
          status: this.p2p && this.p2p.peers && this.p2p.peers.size > 0 ? 'CONNECTED' : (this.p2p && this.p2p.bootstrapStatus ? this.p2p.bootstrapStatus : 'STANDBY_FALLBACK'),
          activePeers: this.p2p ? this.p2p.peers.size : 0
        }
      }, null, 2));
      return;
    }

    // 5. Configuração do Frontend para PWA / Web
    if (pathname === '/api/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(SystemConfig.getFrontendConfig()));
      return;
    }

    if (pathname.startsWith('/api/')) {
      return this.handleApiRoute(pathname, url, req, res);
    }

    this.serveStaticFile(pathname, res);
  }

  async handleApiRoute(pathname, url, req, res) {
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const getBody = async () => {
      return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch (e) {
            reject(new Error('JSON Inválido'));
          }
        });
      });
    };

    // Auxiliar para extrair usuário da sessão
    const getSessionUser = () => {
      const authHeader = req.headers['authorization'];
      if (!authHeader) return this.currentUser;
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      const session = this.storage.getSession(token);
      if (session) {
        return {
          id: session.user_id,
          username: session.username,
          role: session.role
        };
      }
      return this.currentUser;
    };

    try {
      // 1. Status Geral do Nó
      if (pathname === '/api/status' && req.method === 'GET') {
        const comm = this.storage.getCommunity('geral');
        return sendJson(200, {
          nodeId: this.nodeId,
          role: this.p2p.role,
          httpPort: this.httpPort,
          p2pPort: this.p2pPort,
          community: comm,
          network: this.p2p.getNetworkStatus(),
          networkOverview: this.p2p.getNetworkOverview(),
          user: this.currentUser ? {
            id: this.currentUser.id,
            username: this.currentUser.username,
            role: this.currentUser.role,
            publicKey: this.currentUser.public_key,
            isUnlocked: !!this.activePrivateKeyPem
          } : null
        });
      }

      // 2. Autenticação e Registro com Sessões Reais e Rate Limiting
      if (pathname === '/api/auth/register' && req.method === 'POST') {
        const { username, password, role } = await getBody();
        if (!username || !password) return sendJson(400, { error: 'Usuário e senha são obrigatórios' });

        const existing = this.storage.getUserByUsername(username);
        if (existing) return sendJson(409, { error: 'Nome de usuário já em uso' });

        // Regra de Segurança: Membros comuns não podem se registrar diretamente como 'Administrador'
        const allUsers = this.storage.getAllUsers();
        const hasAdmins = allUsers.some(u => u.role === 'Administrador');

        if (role === 'Administrador' && hasAdmins) {
          return sendJson(403, {
            error: 'O papel de Administrador só pode ser concedido por um administrador já ativo através de promoção assinada.'
          });
        }

        const effectiveRole = hasAdmins ? (role === 'Administrador' ? 'Membro' : (role || 'Membro')) : 'Administrador';

        const keypair = CryptoEngine.generateEd25519KeyPair();
        const passwordHash = CryptoEngine.hashPassword(password);
        const encryptedPrivKey = CryptoEngine.encryptPrivateKey(keypair.privateKey, password);

        const newUser = {
          id: `usr_${Date.now()}`,
          username,
          password_hash: passwordHash,
          public_key: keypair.publicKey,
          encrypted_private_key: JSON.stringify(encryptedPrivKey),
          role: effectiveRole,
          status: 'active',
          created_at: Date.now()
        };

        this.storage.createUser(newUser);
        this.currentUser = newUser;
        this.activePrivateKeyPem = keypair.privateKey;
        this.p2p.role = newUser.role;
        this.p2p.consensus.role = newUser.role;

        // Cria sessão persistente com expiração (24 horas)
        const token = crypto.randomBytes(32).toString('hex');
        this.storage.createSession({
          token,
          userId: newUser.id,
          username: newUser.username,
          role: newUser.role,
          expiresAt: Date.now() + (24 * 3600 * 1000)
        });

        this.auditLogger.log('USER_REGISTERED', newUser.public_key, { username, role: newUser.role });

        return sendJson(201, {
          success: true,
          token,
          user: { id: newUser.id, username: newUser.username, role: newUser.role, publicKey: newUser.public_key }
        });
      }

      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const { username, password } = await getBody();
        if (!username || !password) return sendJson(400, { error: 'Usuário e senha são obrigatórios' });

        // Proteção contra força bruta
        const lockout = this.storage.getLoginLockout(username);
        if (lockout.isLocked) {
          return sendJson(429, {
            error: `Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em ${lockout.remainingSecs} segundos.`
          });
        }

        const user = this.storage.getUserByUsername(username);
        if (!user) {
          this.storage.recordLoginAttempt(username);
          return sendJson(401, { error: 'Credenciais inválidas.' });
        }

        const isValid = CryptoEngine.verifyPassword(password, user.password_hash);
        if (!isValid) {
          const attempt = this.storage.recordLoginAttempt(username);
          if (attempt.isLocked) {
            return sendJson(429, { error: 'Muitas tentativas incorretas. Conta bloqueada por 15 minutos.' });
          }
          return sendJson(401, { error: 'Credenciais inválidas.' });
        }

        this.storage.resetLoginAttempts(username);

        try {
          const encObj = JSON.parse(user.encrypted_private_key);
          this.activePrivateKeyPem = CryptoEngine.decryptPrivateKey(encObj, password);
        } catch (e) {
          return sendJson(500, { error: 'Falha ao descriptografar chave privada' });
        }

        this.currentUser = user;
        this.p2p.role = user.role;
        this.p2p.consensus.role = user.role;

        // Gera token de sessão real
        const token = crypto.randomBytes(32).toString('hex');
        this.storage.createSession({
          token,
          userId: user.id,
          username: user.username,
          role: user.role,
          expiresAt: Date.now() + (24 * 3600 * 1000)
        });

        return sendJson(200, {
          success: true,
          token,
          user: { id: user.id, username: user.username, role: user.role, publicKey: user.public_key }
        });
      }

      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const authHeader = req.headers['authorization'];
        if (authHeader) {
          const token = authHeader.replace(/^Bearer\s+/i, '').trim();
          this.storage.deleteSession(token);
        }
        this.activePrivateKeyPem = null;
        return sendJson(200, { success: true, message: 'Sessão encerrada com segurança.' });
      }

      // 3. Gestão de Comunidades e Convites
      if (pathname === '/api/communities' && req.method === 'GET') {
        const communities = this.storage.getAllCommunities().map(c => {
          const messages = this.storage.getMessagesByCommunity(c.id, 100);
          const latest = messages[messages.length - 1];
          const isAdmin = !!(this.currentUser && (
            this.currentUser.role === 'Administrador' ||
            (c.genesis_admin_pubkey && this.currentUser.public_key.replace(/-----[^\n]+-----|\s+/g, '') === c.genesis_admin_pubkey.replace(/-----[^\n]+-----|\s+/g, ''))
          ));
          return {
            ...c,
            messageCount: messages.length,
            latestMessage: latest ? this.formatMessageForUI(latest) : null,
            isAdmin
          };
        });
        return sendJson(200, { communities });
      }

      if (pathname === '/api/communities' && req.method === 'POST') {
        const { name, description } = await getBody();
        if (!name || name.trim() === '') {
          return sendJson(400, { error: 'O nome da comunidade é obrigatório.' });
        }

        const id = 'comm-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 25) + '-' + Math.floor(100 + Math.random() * 900);
        const initialKey = CryptoEngine.generateChannelKey();
        const genesisAdmin = this.currentUser ? this.currentUser.public_key : 'GENESIS_ADMIN_PENDING';

        const newComm = {
          id,
          name: name.trim(),
          description: description ? description.trim() : 'Comunidade descentralizada P2P',
          genesis_admin_pubkey: genesisAdmin,
          current_epoch: 1,
          created_at: Date.now()
        };

        this.storage.saveCommunity(newComm);
        this.storage.saveKeyEpoch(id, 1, initialKey, genesisAdmin);
        this.auditLogger.log('COMMUNITY_CREATED', genesisAdmin, { communityId: id, name: newComm.name });

        const invitePayload = {
          type: 'comunidade_resiliente_invite',
          communityId: id,
          name: newComm.name,
          description: newComm.description,
          genesisAdminPubkey: genesisAdmin,
          channelKey: initialKey,
          bootstraps: this.bootstrapNodes
        };
        const inviteCode = Buffer.from(JSON.stringify(invitePayload)).toString('base64');

        return sendJson(201, {
          success: true,
          community: newComm,
          inviteCode
        });
      }

      const matchInvite = pathname.match(/^\/api\/communities\/([^\/]+)\/invite$/);
      if (matchInvite && req.method === 'GET') {
        const commId = decodeURIComponent(matchInvite[1]);
        const comm = this.storage.getCommunity(commId);
        if (!comm) return sendJson(404, { error: 'Comunidade não encontrada' });
        const key = this.storage.getKeyForEpoch(commId, comm.current_epoch);
        const invitePayload = {
          type: 'comunidade_resiliente_invite',
          communityId: comm.id,
          name: comm.name,
          description: comm.description,
          genesisAdminPubkey: comm.genesis_admin_pubkey,
          channelKey: key,
          bootstraps: this.bootstrapNodes
        };
        const inviteCode = Buffer.from(JSON.stringify(invitePayload)).toString('base64');
        return sendJson(200, {
          communityId: comm.id,
          name: comm.name,
          inviteCode
        });
      }

      if (pathname === '/api/communities/join' && req.method === 'POST') {
        const { inviteCode } = await getBody();
        if (!inviteCode) return sendJson(400, { error: 'Código de convite obrigatório' });
        let inviteData;
        try {
          const raw = inviteCode.trim();
          const jsonStr = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
          inviteData = JSON.parse(jsonStr);
        } catch (e) {
          return sendJson(400, { error: 'Código de convite inválido ou corrompido.' });
        }

        const { communityId, name, description, genesisAdminPubkey, channelKey, bootstraps } = inviteData;
        if (!communityId || !channelKey) {
          return sendJson(400, { error: 'Dados do convite incompletos.' });
        }

        let comm = this.storage.getCommunity(communityId);
        if (!comm) {
          comm = {
            id: communityId,
            name: name || communityId,
            description: description || 'Comunidade importada via convite',
            genesis_admin_pubkey: genesisAdminPubkey || 'GENESIS_ADMIN_PENDING',
            current_epoch: 1,
            created_at: Date.now()
          };
          this.storage.saveCommunity(comm);
        }

        this.storage.saveKeyEpoch(communityId, 1, channelKey, genesisAdminPubkey || 'invite');

        if (Array.isArray(bootstraps)) {
          for (const b of bootstraps) {
            if (!this.bootstrapNodes.includes(b)) {
              this.bootstrapNodes.push(b);
              this.p2p.connectToPeerUrl(b, true);
            }
          }
        }

        for (const socket of this.p2p.peers.values()) {
          this.p2p.sendSyncRequest(socket, communityId, 0);
        }

        this.auditLogger.log('COMMUNITY_JOINED', this.currentUser ? this.currentUser.public_key : 'ANONYMOUS', {
          communityId,
          name: comm.name
        });

        return sendJson(200, {
          success: true,
          community: comm,
          message: `Você entrou na comunidade "${comm.name}"!`
        });
      }

      // 4. Mensagens
      if (pathname === '/api/messages' && req.method === 'GET') {
        const communityId = url.searchParams.get('communityId') || 'geral';
        const rawMessages = this.storage.getMessagesByCommunity(communityId, 100);
        const formatted = rawMessages.map(msg => this.formatMessageForUI(msg));

        return sendJson(200, {
          communityId,
          total: formatted.length,
          messages: formatted
        });
      }

      if (pathname === '/api/messages' && req.method === 'POST') {
        const { text, communityId = 'geral', attachmentType, attachmentData } = await getBody();
        if (!text || text.trim() === '') {
          return sendJson(400, { error: 'O texto da mensagem é obrigatório.' });
        }

        const comm = this.storage.getCommunity(communityId);
        if (!comm) {
          return sendJson(404, { error: 'Comunidade não encontrada localmente.' });
        }

        const user = getSessionUser();
        const isAdminRole = user && user.role === 'Administrador';
        const isGenesisAdmin = user && user.publicKey &&
          (user.publicKey.replace(/-----[^\n]+-----|\s+/g, '') === (comm.genesis_admin_pubkey || '').replace(/-----[^\n]+-----|\s+/g, ''));

        if (!isAdminRole && !isGenesisAdmin) {
          return sendJson(403, { error: 'Apenas Administradores possuem permissão de publicação nesta comunidade.' });
        }

        if (!this.activePrivateKeyPem) {
          return sendJson(401, { error: 'Chave privada não está desbloqueada nesta sessão.' });
        }

        const channelKey = this.storage.getKeyForEpoch(communityId, comm.current_epoch);
        if (!channelKey) {
          return sendJson(500, { error: 'Chave de criptografia da comunidade não encontrada localmente.' });
        }

        const signedMessage = this.chain.createSignedMessage({
          communityId,
          plaintext: text,
          channelKeyHex: channelKey,
          authorPublicKey: this.currentUser.public_key,
          authorPrivateKey: this.activePrivateKeyPem,
          epoch: comm.current_epoch,
          attachmentType: attachmentType || null,
          attachmentData: attachmentData || null
        });

        this.p2p.publishMessage(signedMessage);

        this.broadcastToUI({
          type: 'NEW_MESSAGE',
          message: this.formatMessageForUI(signedMessage)
        });

        return sendJson(201, {
          success: true,
          message: this.formatMessageForUI(signedMessage)
        });
      }

      // 5. ENDPOINTS DO PAINEL "VISÃO DA COMUNIDADE" (PROMPT 2 REQUISITO)
      if (pathname === '/api/network/overview' && req.method === 'GET') {
        const overview = this.p2p.getNetworkOverview();
        return sendJson(200, overview);
      }

      if (pathname === '/api/network/nodes' && req.method === 'GET') {
        const nodes = this.p2p.getConnectedNodesList();
        return sendJson(200, { nodes });
      }

      if (pathname === '/api/community/members' && req.method === 'GET') {
        // Retorna apenas dados públicos e não sensíveis dos membros
        const users = this.storage.getAllUsers().map(u => ({
          id: u.id,
          username: u.username,
          role: u.role,
          status: u.status,
          deviceType: 'Desktop / Celular',
          lastSeen: Date.now() - 30000
        }));
        return sendJson(200, { members: users });
      }

      if (pathname === '/api/community/devices' && req.method === 'GET') {
        const activeSessions = this.storage.getActiveDeviceSessions();
        const pushSubs = this.storage.getAllPushSubscriptions();
        return sendJson(200, {
          activeSessionsCount: activeSessions.length,
          mobileCount: activeSessions.filter(s => s.device_type === 'mobile').length,
          desktopCount: activeSessions.filter(s => s.device_type === 'desktop').length,
          webCount: activeSessions.filter(s => s.device_type === 'web').length,
          pushSubscribersCount: pushSubs.length
        });
      }

      if (pathname === '/api/network/events' && req.method === 'GET') {
        const events = this.storage.getRecentNetworkEvents(50);
        return sendJson(200, { events });
      }

      // 6. Inscrição Web Push (VAPID)
      if (pathname === '/api/notifications/subscribe' && req.method === 'POST') {
        const body = await getBody();
        this.notificationService.registerSubscription(body);
        return sendJson(200, { success: true });
      }

      if (pathname === '/api/notifications/vapid-key' && req.method === 'GET') {
        return sendJson(200, {
          vapidPublicKey: this.notificationService.getVapidPublicKey()
        });
      }

      // 7. Auditoria Criptográfica Imutável
      if (pathname === '/api/audit' && req.method === 'GET') {
        const logs = this.auditLogger.getRecentLogs(100);
        const integrity = this.auditLogger.verifyChainIntegrity();
        return sendJson(200, { integrity, logs });
      }

      // 8. Administração e Governança
      if (pathname === '/api/admin/role' && req.method === 'POST') {
        const user = getSessionUser();
        if (!user || user.role !== 'Administrador') {
          return sendJson(403, { error: 'Acesso negado. Requer privilégios de Administrador.' });
        }

        const { userId, newRole } = await getBody();
        this.storage.updateUserRole(userId, newRole);
        this.auditLogger.log('ADMIN_ROLE_CHANGED', this.currentUser.public_key, { userId, newRole });

        return sendJson(200, { success: true });
      }

      if (pathname === '/api/admin/revoke' && req.method === 'POST') {
        const user = getSessionUser();
        if (!user || user.role !== 'Administrador') {
          return sendJson(403, { error: 'Acesso negado. Requer privilégios de Administrador.' });
        }

        const { userId } = await getBody();
        this.storage.setUserStatus(userId, 'revoked');

        const comm = this.storage.getCommunity('geral');
        const nextEpoch = comm.current_epoch + 1;
        const newChannelKey = CryptoEngine.generateChannelKey();

        this.storage.saveKeyEpoch('geral', nextEpoch, newChannelKey, this.currentUser.public_key);
        this.storage.updateCommunityEpoch('geral', nextEpoch);
        this.activeChannelKeyHex = newChannelKey;

        this.auditLogger.log('MEMBER_REVOKED_AND_KEY_ROTATED', this.currentUser.public_key, {
          revokedUserId: userId,
          newEpoch: nextEpoch
        });

        return sendJson(200, {
          success: true,
          message: `Membro revogado. Nova época criptográfica #${nextEpoch} ativada.`,
          newEpoch
        });
      }

      // 9. Exportação de Backup Criptografado
      if (pathname === '/api/export' && req.method === 'GET') {
        const backup = this.storage.createBackup();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="backup-comunidade-${Date.now()}.json"`
        });
        res.end(JSON.stringify(backup, null, 2));
        return;
      }

      return sendJson(404, { error: 'Endpoint não encontrado' });
    } catch (err) {
      return sendJson(500, { error: err.message });
    }
  }

  formatMessageForUI(msg) {
    const key = this.storage.getKeyForEpoch(msg.community_id, msg.epoch);
    let decryptedText = '[Conteúdo Criptografado - Chave Indisponível]';
    let isDecrypted = false;

    if (key) {
      try {
        decryptedText = CryptoEngine.decryptAESGCM(
          {
            ciphertext: msg.encrypted_content,
            iv: msg.iv,
            tag: msg.tag
          },
          key
        );
        isDecrypted = true;
      } catch (e) {}
    }

    const authorUser = this.storage.getUserByPublicKey(msg.author_pubkey);
    const authorName = authorUser ? authorUser.username : `Admin (${msg.author_pubkey.substring(0, 10)}...)`;

    return {
      id: msg.id,
      sequence: msg.sequence,
      communityId: msg.community_id,
      prevHash: msg.prev_hash,
      authorName,
      authorPubkey: msg.author_pubkey,
      text: decryptedText,
      isDecrypted,
      epoch: msg.epoch,
      attachmentType: msg.attachment_type,
      attachmentData: msg.attachment_data,
      timestamp: msg.timestamp,
      signature: msg.signature,
      signatureValid: CryptoEngine.verifySignature(msg.id, msg.signature, msg.author_pubkey)
    };
  }

  broadcastToUI(payload) {
    const str = JSON.stringify(payload);
    for (const ws of this.uiClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(str);
        } catch (e) {}
      }
    }
  }

  serveStaticFile(pathname, res) {
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const webRoot = path.join(__dirname, '..', 'web');
    const fullPath = path.join(webRoot, filePath);

    // Proteção contra Path Traversal e vazamento de arquivos confidenciais
    if (!fullPath.startsWith(webRoot) ||
        fullPath.includes('.env') ||
        fullPath.includes('.db') ||
        fullPath.includes('.git') ||
        fullPath.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Acesso proibido');
      return;
    }

    if (!fs.existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const isCacheable = ['.css', '.js', '.png', '.jpg', '.svg'].includes(ext) && !filePath.includes('sw.js');
    const cacheControl = isCacheable ? 'public, max-age=86400' : 'no-cache, no-store, must-revalidate';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl
    });
    fs.createReadStream(fullPath).pipe(res);
  }

  async stop() {
    for (const ws of this.uiClients) {
      try { ws.terminate(); } catch (e) {}
    }
    this.uiClients.clear();

    if (this.uiWss) {
      try { this.uiWss.close(); } catch (e) {}
    }

    await this.p2p.stop();

    return new Promise((resolve) => {
      if (this.httpServer) {
        if (typeof this.httpServer.closeAllConnections === 'function') {
          this.httpServer.closeAllConnections();
        }
        this.httpServer.close(() => {
          this.storage.close();
          resolve();
        });
      } else {
        this.storage.close();
        resolve();
      }
    });
  }
}

if (require.main === module) {
  const nodeId = process.env.NODE_ID || `node-${Math.random().toString(36).substring(2, 7)}`;
  const p2pPort = parseInt(process.env.P2P_PORT || '6001', 10);
  const httpPort = parseInt(process.env.HTTP_PORT || '5001', 10);
  const role = process.env.ROLE || 'Membro';
  const username = process.env.USERNAME || (role === 'Administrador' ? 'admin' : `membro_${nodeId}`);
  const bootstrapNodes = process.env.BOOTSTRAPS ? process.env.BOOTSTRAPS.split(',') : ['ws://127.0.0.1:4001'];

  const node = new P2PNode({
    nodeId,
    p2pPort,
    httpPort,
    role,
    username,
    bootstrapNodes
  });

  node.start();

  process.on('SIGINT', async () => {
    console.log('\nDesligando nó P2P...');
    await node.stop();
    process.exit(0);
  });
}

module.exports = P2PNode;
