/**
 * Comunidade Resiliente - Servidor VPS de Bootstrap, Descoberta e Relay Inicial
 * Ponto de encontro inicial (Rendezvous / STUN / Relay).
 */

const WebSocket = require('ws');
const http = require('http');
const { MessageType, ProtocolPacket } = require('../common/protocol');

class VpsBootstrapServer {
  /**
   * @param {object} options
   * @param {number} [options.port=4001] - Porta do servidor bootstrap
   * @param {string} [options.host='0.0.0.0']
   */
  constructor(options = {}) {
    this.port = options.port || 4001;
    this.host = options.host || '0.0.0.0';
    this.nodeId = `vps-bootstrap-${this.port}`;
    this.peers = new Map(); // socket -> peerInfo
    this.httpServer = null;
    this.wss = null;
    this.isRunning = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        if (req.url === '/status') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({
            status: 'ONLINE',
            nodeId: this.nodeId,
            role: 'BOOTSTRAP_DISCOVERY_RELAY',
            activePeers: this.peers.size,
            uptime: process.uptime()
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Comunidade Resiliente - VPS Bootstrap Node\nStatus: ONLINE');
      });

      this.wss = new WebSocket.Server({ server: this.httpServer });

      this.wss.on('connection', (socket, req) => {
        const clientIp = req.socket.remoteAddress;

        socket.on('message', (raw) => {
          let packet;
          try {
            packet = JSON.parse(raw.toString());
          } catch (e) {
            return;
          }

          if (!ProtocolPacket.isValid(packet)) return;

          const { type, senderNodeId, payload } = packet;

          if (type === MessageType.HELLO) {
            const peerInfo = {
              nodeId: senderNodeId,
              host: payload.host === '127.0.0.1' ? '127.0.0.1' : (clientIp || payload.host),
              port: payload.port,
              role: payload.role || 'Membro',
              latestSequence: payload.latestSequence || 0,
              lastSeen: Date.now()
            };
            this.peers.set(socket, peerInfo);

            const knownPeers = Array.from(this.peers.values())
              .filter(p => p.nodeId !== senderNodeId)
              .map(p => ({
                nodeId: p.nodeId,
                host: p.host,
                port: p.port,
                role: p.role,
                isBootstrap: false
              }));

            const ack = ProtocolPacket.create(MessageType.HELLO_ACK, this.nodeId, {
              host: this.host,
              port: this.port,
              role: 'VPS_Bootstrap',
              isBootstrap: true,
              knownPeers
            });
            socket.send(JSON.stringify(ack));

            const announcePacket = ProtocolPacket.create(MessageType.PEER_EXCHANGE, this.nodeId, {
              peers: [peerInfo]
            });
            this.broadcastToOthers(socket, announcePacket);
          } else if (type === MessageType.GOSSIP_MESSAGE || type === MessageType.ELECTION_CALL || type === MessageType.ELECTION_VOTE || type === MessageType.ELECTION_DECLARE) {
            this.broadcastToOthers(socket, packet);
          } else if (type === MessageType.RELAY_FORWARD) {
            const { targetNodeId } = payload;
            for (const [s, p] of this.peers.entries()) {
              if (p.nodeId === targetNodeId && s.readyState === WebSocket.OPEN) {
                s.send(JSON.stringify(packet));
                break;
              }
            }
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
