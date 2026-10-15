import { WebSocket } from 'ws';
import { MessageModel } from '../model/message.js';
import { LeaderElection } from './election.js';

/**
 * Motor de Fofoca Epidêmica (Gossip Mesh Protocol) e Sincronização Anti-Entropia
 * Permite que múltiplos nós troquem mensagens assinadas de forma descentralizada.
 */

export class GossipMesh {
  constructor({
    nodeId,
    displayName,
    role = 'MEMBER',
    publicKey,
    privateKey = null,
    db,
    p2pPort = null,
    bootstrapNodes = [],
    onMessageReceived = () => {},
    onPeerStatusChange = () => {},
    onLeaderElected = () => {}
  }) {
    this.nodeId = nodeId;
    this.displayName = displayName || nodeId;
    this.role = role;
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.db = db;
    this.p2pPort = p2pPort;
    this.bootstrapNodes = bootstrapNodes;

    this.onMessageReceived = onMessageReceived;
    this.onPeerStatusChange = onPeerStatusChange;
    this.onLeaderElected = onLeaderElected;

    this.peers = new Map(); // peerId -> { ws, role, address, latency, lastSeen, isBootstrap }
    this.processedMessageHashes = new Set();
    this.vpsOnline = false;
    this.heartbeatInterval = null;

    // Inicializa eleição de líder
    this.election = new LeaderElection({
      nodeId: this.nodeId,
      role: this.role,
      onLeaderChange: (leaderInfo) => {
        this.onLeaderElected(leaderInfo);
      }
    });

    // Carrega mensagens do banco para o cache de anti-duplicação
    const allCommunities = this.db.getAllCommunities();
    for (const comm of allCommunities) {
      const msgs = this.db.getMessagesByCommunity(comm.id);
      for (const m of msgs) {
        this.processedMessageHashes.add(m.hash);
        this.processedMessageHashes.add(m.id);
      }
    }
  }

  /**
   * Conecta um WebSocket já aberto de um par (seja cliente ou servidor).
   */
  addPeerConnection(peerId, ws, { role = 'MEMBER', address = '', isBootstrap = false } = {}) {
    if (this.peers.has(peerId)) {
      try { this.peers.get(peerId).ws.close(); } catch {}
    }

    const peerInfo = {
      peerId,
      ws,
      role,
      address,
      latency: 0,
      lastSeen: Date.now(),
      isBootstrap,
      connectedAt: Date.now()
    };

    this.peers.set(peerId, peerInfo);
    this.election.registerPeer(peerId, role);

    if (isBootstrap) {
      this.vpsOnline = true;
    }

    // Configura listeners no socket
    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        this._handlePeerPacket(peerId, parsed);
      } catch (err) {
        console.error(`[GossipMesh] Erro ao decodificar pacote de ${peerId}:`, err.message);
      }
    });

    ws.on('close', () => {
      this._handlePeerDisconnect(peerId);
    });

    ws.on('error', (err) => {
      this._handlePeerDisconnect(peerId);
    });

    // Envia Handshake imediato
    this.sendToPeer(peerId, {
      type: 'HANDSHAKE',
      nodeId: this.nodeId,
      displayName: this.displayName,
      role: this.role,
      publicKey: this.publicKey,
      p2pPort: this.p2pPort,
      timestamp: Date.now()
    });

    // Dispara troca de vetores de estado para sincronizar mensagens pendentes
    this.requestAntiEntropySync(peerId);

    // Compartilha pares conhecidos (Peer Exchange - PEX)
    this.broadcastPeerExchange();

    this.onPeerStatusChange(this.getNetworkState());
  }

  /**
   * Conecta ativamente a um endereço de nó (WebSocket URL).
   */
  connectToAddress(url, isBootstrap = false) {
    try {
      const ws = new WebSocket(url);
      const tempId = `temp_${Math.random().toString(36).slice(2, 7)}`;

      ws.on('open', () => {
        // Envia handshake inicial com o ID temporário até confirmação mútua
        ws.send(JSON.stringify({
          type: 'HANDSHAKE',
          nodeId: this.nodeId,
          displayName: this.displayName,
          role: this.role,
          publicKey: this.publicKey,
          p2pPort: this.p2pPort,
          timestamp: Date.now()
        }));
      });

      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'HANDSHAKE' && parsed.nodeId) {
            this.addPeerConnection(parsed.nodeId, ws, {
              role: parsed.role,
              address: url,
              isBootstrap
            });
          } else {
            this._handlePeerPacket(tempId, parsed);
          }
        } catch {}
      });

      ws.on('error', () => {
        if (isBootstrap) {
          this._handleVpsFailure();
        }
      });

      ws.on('close', () => {
        if (isBootstrap) {
          this._handleVpsFailure();
        }
      });
    } catch (err) {
      if (isBootstrap) {
        this._handleVpsFailure();
      }
    }
  }

  /**
   * Tratamento de falha ou queda da VPS Bootstrap.
   */
  _handleVpsFailure() {
    if (this.vpsOnline) {
      console.warn(`[GossipMesh] ALERTA: VPS Bootstrap ficou OFFLINE! Iniciando modo de sobrevivência mesh...`);
      this.vpsOnline = false;

      // Dispara eleição de líder entre os nós sobreviventes
      this.election.startElection((voteMsg) => {
        this.broadcast(voteMsg);
      });

      this.onPeerStatusChange(this.getNetworkState());
    }
  }

  _handlePeerDisconnect(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    if (peer.isBootstrap) {
      this._handleVpsFailure();
    }

    this.peers.delete(peerId);
    this.election.unregisterPeer(peerId);
    this.onPeerStatusChange(this.getNetworkState());
  }

  sendToPeer(peerId, packet) {
    const peer = this.peers.get(peerId);
    if (peer && peer.ws.readyState === WebSocket.OPEN) {
      try {
        peer.ws.send(JSON.stringify(packet));
      } catch {}
    }
  }

  /**
   * Disseminação epidêmica (Gossip Broadcast) para todos os nós conectados.
   */
  broadcast(packet, excludePeerId = null) {
    const data = JSON.stringify(packet);
    for (const [peerId, peer] of this.peers.entries()) {
      if (peerId !== excludePeerId && peer.ws.readyState === WebSocket.OPEN) {
        try {
          peer.ws.send(data);
        } catch {}
      }
    }
  }

  /**
   * Publica e dissemina uma nova mensagem assinada pela malha P2P.
   */
  publishMessage(message) {
    // 1. Armazena no banco local
    this.db.saveMessage(message);
    this.processedMessageHashes.add(message.hash);
    this.processedMessageHashes.add(message.id);

    // 2. Fofoca epidêmica para todos os pares conectados
    this.broadcast({
      type: 'GOSSIP_MESSAGE',
      message
    });

    this.onMessageReceived(message, { fromSelf: true });
    return message;
  }

  /**
   * Processa pacotes recebidos pela rede P2P.
   */
  _handlePeerPacket(fromPeerId, packet) {
    if (!packet || !packet.type) return;

    switch (packet.type) {
      case 'HANDSHAKE': {
        const peer = this.peers.get(fromPeerId);
        if (peer) {
          peer.role = packet.role || peer.role;
          peer.displayName = packet.displayName || packet.nodeId;
          this.election.registerPeer(fromPeerId, peer.role);
          this.onPeerStatusChange(this.getNetworkState());
        }
        break;
      }

      case 'HEARTBEAT_PING': {
        this.sendToPeer(fromPeerId, {
          type: 'HEARTBEAT_PONG',
          clientTime: packet.timestamp,
          serverTime: Date.now()
        });
        break;
      }

      case 'HEARTBEAT_PONG': {
        const peer = this.peers.get(fromPeerId);
        if (peer && packet.clientTime) {
          peer.latency = Date.now() - packet.clientTime;
          peer.lastSeen = Date.now();
        }
        break;
      }

      case 'GOSSIP_MESSAGE': {
        const { message } = packet;
        if (!message || !message.hash) return;

        // Se já processou essa mensagem, ignora para quebrar loops (anti-duplicação)
        if (this.processedMessageHashes.has(message.hash) || this.processedMessageHashes.has(message.id)) {
          return;
        }

        // Valida criptograficamente a mensagem (Ed25519 e regras de autorização)
        const community = this.db.getCommunity(message.communityId);
        const validation = MessageModel.validate(message, community, this.processedMessageHashes);

        if (!validation.valid) {
          console.warn(`[GossipMesh] Mensagem rejeitada de ${fromPeerId}:`, validation.error);
          return;
        }

        // Registra hash para evitar re-processamento
        this.processedMessageHashes.add(message.hash);
        this.processedMessageHashes.add(message.id);

        // Salva duravelmente no SQLite local
        this.db.saveMessage(message);

        // Re-transmite a mensagem para outros pares (Epidemic Relay)
        this.broadcast(packet, fromPeerId);

        // Dispara callback para a interface
        this.onMessageReceived(message, { fromPeerId });
        break;
      }

      case 'STATE_VECTOR_SYNC': {
        // O par nos enviou sua lista de comunidades e sequências máximas
        const { vectors } = packet;
        if (Array.isArray(vectors)) {
          for (const remoteVec of vectors) {
            const localVec = this.db.getCommunityStateVector(remoteVec.communityId);
            // Se o par possui mensagens que não temos, pedimos a ele
            if (remoteVec.maxSequence > localVec.maxSequence) {
              this.sendToPeer(fromPeerId, {
                type: 'REQUEST_MESSAGES',
                communityId: remoteVec.communityId,
                fromSequence: localVec.maxSequence + 1
              });
            }
            // Se nós temos mensagens que o par não tem, enviamos a ele proativamente
            if (localVec.maxSequence > remoteVec.maxSequence) {
              const missingMsgs = this.db.getMessagesByCommunity(remoteVec.communityId)
                .filter(m => m.sequence > remoteVec.maxSequence);

              for (const m of missingMsgs) {
                this.sendToPeer(fromPeerId, {
                  type: 'GOSSIP_MESSAGE',
                  message: m
                });
              }
            }
          }
        }
        break;
      }

      case 'REQUEST_MESSAGES': {
        const { communityId, fromSequence } = packet;
        const msgs = this.db.getMessagesByCommunity(communityId)
          .filter(m => m.sequence >= (fromSequence || 1));

        for (const m of msgs) {
          this.sendToPeer(fromPeerId, {
            type: 'GOSSIP_MESSAGE',
            message: m
          });
        }
        break;
      }

      case 'PEER_EXCHANGE': {
        const { knownAddresses } = packet;
        if (Array.isArray(knownAddresses)) {
          for (const addr of knownAddresses) {
            // Se não estamos conectados a esse endereço, tenta conexão P2P direta
            const isAlreadyConnected = Array.from(this.peers.values()).some(p => p.address === addr);
            if (!isAlreadyConnected && addr !== `ws://localhost:${this.p2pPort}`) {
              this.connectToAddress(addr, false);
            }
          }
        }
        break;
      }

      case 'ELECTION_START':
      case 'ELECTION_VICTORY': {
        this.election.handleElectionMessage(packet, (voteMsg) => {
          this.broadcast(voteMsg);
        });
        break;
      }
    }
  }

  requestAntiEntropySync(peerId) {
    const communities = this.db.getAllCommunities();
    const vectors = communities.map(c => this.db.getCommunityStateVector(c.id));

    this.sendToPeer(peerId, {
      type: 'STATE_VECTOR_SYNC',
      vectors
    });
  }

  broadcastPeerExchange() {
    const knownAddresses = [];
    if (this.p2pPort) {
      knownAddresses.push(`ws://localhost:${this.p2pPort}`);
    }
    for (const peer of this.peers.values()) {
      if (peer.address && !peer.isBootstrap) {
        knownAddresses.push(peer.address);
      }
    }

    this.broadcast({
      type: 'PEER_EXCHANGE',
      knownAddresses
    });
  }

  startHeartbeats(intervalMs = 3000) {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [peerId, peer] of this.peers.entries()) {
        if (now - peer.lastSeen > intervalMs * 3) {
          // Timeout de inatividade
          this._handlePeerDisconnect(peerId);
        } else {
          this.sendToPeer(peerId, {
            type: 'HEARTBEAT_PING',
            timestamp: now
          });
        }
      }
    }, intervalMs);
  }

  getNetworkState() {
    const peerList = Array.from(this.peers.entries()).map(([id, p]) => ({
      peerId: id,
      displayName: p.displayName || id,
      role: p.role,
      address: p.address,
      latency: p.latency,
      isBootstrap: p.isBootstrap,
      uptime: Date.now() - p.connectedAt
    }));

    return {
      nodeId: this.nodeId,
      displayName: this.displayName,
      role: this.role,
      vpsOnline: this.vpsOnline,
      peerCount: this.peers.size,
      peers: peerList,
      leaderId: this.election.currentLeaderId,
      isLeader: this.election.isLeader,
      electionInProgress: this.election.electionInProgress
    };
  }

  destroy() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    for (const peer of this.peers.values()) {
      try { peer.ws.close(); } catch {}
    }
    this.peers.clear();
  }
}
