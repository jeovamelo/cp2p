/**
 * Comunidade Resiliente - Motor de Rede P2P Descentralizado
 * Malha P2P com Descoberta Dinâmica (PEX), Gossip Epidêmico, STUN/Relay Fallback e Anti-Entropy Sync
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const { MessageType, ProtocolPacket } = require('../common/protocol');
const ConsensusEngine = require('./consensus');

class P2PEngine extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.nodeId - ID único do nó
   * @param {string} options.host - Host local (ex: '127.0.0.1' ou IP público)
   * @param {number} options.p2pPort - Porta onde este nó escuta conexões P2P
   * @param {Array<string>} options.bootstrapNodes - URLs dos nós de bootstrap (VPS)
   * @param {import('./storage')} options.storage - Gerenciador de armazenamento SQLite
   * @param {import('./crdt_chain')} options.chain - Cadeia de mensagens
   * @param {import('./notification_service')} options.notificationService - Notificações
   * @param {import('./audit_logger')} options.auditLogger - Logs de auditoria
   * @param {string} [options.role='Membro'] - Papel do usuário deste nó
   */
  constructor(options) {
    super();
    this.nodeId = options.nodeId;
    this.host = options.host || '127.0.0.1';
    this.p2pPort = options.p2pPort;
    this.bootstrapNodes = options.bootstrapNodes || [];
    this.storage = options.storage;
    this.chain = options.chain;
    this.notificationService = options.notificationService;
    this.auditLogger = options.auditLogger;
    this.role = options.role || 'Membro';

    // Mapas de conexões ativas
    this.peers = new Map(); // nodeId -> WebSocket
    this.knownPeers = new Map(); // address 'host:port' -> { nodeId, host, port, isBootstrap }
    this.seenPacketNonces = new Set(); // Proteção contra loops de difusão de gossip

    this.server = null;
    this.reconnectInterval = null;
    this.pexInterval = null;
    this.isStopping = false;

    // Inicializa o motor de consenso para eleição de líder quando a VPS cair
    this.consensus = new ConsensusEngine({
      nodeId: this.nodeId,
      role: this.role,
      broadcast: (packet) => this.broadcast(packet),
      heartbeatInterval: 3000,
      electionTimeout: 4000
    });

    this.setupConsensusEvents();
  }

  setupConsensusEvents() {
    this.consensus.on('leader_elected', (data) => {
      this.auditLogger.log('NEW_LEADER_ELECTED', this.nodeId, {
        leaderId: data.leaderId,
        isMe: data.isMe
      });
      this.emit('leader_change', data);
    });

    this.consensus.on('vps_status_change', (data) => {
      this.auditLogger.log(
        data.alive ? 'VPS_RESTORED' : 'VPS_FAILURE_DETECTED',
        this.nodeId,
        { alive: data.alive }
      );
      this.emit('vps_status_change', data);
    });
  }

  /**
   * Inicia o servidor P2P local e conecta-se aos nós de bootstrap configurados
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = new WebSocket.Server({ port: this.p2pPort }, () => {
          this.auditLogger.log('P2P_SERVER_STARTED', this.nodeId, {
            host: this.host,
            port: this.p2pPort
          });

          // Inicia o consenso
          this.consensus.start();

          // Conecta aos nós de bootstrap (VPS inicial)
          this.connectToBootstraps();

          // Configura tarefas periódicas: PEX e Reconexão
          this.startPeriodicTasks();

          resolve();
        });

        this.server.on('connection', (socket, req) => {
          this.handleIncomingConnection(socket, req);
        });

        this.server.on('error', (err) => {
          this.emit('error', err);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Encerra o nó de forma graciosa e instantânea
   */
  async stop() {
    this.isStopping = true;
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    if (this.pexInterval) {
      clearInterval(this.pexInterval);
      this.pexInterval = null;
    }
    this.consensus.stop();

    for (const socket of this.peers.values()) {
      try { socket.terminate(); } catch (e) {}
    }
    this.peers.clear();

    if (this.server && this.server.clients) {
      for (const client of this.server.clients) {
        try { client.terminate(); } catch (e) {}
      }
    }

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * Conecta a todos os nós de bootstrap configurados (ex: VPS de encontro)
   */
  connectToBootstraps() {
    for (const bUrl of this.bootstrapNodes) {
      this.connectToPeerUrl(bUrl, true);
    }
  }

  /**
   * Conecta a um nó remoto por URL (ex: 'ws://127.0.0.1:4001')
   */
  connectToPeerUrl(url, isBootstrap = false) {
    if (this.isStopping) return;

    try {
      const socket = new WebSocket(url);

      socket.on('open', () => {
        const latest = this.storage.getLatestMessage('geral');
        const latestSequence = latest ? latest.sequence : 0;

        const hello = ProtocolPacket.create(MessageType.HELLO, this.nodeId, {
          host: this.host,
          port: this.p2pPort,
          role: this.role,
          latestSequence,
          isBootstrap
        });
        socket.send(JSON.stringify(hello));

        if (isBootstrap) {
          this.consensus.notifyBootstrapRestored(url);
        }
      });

      socket.on('message', (data) => {
        this.handleMessage(socket, data);
      });

      socket.on('close', () => {
        this.handleSocketClose(socket, url, isBootstrap);
      });

      socket.on('error', (err) => {
        if (isBootstrap) {
          this.consensus.notifyBootstrapFailed();
        }
      });
    } catch (e) {
      if (isBootstrap) {
        this.consensus.notifyBootstrapFailed();
      }
    }
  }

  handleIncomingConnection(socket, req) {
    socket.on('message', (data) => {
      this.handleMessage(socket, data);
    });

    socket.on('close', () => {
      this.handleSocketClose(socket);
    });

    socket.on('error', () => {});
  }

  handleMessage(socket, rawData) {
    let packet;
    try {
      packet = JSON.parse(rawData.toString());
    } catch (e) {
      return;
    }

    if (!ProtocolPacket.isValid(packet)) return;

    const packetId = `${packet.senderNodeId}-${packet.nonce}`;
    if (this.seenPacketNonces.has(packetId)) return;
    this.seenPacketNonces.add(packetId);

    if (this.seenPacketNonces.size > 5000) {
      const arr = Array.from(this.seenPacketNonces);
      for (let i = 0; i < 1000; i++) this.seenPacketNonces.delete(arr[i]);
    }

    const { type, senderNodeId, payload } = packet;

    if (senderNodeId === this.nodeId) return;

    this.consensus.recordPeerSeen(senderNodeId, payload.role || 'Membro', payload.isBootstrap);

    switch (type) {
      case MessageType.HELLO:
        this.handleHello(socket, packet);
        break;

      case MessageType.HELLO_ACK:
        this.handleHelloAck(socket, packet);
        break;

      case MessageType.PEER_EXCHANGE:
        this.handlePeerExchange(payload.peers);
        break;

      case MessageType.GOSSIP_MESSAGE:
        this.handleGossipMessage(socket, packet);
        break;

      case MessageType.SYNC_REQUEST:
        this.handleSyncRequest(socket, packet);
        break;

      case MessageType.SYNC_RESPONSE:
        this.handleSyncResponse(packet);
        break;

      case MessageType.RELAY_FORWARD:
        this.handleRelayForward(packet);
        break;

      case MessageType.ELECTION_CALL:
      case MessageType.ELECTION_VOTE:
      case MessageType.ELECTION_DECLARE:
      case MessageType.HEARTBEAT:
        const latest = this.storage.getLatestMessage('geral');
        this.consensus.handleProtocolPacket(packet, latest ? latest.sequence : 0);
        break;

      default:
        break;
    }
  }

  handleHello(socket, packet) {
    const { senderNodeId, payload } = packet;
    socket.nodeId = senderNodeId;
    socket.peerHost = payload.host;
    socket.peerPort = payload.port;

    this.peers.set(senderNodeId, socket);

    const address = `${payload.host}:${payload.port}`;
    this.knownPeers.set(address, {
      nodeId: senderNodeId,
      host: payload.host,
      port: payload.port,
      isBootstrap: !!payload.isBootstrap
    });

    this.storage.upsertPeer({
      node_id: senderNodeId,
      host: payload.host,
      port: payload.port,
      is_bootstrap: payload.isBootstrap ? 1 : 0,
      last_seen: Date.now(),
      latency: 10,
      status: 'alive'
    });

    const latest = this.storage.getLatestMessage('geral');
    const mySequence = latest ? latest.sequence : 0;

    const ack = ProtocolPacket.create(MessageType.HELLO_ACK, this.nodeId, {
      host: this.host,
      port: this.p2pPort,
      role: this.role,
      latestSequence: mySequence,
      knownPeers: this.getExportablePeersList()
    });
    socket.send(JSON.stringify(ack));

    if (payload.latestSequence > mySequence) {
      this.sendSyncRequest(socket, 'geral', mySequence);
    }

    this.emit('peer_connected', { nodeId: senderNodeId, host: payload.host, port: payload.port });
  }

  handleHelloAck(socket, packet) {
    const { senderNodeId, payload } = packet;
    socket.nodeId = senderNodeId;
    socket.peerHost = payload.host;
    socket.peerPort = payload.port;
    this.peers.set(senderNodeId, socket);

    if (Array.isArray(payload.knownPeers)) {
      this.handlePeerExchange(payload.knownPeers);
    }

    const latest = this.storage.getLatestMessage('geral');
    const mySequence = latest ? latest.sequence : 0;
    if (payload.latestSequence > mySequence) {
      this.sendSyncRequest(socket, 'geral', mySequence);
    }

    this.emit('peer_connected', { nodeId: senderNodeId, host: payload.host, port: payload.port });
  }

  handlePeerExchange(remotePeers) {
    if (!Array.isArray(remotePeers)) return;

    for (const p of remotePeers) {
      if (!p.host || !p.port) continue;
      if (p.host === this.host && p.port === this.p2pPort) continue;
      if (p.nodeId === this.nodeId) continue;

      const address = `${p.host}:${p.port}`;
      if (!this.knownPeers.has(address)) {
        this.knownPeers.set(address, p);
        this.storage.upsertPeer({
          node_id: p.nodeId || address,
          host: p.host,
          port: p.port,
          is_bootstrap: p.isBootstrap ? 1 : 0,
          last_seen: Date.now(),
          latency: 0,
          status: 'discovered'
        });

        if (!this.isAlreadyConnectedTo(p.host, p.port)) {
          this.connectToPeerUrl(`ws://${p.host}:${p.port}`, false);
        }
      }
    }
  }

  isAlreadyConnectedTo(host, port) {
    for (const s of this.peers.values()) {
      if (s.peerHost === host && s.peerPort === port) return true;
    }
    return false;
  }

  getAuthorizedAdminPubkeys(communityId) {
    const authorized = new Set();

    // 1. Administradores salvos no banco local
    const adminUsers = this.storage.getAllUsers().filter(u => u.role === 'Administrador' && u.status === 'active');
    for (const u of adminUsers) {
      if (u.public_key) authorized.add(u.public_key.trim());
    }

    // 2. Chave de gênesis da comunidade
    const community = this.storage.getCommunity(communityId);
    if (community && community.genesis_admin_pubkey && community.genesis_admin_pubkey !== 'GENESIS_ADMIN_PENDING') {
      authorized.add(community.genesis_admin_pubkey.trim());
    }

    return Array.from(authorized);
  }

  handleGossipMessage(socket, packet) {
    const { payload } = packet;
    const message = payload.message;
    if (!message) return;

    const authorizedAdminPubkeys = this.getAuthorizedAdminPubkeys(message.community_id);

    const result = this.chain.processIncomingMessage(message, authorizedAdminPubkeys);

    if (result.success) {
      if (result.reason === 'APPLIED') {
        const comm = this.storage.getCommunity(message.community_id);
        this.notificationService.dispatchForMessage(message, comm ? comm.name : undefined);
        this.emit('message_received', message);
        this.propagateGossip(packet, socket);
      } else if (result.needsSync) {
        const latest = this.storage.getLatestMessage(message.community_id);
        this.sendSyncRequest(socket, message.community_id, latest ? latest.sequence : 0);
      }
    } else {
      this.auditLogger.log('TAMPER_ATTEMPT_DETECTED', packet.senderNodeId, {
        messageId: message.id,
        reason: result.reason
      });
      this.emit('security_alert', { reason: result.reason, messageId: message.id });
    }
  }

  sendSyncRequest(socket, communityId, currentMaxSequence) {
    const syncReq = ProtocolPacket.create(MessageType.SYNC_REQUEST, this.nodeId, {
      communityId,
      currentMaxSequence
    });
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(syncReq));
    }
  }

  handleSyncRequest(socket, packet) {
    const { communityId, currentMaxSequence } = packet.payload;
    const missing = this.storage.getMissingMessages(communityId, currentMaxSequence);

    const response = ProtocolPacket.create(MessageType.SYNC_RESPONSE, this.nodeId, {
      communityId,
      messages: missing
    });
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(response));
    }
  }

  handleSyncResponse(packet) {
    const { messages } = packet.payload;
    if (!Array.isArray(messages) || messages.length === 0) return;

    for (const msg of messages) {
      const authorizedAdminPubkeys = this.getAuthorizedAdminPubkeys(msg.community_id);
      const res = this.chain.processIncomingMessage(msg, authorizedAdminPubkeys);
      if (res.success && res.reason === 'APPLIED') {
        this.emit('message_received', msg);
      }
    }
  }

  handleRelayForward(packet) {
    const { targetNodeId, innerPacket } = packet.payload;
    if (targetNodeId === this.nodeId) {
      this.handleMessage(null, JSON.stringify(innerPacket));
    } else {
      const targetSocket = this.peers.get(targetNodeId);
      if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
        targetSocket.send(JSON.stringify(packet));
      }
    }
  }

  handleSocketClose(socket, url = null, isBootstrap = false) {
    if (socket && socket.nodeId) {
      this.peers.delete(socket.nodeId);
      this.storage.upsertPeer({
        node_id: socket.nodeId,
        host: socket.peerHost || 'unknown',
        port: socket.peerPort || 0,
        is_bootstrap: isBootstrap ? 1 : 0,
        last_seen: Date.now(),
        latency: 0,
        status: 'disconnected'
      });
      this.emit('peer_disconnected', { nodeId: socket.nodeId });
    }

    if (isBootstrap) {
      this.consensus.notifyBootstrapFailed();
    }
  }

  publishMessage(signedMessage) {
    const packet = ProtocolPacket.create(MessageType.GOSSIP_MESSAGE, this.nodeId, {
      message: signedMessage
    });
    this.broadcast(packet);
    this.auditLogger.log('MESSAGE_PUBLISHED', this.nodeId, {
      messageId: signedMessage.id,
      sequence: signedMessage.sequence,
      communityId: signedMessage.community_id
    });
  }

  broadcast(packet) {
    const data = JSON.stringify(packet);
    for (const [nodeId, socket] of this.peers.entries()) {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(data);
        } catch (e) {}
      }
    }
  }

  propagateGossip(packet, exceptSocket) {
    const data = JSON.stringify(packet);
    for (const socket of this.peers.values()) {
      if (socket !== exceptSocket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(data);
        } catch (e) {}
      }
    }
  }

  getExportablePeersList() {
    const list = [];
    for (const p of this.knownPeers.values()) {
      list.push({
        nodeId: p.nodeId,
        host: p.host,
        port: p.port,
        isBootstrap: p.isBootstrap
      });
    }
    return list;
  }

  startPeriodicTasks() {
    this.pexInterval = setInterval(() => {
      if (this.peers.size > 0) {
        const pexPacket = ProtocolPacket.create(MessageType.PEER_EXCHANGE, this.nodeId, {
          peers: this.getExportablePeersList()
        });
        this.broadcast(pexPacket);
      }
    }, 8000);

    this.reconnectInterval = setInterval(() => {
      this.attemptReconnections();
    }, 5000);
  }

  attemptReconnections() {
    if (this.isStopping) return;

    if (!this.consensus.isVpsAlive) {
      this.connectToBootstraps();
    }

    for (const p of this.knownPeers.values()) {
      if (p.nodeId === this.nodeId) continue;
      if (!this.peers.has(p.nodeId) && !this.isAlreadyConnectedTo(p.host, p.port)) {
        this.connectToPeerUrl(`ws://${p.host}:${p.port}`, p.isBootstrap);
      }
    }
  }

  getNetworkStatus() {
    return {
      nodeId: this.nodeId,
      host: this.host,
      p2pPort: this.p2pPort,
      role: this.role,
      activePeersCount: this.peers.size,
      activePeers: Array.from(this.peers.keys()),
      currentLeader: this.consensus.currentLeaderId,
      isLeader: this.consensus.isLeader,
      isVpsAlive: this.consensus.isVpsAlive,
      term: this.consensus.term
    };
  }
}

module.exports = P2PEngine;
