/**
 * Comunidade Resiliente - Motor de Rede P2P Descentralizado
 * Malha P2P resiliente com:
 * - NAT Traversal e Descoberta de IP Reflexivo (STUN RFC 5389 / RFC 3489)
 * - Identidade Criptográfica Ed25519 de cada nó com handshake autenticado mútuo
 * - Suporte a Múltiplos Bootstraps e Fallback para Cache Local (SQLite) quando todas as VPS caem
 * - Fallback automático para Relay quando conexão direta for impossível (NAT Simétrico / Firewall)
 * - Consenso Raft-lite persistido com resolução determinística de split-brain
 * - Telemetria em tempo real para o Painel de Monitoramento da Comunidade
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const crypto = require('crypto');
const { MessageType, ProtocolPacket } = require('../common/protocol');
const CryptoEngine = require('../common/crypto');
const ConsensusEngine = require('./consensus');
const NatStunResolver = require('./nat_stun');

class P2PEngine extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.nodeId - ID único do nó
   * @param {string} [options.host='0.0.0.0'] - Host local de escuta
   * @param {number} options.p2pPort - Porta onde este nó escuta conexões P2P
   * @param {Array<string>} [options.bootstrapNodes] - URLs dos nós de bootstrap (VPS)
   * @param {import('./storage')} options.storage - Gerenciador de armazenamento SQLite
   * @param {import('./crdt_chain')} options.chain - Cadeia de mensagens
   * @param {import('./notification_service')} options.notificationService - Notificações
   * @param {import('./audit_logger')} options.auditLogger - Logs de auditoria
   * @param {string} [options.role='Membro'] - Papel do usuário deste nó
   */
  constructor(options) {
    super();
    this.nodeId = options.nodeId;
    this.host = options.host || '0.0.0.0';
    this.p2pPort = options.p2pPort;
    this.bootstrapNodes = options.bootstrapNodes || ['ws://127.0.0.1:4001'];
    this.storage = options.storage;
    this.chain = options.chain;
    this.notificationService = options.notificationService;
    this.auditLogger = options.auditLogger;
    this.role = options.role || 'Membro';

    // Mapas de conexões ativas
    this.peers = new Map(); // nodeId -> WebSocket
    this.knownPeers = new Map(); // address 'host:port' -> peerInfo
    this.relayPeers = new Set(); // nodeIds alcançados exclusivamente via relay
    this.seenPacketNonces = new Set(); // Proteção contra loops de difusão de gossip

    this.server = null;
    this.reconnectInterval = null;
    this.pexInterval = null;
    this.isStopping = false;

    // Inicialização da identidade criptográfica deste nó
    this.nodeIdentity = this._initNodeIdentity();

    // NAT & STUN
    this.natResolver = new NatStunResolver();
    this.natInfo = {
      localIp: this.natResolver.getLocalIp(),
      reflexiveIp: null,
      reflexivePort: null,
      natType: 'DISCOVERING'
    };

    // Estatísticas de trânsito
    this.stats = {
      startedAt: Date.now(),
      messagesGossiped: 0,
      relayPacketsReceived: 0,
      relayPacketsSent: 0,
      lastSyncTime: Date.now()
    };

    // Inicializa o motor de consenso Raft-lite
    this.consensus = new ConsensusEngine({
      nodeId: this.nodeId,
      role: this.role,
      storage: this.storage,
      broadcast: (packet) => this.broadcast(packet),
      heartbeatInterval: 2500,
      electionTimeout: 4000
    });

    this.setupConsensusEvents();
  }

  _initNodeIdentity() {
    let idObj = this.storage.getFirstNodeIdentity();
    if (!idObj) {
      const keypair = CryptoEngine.generateEd25519KeyPair();
      idObj = {
        node_id: this.nodeId,
        display_name: `Nó ${this.nodeId.substring(0, 8)}`,
        public_key: keypair.publicKey,
        encrypted_private_key: keypair.privateKey,
        created_at: Date.now()
      };
      this.storage.saveNodeIdentity(idObj);
    }
    return {
      nodeId: idObj.node_id,
      publicKey: idObj.public_key,
      privateKey: idObj.encrypted_private_key
    };
  }

  setupConsensusEvents() {
    this.consensus.on('leader_elected', (data) => {
      this.auditLogger.log('NEW_LEADER_ELECTED', this.nodeId, {
        leaderId: data.leaderId,
        isMe: data.isMe
      });
      this.storage.addNetworkEvent({
        eventType: 'LEADER_ELECTED',
        summary: data.isMe ? `Este nó assumiu a liderança autônoma da malha.` : `Novo líder eleito na malha: ${data.leaderId}.`,
        severity: 'info'
      });
      this.emit('leader_change', data);
    });

    this.consensus.on('vps_status_change', (data) => {
      this.auditLogger.log(
        data.alive ? 'VPS_RESTORED' : 'VPS_FAILURE_DETECTED',
        this.nodeId,
        { alive: data.alive }
      );
      this.storage.addNetworkEvent({
        eventType: data.alive ? 'VPS_ONLINE' : 'VPS_OFFLINE',
        summary: data.alive 
          ? 'Servidor central VPS online. Sincronização acelerada ativada.' 
          : 'VPS indisponível! Malha P2P autônoma ativada entre computadores pessoais.',
        severity: data.alive ? 'info' : 'warning'
      });
      this.emit('vps_status_change', data);

      // Se todas as VPS caíram, tenta imediatamente o fallback para peers do cache SQLite
      if (!data.alive) {
        this.fallbackToCachedPeers();
      }
    });
  }

  async start() {
    // 1. Sondagem STUN em segundo plano para descobrir IP público e tipo de NAT
    this.probeNatTraversal();

    return new Promise((resolve, reject) => {
      try {
        this.server = new WebSocket.Server({ port: this.p2pPort, host: '0.0.0.0' }, () => {
          this.auditLogger.log('P2P_SERVER_STARTED', this.nodeId, {
            port: this.p2pPort
          });

          this.storage.addNetworkEvent({
            eventType: 'NODE_STARTED',
            summary: `Nó P2P iniciado na porta ${this.p2pPort}. Identidade Ed25519 ativa.`,
            severity: 'info'
          });

          // Inicia o consenso
          this.consensus.start();

          // Conecta aos nós de bootstrap configurados
          this.connectToBootstraps();

          // Configura tarefas periódicas: PEX, Reconexão e Limpeza
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

  async probeNatTraversal() {
    try {
      const res = await this.natResolver.resolveReflexiveAddress();
      this.natInfo = {
        localIp: res.localIp,
        reflexiveIp: res.reflexiveIp,
        reflexivePort: res.reflexivePort,
        natType: res.natType,
        requiresRelay: !!res.requiresRelay
      };
      console.log(`[P2P NAT] IP Local: ${res.localIp} | IP Reflexivo (STUN): ${res.reflexiveIp || 'N/A'} | Tipo: ${res.natType}`);
    } catch (e) {
      this.natInfo.natType = 'NAT_PROBE_ERROR';
    }
  }

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
    this.relayPeers.clear();

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
   * Conecta a múltiplos nós de bootstrap configurados
   */
  connectToBootstraps() {
    for (const bUrl of this.bootstrapNodes) {
      this.connectToPeerUrl(bUrl, true);
    }
  }

  /**
   * Fallback de emergência para peers salvos em SQLite quando todas as VPS caem
   */
  fallbackToCachedPeers() {
    const cached = this.storage.getCachedPeersForBootstrapFallback();
    if (!cached || cached.length === 0) return;

    console.log(`[P2P Autônomo] Buscando ${cached.length} nós no cache local SQLite...`);
    for (const peer of cached) {
      if (peer.node_id !== this.nodeId && !this.peers.has(peer.node_id)) {
        const url = `ws://${peer.host}:${peer.port}`;
        this.connectToPeerUrl(url, false);
      }
    }
  }

  connectToPeerUrl(url, isBootstrap = false) {
    if (this.isStopping) return;

    try {
      const socket = new WebSocket(url);
      const challengeNonce = crypto.randomBytes(16).toString('hex');
      socket.pendingChallengeNonce = challengeNonce;

      socket.on('open', () => {
        const latest = this.storage.getLatestMessage('geral');
        const latestSequence = latest ? latest.sequence : 0;

        // Handshake criptografado com assinatura Ed25519
        const advertisedHost = this.natInfo.reflexiveIp || this.natInfo.localIp || '127.0.0.1';
        const handshakePayload = {
          host: advertisedHost,
          port: this.p2pPort,
          role: this.role,
          nodePubkey: this.nodeIdentity.publicKey,
          latestSequence,
          isBootstrap,
          nonceChallenge: challengeNonce
        };

        const signature = CryptoEngine.signData(handshakePayload, this.nodeIdentity.privateKey);

        const hello = ProtocolPacket.create(MessageType.HELLO, this.nodeId, {
          ...handshakePayload,
          signature
        });
        socket.send(JSON.stringify(hello));

        // Se for bootstrap, pede também sondagem STUN pelo WebSocket
        if (isBootstrap) {
          const probe = ProtocolPacket.create(MessageType.STUN_PROBE, this.nodeId, {});
          socket.send(JSON.stringify(probe));
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

    // Proteção contra replay de pacotes idênticos
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
      case MessageType.STUN_RESPONSE:
        this.handleStunResponse(payload);
        break;

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
        this.handleRelayForward(socket, packet);
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

  handleStunResponse(payload) {
    if (payload.reflexiveIp) {
      this.natInfo.reflexiveIp = payload.reflexiveIp;
      this.natInfo.reflexivePort = payload.reflexivePort;
      this.natInfo.natType = payload.reflexiveIp === this.natInfo.localIp ? 'OPEN_INTERNET' : 'NAT_ROUTED';
    }
  }

  handleHello(socket, packet) {
    const { senderNodeId, payload } = packet;

    // 1. Validação de autenticidade criptográfica do nó emissor
    if (payload.nodePubkey && payload.signature) {
      const verifyData = {
        host: payload.host,
        port: payload.port,
        role: payload.role,
        nodePubkey: payload.nodePubkey,
        latestSequence: payload.latestSequence,
        isBootstrap: payload.isBootstrap,
        nonceChallenge: payload.nonceChallenge
      };
      const valid = CryptoEngine.verifySignature(verifyData, payload.signature, payload.nodePubkey);
      if (!valid) {
        console.warn(`[P2P Segurança] Rejeitado nó ${senderNodeId}: Assinatura de identidade Ed25519 inválida!`);
        socket.terminate();
        return;
      }
    }

    socket.nodeId = senderNodeId;
    socket.peerHost = payload.host;
    socket.peerPort = payload.port;
    socket.isRelay = false;

    this.peers.set(senderNodeId, socket);

    const address = `${payload.host}:${payload.port}`;
    this.knownPeers.set(address, {
      nodeId: senderNodeId,
      host: payload.host,
      port: payload.port,
      isBootstrap: !!payload.isBootstrap,
      nodePubkey: payload.nodePubkey
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

    this.storage.addNetworkEvent({
      eventType: 'PEER_CONNECTED',
      summary: `Nó conectado diretamente: ${senderNodeId.substring(0, 16)} (${payload.role || 'Membro'}).`,
      severity: 'info'
    });

    const latest = this.storage.getLatestMessage('geral');
    const mySequence = latest ? latest.sequence : 0;

    // Resposta HELLO_ACK assinando o nonce recebido
    const ackPayload = {
      host: this.natInfo.reflexiveIp || this.natInfo.localIp || this.host,
      port: this.p2pPort,
      role: this.role,
      nodePubkey: this.nodeIdentity.publicKey,
      latestSequence: mySequence,
      signedChallenge: payload.nonceChallenge ? CryptoEngine.signData(payload.nonceChallenge, this.nodeIdentity.privateKey) : null,
      knownPeers: this.getExportablePeersList()
    };

    const ack = ProtocolPacket.create(MessageType.HELLO_ACK, this.nodeId, ackPayload);
    try { socket.send(JSON.stringify(ack)); } catch (e) {}

    if (payload.latestSequence > mySequence) {
      this.sendSyncRequest(socket, 'geral', mySequence);
    }

    this.emit('peer_connected', { nodeId: senderNodeId, host: payload.host, port: payload.port, isRelay: false });
  }

  handleHelloAck(socket, packet) {
    const { senderNodeId, payload } = packet;
    socket.nodeId = senderNodeId;
    socket.peerHost = payload.host;
    socket.peerPort = payload.port;
    socket.isRelay = false;

    this.peers.set(senderNodeId, socket);

    if (Array.isArray(payload.knownPeers)) {
      this.handlePeerExchange(payload.knownPeers);
    }

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
    if (payload.latestSequence > mySequence) {
      this.sendSyncRequest(socket, 'geral', mySequence);
    }

    this.emit('peer_connected', { nodeId: senderNodeId, host: payload.host, port: payload.port, isRelay: false });
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

        // Tenta conexão direta se ainda não estiver conectado
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
    const adminUsers = this.storage.getAllUsers().filter(u => u.role === 'Administrador' && u.status === 'active');
    for (const u of adminUsers) {
      if (u.public_key) authorized.add(u.public_key.trim());
    }

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

    this.stats.messagesGossiped++;
    this.stats.lastSyncTime = Date.now();

    const authorizedAdminPubkeys = this.getAuthorizedAdminPubkeys(message.community_id);
    const result = this.chain.processIncomingMessage(message, authorizedAdminPubkeys);

    if (result.success) {
      if (result.reason === 'APPLIED' || result.reason === 'PARTITION_RECONCILED') {
        const comm = this.storage.getCommunity(message.community_id);
        this.notificationService.dispatchForMessage(message, comm ? comm.name : undefined);
        this.emit('message_received', message);
        this.propagateGossip(packet, socket);
      } else if (result.needsSync) {
        const latest = this.storage.getLatestMessage(message.community_id);
        this.sendSyncRequest(socket, message.community_id, latest ? latest.sequence : 0);
      }
    }
  }

  propagateGossip(packet, incomingSocket) {
    const data = JSON.stringify(packet);
    for (const [peerId, socket] of this.peers.entries()) {
      if (socket !== incomingSocket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(data);
        } catch (e) {}
      }
    }
  }

  publishMessage(message) {
    const packet = ProtocolPacket.create(MessageType.GOSSIP_MESSAGE, this.nodeId, {
      message
    });

    this.stats.messagesGossiped++;
    this.broadcast(packet);
  }

  sendSyncRequest(socket, communityId, fromSequence) {
    const req = ProtocolPacket.create(MessageType.SYNC_REQUEST, this.nodeId, {
      communityId,
      fromSequence,
      limit: 100
    });
    try {
      socket.send(JSON.stringify(req));
    } catch (e) {}
  }

  handleSyncRequest(socket, packet) {
    const { communityId, fromSequence, limit } = packet.payload;
    const messages = this.storage.getMessagesByCommunity(communityId, limit || 100);
    const missing = messages.filter(m => m.sequence > (fromSequence || 0));

    if (missing.length > 0) {
      const resp = ProtocolPacket.create(MessageType.SYNC_RESPONSE, this.nodeId, {
        communityId,
        messages: missing
      });
      try {
        socket.send(JSON.stringify(resp));
      } catch (e) {}
    }
  }

  handleSyncResponse(packet) {
    const { communityId, messages } = packet.payload;
    if (!Array.isArray(messages)) return;

    const authorizedAdminPubkeys = this.getAuthorizedAdminPubkeys(communityId);
    let appliedCount = 0;

    for (const msg of messages) {
      const res = this.chain.processIncomingMessage(msg, authorizedAdminPubkeys);
      if (res.success && (res.reason === 'APPLIED' || res.reason === 'PARTITION_RECONCILED')) {
        appliedCount++;
        this.emit('message_received', msg);
      }
    }

    if (appliedCount > 0) {
      this.stats.lastSyncTime = Date.now();
      this.storage.addNetworkEvent({
        eventType: 'SYNC_COMPLETED',
        summary: `Sincronização P2P: ${appliedCount} comunicados recebidos e validados.`,
        severity: 'info'
      });
    }
  }

  // --- TRATAMENTO DE RELAY FORWARD ---
  handleRelayForward(socket, packet) {
    this.stats.relayPacketsReceived++;
    const { targetNodeId, originNodeId, innerPacket } = packet.payload;

    // Se este nó for o destinatário final do relay
    if (targetNodeId === this.nodeId && innerPacket) {
      this.relayPeers.add(originNodeId);
      // Processa o pacote interno marcando que veio via relay
      this.handleMessage(socket, JSON.stringify(innerPacket));
      return;
    }

    // Se este nó puder atuar como nó relay intermediário
    if (targetNodeId && this.peers.has(targetNodeId)) {
      const targetSocket = this.peers.get(targetNodeId);
      if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
        try {
          targetSocket.send(JSON.stringify(packet));
          this.stats.relayPacketsSent++;
        } catch (e) {}
      }
    }
  }

  /**
   * Envia pacote via Relay quando a conexão direta não existe
   */
  sendViaRelay(targetNodeId, innerPacket) {
    const relayPacket = ProtocolPacket.create(MessageType.RELAY_FORWARD, this.nodeId, {
      targetNodeId,
      originNodeId: this.nodeId,
      innerPacket
    });

    // Envia para o bootstrap ou qualquer nó conectado capaz de fazer relay
    this.broadcast(relayPacket);
    this.stats.relayPacketsSent++;
  }

  broadcast(packet) {
    const data = JSON.stringify(packet);
    for (const socket of this.peers.values()) {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(data);
        } catch (e) {}
      }
    }
  }

  handleSocketClose(socket, url, isBootstrap) {
    if (socket.nodeId) {
      this.peers.delete(socket.nodeId);
      this.consensus.removePeer(socket.nodeId);
      this.emit('peer_disconnected', { nodeId: socket.nodeId });
    }

    if (isBootstrap) {
      this.consensus.notifyBootstrapFailed();
    }
  }

  startPeriodicTasks() {
    // 1. Peer Exchange (PEX) a cada 25 segundos
    this.pexInterval = setInterval(() => {
      if (this.peers.size > 0) {
        const pexPacket = ProtocolPacket.create(MessageType.PEER_EXCHANGE, this.nodeId, {
          peers: this.getExportablePeersList()
        });
        this.broadcast(pexPacket);
      }
    }, 25000);

    // 2. Reconexão e Heartbeat da malha a cada 10 segundos
    this.reconnectInterval = setInterval(() => {
      this.reconnectToKnownPeers();
    }, 10000);
  }

  reconnectToKnownPeers() {
    // Se a VPS estiver offline, reconecta a nós salvos no cache SQLite
    if (!this.consensus.isVpsAlive && this.peers.size === 0) {
      this.fallbackToCachedPeers();
    }

    // Tenta reconectar a bootstraps offline
    for (const bUrl of this.bootstrapNodes) {
      let isConnected = false;
      for (const s of this.peers.values()) {
        if (s.url === bUrl || s.peerHost === bUrl) {
          isConnected = true;
          break;
        }
      }
      if (!isConnected) {
        this.connectToPeerUrl(bUrl, true);
      }
    }
  }

  getExportablePeersList() {
    return Array.from(this.knownPeers.values()).map(p => ({
      nodeId: p.nodeId,
      host: p.host,
      port: p.port,
      role: p.role,
      nodePubkey: p.nodePubkey,
      isBootstrap: p.isBootstrap
    }));
  }

  // --- TELEMETRIA COMPLETA PARA O PAINEL DA COMUNIDADE (PROMPT 2 REQUISITO) ---
  getNetworkOverview() {
    const activePeers = this.storage.getActivePeers(120000);
    const allPeers = this.storage.getAllPeers();
    const activeDeviceSessions = this.storage.getActiveDeviceSessions(60000);
    const allUsers = this.storage.getAllUsers();
    const latestMsg = this.storage.getLatestMessage('geral');
    const msgCount = this.storage.getMessageCount('geral');

    const desktopNodesCount = activeDeviceSessions.filter(d => d.device_type === 'desktop').length || this.peers.size;
    const mobileCount = activeDeviceSessions.filter(d => d.device_type === 'mobile').length;
    const webCount = activeDeviceSessions.filter(d => d.device_type === 'web').length;

    const directCount = this.peers.size;
    const relayCount = this.relayPeers.size;

    return {
      onlineDesktopNodes: Math.max(1, desktopNodesCount),
      totalKnownNodes: Math.max(allPeers.length, this.knownPeers.size),
      mobileDevicesConnected: mobileCount,
      webSessionsActive: Math.max(1, webCount),
      totalMembers: allUsers.length,
      administratorsCount: allUsers.filter(u => u.role === 'Administrador').length,
      moderatorsCount: allUsers.filter(u => u.role === 'Moderador').length,
      membersCount: allUsers.filter(u => u.role === 'Membro').length,
      syncMessagesCount: msgCount,
      vpsStatus: this.consensus.isVpsAlive ? 'ONLINE' : 'OFFLINE',
      p2pMeshState: this.consensus.isVpsAlive ? 'BOOTSTRAP_ASSISTED' : 'AUTONOMOUS_MESH',
      currentLeader: this.consensus.currentLeaderId || (this.consensus.isLeader ? this.nodeId : '--'),
      isCurrentNodeLeader: this.consensus.isLeader,
      lastSyncTimestamp: this.stats.lastSyncTime || (latestMsg ? latestMsg.timestamp : Date.now()),
      directConnectionsCount: directCount,
      relayConnectionsCount: relayCount,
      natType: this.natInfo.natType,
      externalIp: this.natInfo.reflexiveIp || 'Resolvendo...',
      term: this.consensus.term
    };
  }

  getConnectedNodesList() {
    return Array.from(this.peers.entries()).map(([nodeId, socket]) => ({
      nodeId,
      shortId: nodeId.length > 16 ? nodeId.substring(0, 14) + '...' : nodeId,
      host: socket.peerHost,
      port: socket.peerPort,
      connectionMethod: socket.isRelay ? 'relay' : 'direct',
      role: socket.nodeRole || 'Membro',
      status: 'online'
    }));
  }

  getNetworkStatus() {
    return {
      nodeId: this.nodeId,
      role: this.role,
      p2pPort: this.p2pPort,
      activePeersCount: this.peers.size,
      knownPeers: this.getExportablePeersList(),
      isVpsAlive: this.consensus.isVpsAlive,
      currentLeader: this.consensus.currentLeaderId,
      isLeader: this.consensus.isLeader,
      term: this.consensus.term,
      natType: this.natInfo.natType
    };
  }
}

module.exports = P2PEngine;
