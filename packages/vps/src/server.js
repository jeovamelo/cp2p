import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT || '5000', 10);
const STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302'
];

class VpsBootstrapServer {
  constructor(port = PORT) {
    this.port = port;
    this.startTime = Date.now();
    this.clients = new Map(); // ws -> { nodeId, role, displayName, address, connectedAt }
    this.cachedMessages = []; // Cache temporário volátil de mensagens recentes
    this.httpServer = null;
    this.wss = null;
  }

  start() {
    this.httpServer = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/health' || url.pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ONLINE',
          service: 'Comunidade Resiliente VPS Bootstrap',
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          connectedNodes: this.clients.size,
          stunServers: STUN_SERVERS
        }));
        return;
      }

      if (url.pathname === '/api/stats') {
        const nodes = Array.from(this.clients.values()).map(c => ({
          nodeId: c.nodeId,
          role: c.role,
          displayName: c.displayName,
          connectedAt: c.connectedAt
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ONLINE',
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          nodeCount: this.clients.size,
          nodes,
          cachedMessageCount: this.cachedMessages.length
        }));
        return;
      }

      if (url.pathname === '/api/kill' && req.method === 'POST') {
        console.warn('\n⚠️ [VPS] Sinal de encerramento / kill switch recebido via API!');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'VPS Bootstrap sendo desligada intencionalmente para teste de resiliência P2P'
        }));

        // Desliga o servidor de forma limpa em 100ms
        setTimeout(() => {
          this.stop();
        }, 100);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint não encontrado' }));
    });

    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress;

      ws.on('message', (raw) => {
        try {
          const packet = JSON.parse(raw.toString());
          this._handlePacket(ws, packet, clientIp);
        } catch (err) {
          console.error('[VPS] Erro ao processar pacote WS:', err.message);
        }
      });

      ws.on('close', () => {
        const clientInfo = this.clients.get(ws);
        if (clientInfo) {
          console.log(`[VPS] Nó desconectado: ${clientInfo.displayName || clientInfo.nodeId} (${clientInfo.nodeId})`);
          this.clients.delete(ws);
          this._broadcastNodeList();
        }
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });

    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        console.log(`\n======================================================`);
        console.log(`🌐 VPS Bootstrap do Comunidade Resiliente INICIADA`);
        console.log(`   Porta HTTP e WebSocket: ${this.port}`);
        console.log(`   Healthcheck: http://localhost:${this.port}/api/health`);
        console.log(`   Simulação de queda: POST http://localhost:${this.port}/api/kill`);
        console.log(`======================================================\n`);
        resolve(this);
      });
    });
  }

  _handlePacket(senderWs, packet, clientIp) {
    if (!packet || !packet.type) return;

    switch (packet.type) {
      case 'HANDSHAKE': {
        const clientInfo = {
          nodeId: packet.nodeId,
          displayName: packet.displayName || packet.nodeId,
          role: packet.role || 'MEMBER',
          publicKey: packet.publicKey,
          p2pPort: packet.p2pPort,
          address: `ws://localhost:${packet.p2pPort || 0}`,
          connectedAt: Date.now()
        };

        this.clients.set(senderWs, clientInfo);
        console.log(`[VPS] Nó registrado: ${clientInfo.displayName} [${clientInfo.role}] (ID: ${clientInfo.nodeId})`);

        // Confirma handshake e envia STUN + lista de outros nós
        senderWs.send(JSON.stringify({
          type: 'HANDSHAKE_ACK',
          vpsId: 'vps_bootstrap_primary',
          stunServers: STUN_SERVERS,
          knownPeers: Array.from(this.clients.values())
            .filter(c => c.nodeId !== clientInfo.nodeId)
            .map(c => ({
              nodeId: c.nodeId,
              displayName: c.displayName,
              role: c.role,
              address: c.address,
              p2pPort: c.p2pPort
            }))
        }));

        this._broadcastNodeList();
        break;
      }

      case 'HEARTBEAT_PING': {
        senderWs.send(JSON.stringify({
          type: 'HEARTBEAT_PONG',
          clientTime: packet.timestamp,
          serverTime: Date.now()
        }));
        break;
      }

      case 'GOSSIP_MESSAGE': {
        // VPS atua apenas como relé auxiliar para propagação rápida
        const { message } = packet;
        if (message) {
          if (!this.cachedMessages.some(m => m.id === message.id)) {
            this.cachedMessages.push(message);
            if (this.cachedMessages.length > 500) this.cachedMessages.shift();
          }

          // Retransmite para todos os outros nós conectados
          const payloadStr = JSON.stringify(packet);
          for (const [ws, info] of this.clients.entries()) {
            if (ws !== senderWs && ws.readyState === WebSocket.OPEN) {
              try { ws.send(payloadStr); } catch {}
            }
          }
        }
        break;
      }

      case 'SIGNALING_OFFER':
      case 'SIGNALING_ANSWER':
      case 'SIGNALING_ICE': {
        // Roteamento direto de sinalização WebRTC entre dois nós específicos
        const targetId = packet.targetNodeId;
        for (const [ws, info] of this.clients.entries()) {
          if (info.nodeId === targetId && ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify(packet)); } catch {}
            break;
          }
        }
        break;
      }
    }
  }

  _broadcastNodeList() {
    const list = Array.from(this.clients.values()).map(c => ({
      nodeId: c.nodeId,
      displayName: c.displayName,
      role: c.role,
      address: c.address,
      p2pPort: c.p2pPort
    }));

    const packet = JSON.stringify({
      type: 'PEER_EXCHANGE',
      knownAddresses: list.map(c => c.address),
      peers: list
    });

    for (const [ws] of this.clients.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(packet); } catch {}
      }
    }
  }

  stop() {
    console.log('[VPS] Encerrando conexões WebSocket...');
    for (const [ws] of this.clients.entries()) {
      try {
        ws.close(1001, 'VPS encerrou intencionalmente para teste');
      } catch {}
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
    }
    if (this.httpServer) {
      this.httpServer.close(() => {
        console.log('[VPS] Servidor HTTP e WebSocket completamente finalizados.');
      });
    }
  }
}

export { VpsBootstrapServer };

// Se executado diretamente pela CLI
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const server = new VpsBootstrapServer(PORT);
  server.start();

  process.on('SIGTERM', () => server.stop());
  process.on('SIGINT', () => server.stop());
}
