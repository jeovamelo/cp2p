/**
 * Comunidade Resiliente - Servidor VPS de Bootstrap, Descoberta e Relay Central
 * Ponto de encontro inicial (Rendezvous / STUN / Relay).
 * Fornece descoberta mútua de peers, resolução de IP reflexivo (STUN probe)
 * e relay transparente com rate limiting sem inspecionar o conteúdo privado.
 */

const WebSocket = require('ws');
const http = require('http');
const { MessageType, ProtocolPacket } = require('../common/protocol');
const SystemConfig = require('../common/config');

class VpsBootstrapServer {
  /**
   * @param {object} options
   * @param {number} [options.port=4001] - Porta do servidor bootstrap
   * @param {string} [options.host='0.0.0.0']
   * @param {Array<string>} [options.peerBootstraps] - URLs de outras VPS parceiras
   */
  constructor(options = {}) {
    this.port = options.port || SystemConfig.VPS_PORT || 4001;
    this.host = options.host || '0.0.0.0';
    this.nodeId = `vps-bootstrap-${this.port}`;
    this.peerBootstraps = options.peerBootstraps || [];
    this.peers = new Map(); // socket -> peerInfo
    this.httpServer = null;
    this.wss = null;
    this.isRunning = false;

    this.stats = {
      startedAt: Date.now(),
      relayPackets: 0,
      relayBytes: 0,
      totalHandshakes: 0
    };
  }

  start() {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
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

        // 2. Cabeçalhos de Segurança Estritos
        for (const [header, value] of Object.entries(SystemConfig.SECURITY_HEADERS)) {
          res.setHeader(header, value);
        }

        // 3. CORS Seguro
        const origin = req.headers.origin;
        if (origin) {
          const isSameOrigin = origin.toLowerCase() === `http://${hostHeader}`.toLowerCase() || origin.toLowerCase() === `https://${hostHeader}`.toLowerCase();
          if (isSameOrigin || SystemConfig.isOriginAllowed(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          } else if (SystemConfig.isProduction) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'CORS_FORBIDDEN' }));
            return;
          }
        } else if (!SystemConfig.isProduction) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // 4. Endpoint de Saúde (Health Check sem segredos)
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'HEALTHY',
            version: '1.1.0',
            domain: SystemConfig.APP_DOMAIN,
            role: 'BOOTSTRAP_DISCOVERY_RELAY',
            https: isHttps || SystemConfig.isProduction,
            uptimeSeconds: Math.floor((Date.now() - this.stats.startedAt) / 1000),
            activePeers: this.peers.size,
            relay: {
              packetsForwarded: this.stats.relayPackets,
              bytesForwarded: this.stats.relayBytes
            }
          }, null, 2));
          return;
        }

        if (req.url === '/status' || req.url === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ONLINE',
            nodeId: this.nodeId,
            domain: SystemConfig.APP_DOMAIN,
            https: isHttps || SystemConfig.isProduction,
            role: 'BOOTSTRAP_DISCOVERY_RELAY',
            activePeers: this.peers.size,
            uptimeSeconds: Math.floor((Date.now() - this.stats.startedAt) / 1000),
            relayStats: {
              packetsForwarded: this.stats.relayPackets,
              bytesForwarded: this.stats.relayBytes
            },
            peers: Array.from(this.peers.values()).map(p => ({
              nodeId: p.nodeId,
              role: p.role,
              isRelayCapable: true,
              lastSeen: p.lastSeen
            }))
          }, null, 2));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Comunidade Resiliente - VPS Bootstrap Node\nID: ${this.nodeId}\nDomínio: ${SystemConfig.APP_DOMAIN}\nStatus: ONLINE\nNós Ativos: ${this.peers.size}`);
      });

      this.wss = new WebSocket.Server({ server: this.httpServer });

      this.wss.on('connection', (socket, req) => {
        const rawIp = req.socket.remoteAddress || '';
        const clientIp = rawIp.replace(/^.*:/, '') || '127.0.0.1';

        socket.on('message', (raw) => {
          let packet;
          try {
            packet = JSON.parse(raw.toString());
          } catch (e) {
            return;
          }

          if (!ProtocolPacket.isValid(packet)) return;

          const { type, senderNodeId, payload } = packet;

          // 1. Resolução STUN / IP Reflexivo
          if (type === MessageType.STUN_PROBE) {
            const stunResp = ProtocolPacket.create(MessageType.STUN_RESPONSE, this.nodeId, {
              reflexiveIp: clientIp === '1' ? '127.0.0.1' : clientIp,
              reflexivePort: req.socket.remotePort || 0,
              serverTime: Date.now()
            });
            try { socket.send(JSON.stringify(stunResp)); } catch (e) {}
            return;
          }

          // 2. Apresentação Inicial (Handshake HELLO)
          if (type === MessageType.HELLO) {
            this.stats.totalHandshakes++;

            const advertisedHost = payload.host && payload.host !== '127.0.0.1' && payload.host !== 'localhost'
              ? payload.host
              : clientIp;

            const peerInfo = {
              nodeId: senderNodeId,
              host: advertisedHost,
              port: payload.port,
              role: payload.role || 'Membro',
              nodePubkey: payload.nodePubkey || null,
              latestSequence: payload.latestSequence || 0,
              lastSeen: Date.now(),
              connectedAt: Date.now()
            };
            this.peers.set(socket, peerInfo);

            const knownPeers = Array.from(this.peers.values())
              .filter(p => p.nodeId !== senderNodeId)
              .map(p => ({
                nodeId: p.nodeId,
                host: p.host,
                port: p.port,
                role: p.role,
                nodePubkey: p.nodePubkey,
                isBootstrap: false
              }));

            const ack = ProtocolPacket.create(MessageType.HELLO_ACK, this.nodeId, {
              host: this.host,
              port: this.port,
              role: 'VPS_Bootstrap',
              isBootstrap: true,
              clientReflexiveIp: clientIp,
              knownPeers
            });
            try { socket.send(JSON.stringify(ack)); } catch (e) {}

            // Informa aos outros pares sobre o novo nó conectado
            const announcePacket = ProtocolPacket.create(MessageType.PEER_EXCHANGE, this.nodeId, {
              peers: [peerInfo]
            });
            this.broadcastToOthers(socket, announcePacket);
            return;
          }

          // 3. Encaminhamento de Relay (quando conexão direta falha)
          if (type === MessageType.RELAY_FORWARD) {
            const { targetNodeId } = payload;
            if (!targetNodeId) return;

            // Rate limiting por conexão (máximo 60 pacotes por segundo)
            const now = Date.now();
            socket.relayCount = (socket.relayCount || 0) + 1;
            if (socket.relayWindowReset && now < socket.relayWindowReset) {
              if (socket.relayCount > 60) {
                console.warn(`[VPS Relay] Limite de tráfego excedido para ${senderNodeId}. Descartando.`);
                return;
              }
            } else {
              socket.relayWindowReset = now + 1000;
              socket.relayCount = 1;
            }

            let forwarded = false;
            for (const [s, p] of this.peers.entries()) {
              if (p.nodeId === targetNodeId && s.readyState === WebSocket.OPEN) {
                const jsonStr = JSON.stringify(packet);
                try {
                  s.send(jsonStr);
                  this.stats.relayPackets++;
                  this.stats.relayBytes += jsonStr.length;
                  forwarded = true;
                } catch (e) {}
                break;
              }
            }

            // Log técnico estritamente sem dados privados
            console.log(`[VPS Relay] Trânsito: ${senderNodeId} -> ${targetNodeId} (${forwarded ? 'OK' : 'Destinatário Inalcançável'})`);
            return;
          }

          // 4. Difusão Epidêmica e Mensagens de Governança/Consenso
          if (
            type === MessageType.GOSSIP_MESSAGE ||
            type === MessageType.CHUNK_REQUEST ||
            type === MessageType.CHUNK_RESPONSE ||
            type === MessageType.ELECTION_CALL ||
            type === MessageType.ELECTION_VOTE ||
            type === MessageType.ELECTION_DECLARE ||
            type === MessageType.ADMIN_ACTION ||
            type === MessageType.KEY_ROTATION
          ) {
            this.broadcastToOthers(socket, packet);
          }
        });

        socket.on('close', () => {
          this.peers.delete(socket);
        });

        socket.on('error', () => {
          this.peers.delete(socket);
        });
      });

      this.httpServer.listen(this.port, () => {
        this.isRunning = true;
        console.log(`[VPS Bootstrap] Servidor de descoberta e relay ativo na porta ${this.port}`);
        resolve();
      });

      this.httpServer.on('error', (err) => {
        reject(err);
      });
    });
  }

  broadcastToOthers(exceptSocket, packet) {
    const data = JSON.stringify(packet);
    for (const socket of this.peers.keys()) {
      if (socket !== exceptSocket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(data);
        } catch (e) {}
      }
    }
  }

  /**
   * Desliga imediatamente o servidor para simular queda da VPS
   */
  async stop() {
    this.isRunning = false;
    for (const socket of this.peers.keys()) {
      try {
        socket.terminate();
      } catch (e) {}
    }
    this.peers.clear();

    if (this.wss) {
      try {
        this.wss.close();
      } catch (e) {}
    }

    return new Promise((resolve) => {
      if (this.httpServer) {
        if (typeof this.httpServer.closeAllConnections === 'function') {
          this.httpServer.closeAllConnections();
        }
        this.httpServer.close(() => {
          console.log(`[VPS Bootstrap] Servidor na porta ${this.port} DESLIGADO.`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || process.argv[2] || '4001', 10);
  const server = new VpsBootstrapServer({ port });
  server.start();

  process.on('SIGINT', async () => {
    console.log('\nEncerrando VPS Bootstrap...');
    await server.stop();
    process.exit(0);
  });
}

module.exports = VpsBootstrapServer;
