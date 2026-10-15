/**
 * Comunidade Resiliente - Módulo de Consenso e Eleição de Líder Dinâmico
 * Permite que a rede P2P continue operando e eleja um nó coordenador/relay quando a VPS cai
 */

const EventEmitter = require('events');
const { MessageType, ProtocolPacket } = require('../common/protocol');

class ConsensusEngine extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.nodeId - Identificador único deste nó
   * @param {string} options.role - Papel do usuário deste nó ('Administrador', 'Moderador', 'Membro')
   * @param {function} options.broadcast - Função de envio de pacote para todos os peers conectados
   * @param {number} [options.heartbeatInterval=3000] - Intervalo de heartbeat em ms
   * @param {number} [options.electionTimeout=5000] - Tempo limite para detectar ausência de líder
   */
  constructor(options) {
    super();
    this.nodeId = options.nodeId;
    this.role = options.role || 'Membro';
    this.broadcast = options.broadcast;
    this.heartbeatInterval = options.heartbeatInterval || 3000;
    this.electionTimeout = options.electionTimeout || 5000;

    this.currentLeaderId = null;
    this.isLeader = false;
    this.isVpsAlive = true;
    this.term = 1;
    this.votesReceived = new Set();
    this.electionTimer = null;
    this.heartbeatTimer = null;
    this.lastLeaderHeartbeat = Date.now();
    this.peersAlive = new Map(); // nodeId -> { role, priority, lastSeen }
  }

  start() {
    this.resetElectionTimer();
  }

  stop() {
    if (this.electionTimer) clearTimeout(this.electionTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  /**
   * Calcula a prioridade deste nó na eleição
   * Administradores têm maior prioridade, seguidos por moderadores e nós com maior ID
   */
  getPriority(latestSequence = 0) {
    let base = 10;
    if (this.role === 'Administrador') base = 100;
    else if (this.role === 'Moderador') base = 50;
    return base + latestSequence * 10;
  }

  /**
   * Registra a presença de um peer e seu status
   */
  recordPeerSeen(peerId, role = 'Membro', isBootstrap = false) {
    this.peersAlive.set(peerId, {
      role,
      isBootstrap,
      lastSeen: Date.now()
    });

    if (isBootstrap) {
      this.isVpsAlive = true;
    }
  }

  /**
   * Notifica que a conexão com a VPS/Bootstrap falhou
   */
  notifyBootstrapFailed() {
    this.isVpsAlive = false;
    this.emit('vps_status_change', { alive: false });
    // Se a VPS caiu e era o líder/coordenador, dispara imediatamente a eleição
    if (!this.isLeader && (!this.currentLeaderId || this.currentLeaderId.includes('vps') || this.currentLeaderId.includes('bootstrap'))) {
      this.startElection();
    }
  }

  notifyBootstrapRestored(bootstrapId) {
    this.isVpsAlive = true;
    this.emit('vps_status_change', { alive: true });
    this.recordPeerSeen(bootstrapId, 'VPS_Bootstrap', true);
  }

  resetElectionTimer() {
    if (this.electionTimer) clearTimeout(this.electionTimer);
    // Timeout aleatório entre electionTimeout e 1.5 * electionTimeout para evitar votos simultâneos divididos
    const timeout = this.electionTimeout + Math.floor(Math.random() * 2000);
    this.electionTimer = setTimeout(() => {
      this.handleElectionTimeout();
    }, timeout);
  }

  handleElectionTimeout() {
    // Se o líder atual parou de enviar batimentos cardíacos, inicia eleição
    const elapsed = Date.now() - this.lastLeaderHeartbeat;
    if (elapsed > this.electionTimeout && !this.isLeader) {
      this.startElection();
    } else {
      this.resetElectionTimer();
    }
  }

  /**
   * Inicia um processo de eleição de novo líder entre os nós online
   */
  startElection(latestSequence = 0) {
    this.term += 1;
    this.votesReceived.clear();
    this.votesReceived.add(this.nodeId); // Vota em si mesmo

    const priority = this.getPriority(latestSequence);

    const callPacket = ProtocolPacket.create(MessageType.ELECTION_CALL, this.nodeId, {
      term: this.term,
      candidateId: this.nodeId,
      priority,
      latestSequence
    });

    this.broadcast(callPacket);
    this.resetElectionTimer();

    // Se estiver isolado ou com quórum unitário, assume a liderança
    this.checkElectionOutcome();
  }

  /**
   * Processa pacotes de eleição recebidos da rede P2P
   */
  handleProtocolPacket(packet, latestSequence = 0) {
    const { type, senderNodeId, payload } = packet;

    if (type === MessageType.HEARTBEAT) {
      if (payload.isLeader) {
        this.currentLeaderId = senderNodeId;
        this.lastLeaderHeartbeat = Date.now();
        if (this.isLeader && senderNodeId !== this.nodeId) {
          // Desempate de split-brain: se o outro nó tem prioridade maior, abdica
          if (payload.priority > this.getPriority(latestSequence)) {
            this.stepDown();
          }
        }
      }
      return;
    }

    if (type === MessageType.ELECTION_CALL) {
      const candidatePriority = payload.priority;
      const myPriority = this.getPriority(latestSequence);

      // Concede o voto se o candidato tiver prioridade maior ou igual (com desempate pelo ID do nó)
      const grantVote = candidatePriority > myPriority || 
        (candidatePriority === myPriority && payload.candidateId > this.nodeId);

      if (grantVote) {
        const votePacket = ProtocolPacket.create(MessageType.ELECTION_VOTE, this.nodeId, {
          term: payload.term,
          candidateId: payload.candidateId,
          voterId: this.nodeId,
          granted: true
        });
        this.broadcast(votePacket);
        this.resetElectionTimer();
      }
      return;
    }

    if (type === MessageType.ELECTION_VOTE) {
      if (payload.candidateId === this.nodeId && payload.granted) {
        this.votesReceived.add(payload.voterId);
        this.checkElectionOutcome();
      }
      return;
    }

    if (type === MessageType.ELECTION_DECLARE) {
      this.term = payload.term;
      this.currentLeaderId = payload.leaderId;
      this.lastLeaderHeartbeat = Date.now();
      if (payload.leaderId !== this.nodeId) {
        this.stepDown();
      }
      this.emit('leader_elected', { leaderId: this.currentLeaderId, isMe: this.isLeader });
      this.resetElectionTimer();
      return;
    }
  }

  checkElectionOutcome() {
    // Quórum simples: votos da maioria dos peers ativos conhecidos
    const activePeerCount = Math.max(1, this.peersAlive.size);
    const requiredVotes = Math.floor(activePeerCount / 2) + 1;

    if (this.votesReceived.size >= requiredVotes && !this.isLeader) {
      this.becomeLeader();
    }
  }

  becomeLeader() {
    this.isLeader = true;
    this.currentLeaderId = this.nodeId;
    this.lastLeaderHeartbeat = Date.now();

    // Notifica toda a rede que assumiu a liderança
    const declarePacket = ProtocolPacket.create(MessageType.ELECTION_DECLARE, this.nodeId, {
      term: this.term,
      leaderId: this.nodeId
    });
    this.broadcast(declarePacket);

    // Inicia envio periódico de Heartbeats como Líder
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.sendLeaderHeartbeat();
    }, this.heartbeatInterval);

    this.emit('leader_elected', { leaderId: this.nodeId, isMe: true });
  }

  stepDown() {
    this.isLeader = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  sendLeaderHeartbeat() {
    if (!this.isLeader) return;
    const heartbeat = ProtocolPacket.create(MessageType.HEARTBEAT, this.nodeId, {
      isLeader: true,
      term: this.term,
      priority: this.getPriority()
    });
    this.broadcast(heartbeat);
  }
}

module.exports = ConsensusEngine;
