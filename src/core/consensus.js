/**
 * Comunidade Resiliente - Módulo de Consenso e Eleição de Líder Dinâmico (Raft-lite)
 * Coordena relay, sincronização e resiliência quando a VPS cai.
 *
 * Características essenciais:
 * - Termo/época de eleição persistido em SQLite (anti-regressão de termo)
 * - Voto único por termo (previne múltiplos líderes no mesmo termo)
 * - Heartbeats periódicos com jitter aleatório para evitar voto dividido
 * - Quórum de maioria estrito baseado em pares vivos
 * - Resolução determinística de split-brain
 * - O líder NÃO tem poder para forjar mensagens: apenas coordena sincronização e relay.
 */

const EventEmitter = require('events');
const { MessageType, ProtocolPacket } = require('../common/protocol');

class ConsensusEngine extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.nodeId - Identificador único deste nó
   * @param {string} [options.role='Membro'] - 'Administrador', 'Moderador' ou 'Membro'
   * @param {function} options.broadcast - Função de envio de pacotes P2P
   * @param {import('./storage')} [options.storage] - Gerenciador de armazenamento SQLite para persistência do termo
   * @param {number} [options.heartbeatInterval=2500] - Intervalo de heartbeat em ms
   * @param {number} [options.electionTimeout=4000] - Base do timeout de eleição
   */
  constructor(options) {
    super();
    this.nodeId = options.nodeId;
    this.role = options.role || 'Membro';
    this.broadcast = options.broadcast;
    this.storage = options.storage || null;
    this.heartbeatInterval = options.heartbeatInterval || 2500;
    this.electionTimeout = options.electionTimeout || 4000;

    // Recupera termo persistido ou inicia em 1
    const savedTerm = this.storage ? parseInt(this.storage.getConsensusState('raft_term') || '1', 10) : 1;
    this.term = isNaN(savedTerm) ? 1 : savedTerm;

    const savedVotedFor = this.storage ? this.storage.getConsensusState('raft_voted_for') : null;
    this.votedFor = savedVotedFor || null;

    this.currentLeaderId = null;
    this.isLeader = false;
    this.isVpsAlive = true;
    this.votesReceived = new Set();
    this.electionTimer = null;
    this.heartbeatTimer = null;
    this.lastLeaderHeartbeat = Date.now();
    this.peersAlive = new Map(); // nodeId -> { role, isBootstrap, lastSeen }
  }

  start() {
    this.resetElectionTimer();
  }

  stop() {
    if (this.electionTimer) clearTimeout(this.electionTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  persistState() {
    if (this.storage) {
      try {
        this.storage.setConsensusState('raft_term', this.term);
        this.storage.setConsensusState('raft_voted_for', this.votedFor || '');
      } catch (e) {}
    }
  }

  /**
   * Prioridade de liderança (Administradores lideram a coordenação com prioridade)
   */
  getPriority(latestSequence = 0) {
    let base = 10;
    if (this.role === 'Administrador') base = 100;
    else if (this.role === 'Moderador') base = 50;
    return base + latestSequence * 10;
  }

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

  removePeer(peerId) {
    this.peersAlive.delete(peerId);
  }

  notifyBootstrapFailed() {
    this.isVpsAlive = false;
    this.emit('vps_status_change', { alive: false });

    // Dispara eleição autônoma quando o coordenador central VPS é perdido
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

    // Timeout aleatório com jitter (ex: 4000ms a 6500ms) para desempate natural
    const jitter = Math.floor(Math.random() * 2500);
    const timeout = this.electionTimeout + jitter;

    this.electionTimer = setTimeout(() => {
      this.handleElectionTimeout();
    }, timeout);
  }

  handleElectionTimeout() {
    const elapsed = Date.now() - this.lastLeaderHeartbeat;
    if (elapsed > this.electionTimeout && !this.isLeader) {
      this.startElection();
    } else {
      this.resetElectionTimer();
    }
  }

  /**
   * Inicia processo de eleição para o próximo termo
   */
  startElection(latestSequence = 0) {
    this.term += 1;
    this.votedFor = this.nodeId; // Vota em si mesmo para este termo
    this.persistState();

    this.votesReceived.clear();
    this.votesReceived.add(this.nodeId);

    const priority = this.getPriority(latestSequence);

    const callPacket = ProtocolPacket.create(MessageType.ELECTION_CALL, this.nodeId, {
      term: this.term,
      candidateId: this.nodeId,
      priority,
      latestSequence
    });

    this.broadcast(callPacket);
    this.resetElectionTimer();

    this.checkElectionOutcome();
  }

  /**
   * Processa pacotes de consenso
   */
  handleProtocolPacket(packet, latestSequence = 0) {
    const { type, senderNodeId, payload } = packet;

    // 1. Heartbeat do Líder
    if (type === MessageType.HEARTBEAT) {
      if (payload.isLeader) {
        if (payload.term > this.term) {
          this.term = payload.term;
          this.votedFor = null;
          this.persistState();
          this.stepDown();
        }

        if (payload.term >= this.term) {
          this.currentLeaderId = senderNodeId;
          this.lastLeaderHeartbeat = Date.now();
          this.resetElectionTimer();

          // Resolução de split-brain (dois líderes simultâneos)
          if (this.isLeader && senderNodeId !== this.nodeId) {
            const myPriority = this.getPriority(latestSequence);
            if (payload.priority > myPriority || (payload.priority === myPriority && senderNodeId > this.nodeId)) {
              this.stepDown();
            }
          }
        }
      }
      return;
    }

    // 2. Pedido de Voto (ELECTION_CALL)
    if (type === MessageType.ELECTION_CALL) {
      const candidateTerm = payload.term;
      const candidatePriority = payload.priority;
      const myPriority = this.getPriority(latestSequence);

      if (candidateTerm > this.term) {
        this.term = candidateTerm;
        this.votedFor = null;
        this.persistState();
        this.stepDown();
      }

      // Regra Raft: Vota apenas uma vez por termo E se a prioridade do candidato for superior ou idêntica
      const canVote = (this.votedFor === null || this.votedFor === payload.candidateId) &&
        (candidatePriority > myPriority || (candidatePriority === myPriority && payload.candidateId >= this.nodeId));

      if (canVote && candidateTerm === this.term) {
        this.votedFor = payload.candidateId;
        this.persistState();

        const votePacket = ProtocolPacket.create(MessageType.ELECTION_VOTE, this.nodeId, {
          term: this.term,
          candidateId: payload.candidateId,
          voterId: this.nodeId,
          granted: true
        });
        this.broadcast(votePacket);
        this.lastLeaderHeartbeat = Date.now();
        this.resetElectionTimer();
      }
      return;
    }

    // 3. Resposta de Voto (ELECTION_VOTE)
    if (type === MessageType.ELECTION_VOTE) {
      if (payload.candidateId === this.nodeId && payload.term === this.term && payload.granted) {
        this.votesReceived.add(payload.voterId);
        this.checkElectionOutcome();
      }
      return;
    }

    // 4. Proclamação de Vitória (ELECTION_DECLARE)
    if (type === MessageType.ELECTION_DECLARE) {
      if (payload.term >= this.term) {
        this.term = payload.term;
        this.currentLeaderId = payload.leaderId;
        this.lastLeaderHeartbeat = Date.now();
        this.persistState();

        if (payload.leaderId !== this.nodeId) {
          this.stepDown();
        }

        this.emit('leader_elected', { leaderId: this.currentLeaderId, isMe: this.isLeader });
        this.resetElectionTimer();
      }
    }
  }

  checkElectionOutcome() {
    // Quórum de maioria estrito: ceil((peers + 1) / 2)
    const activePeerCount = Math.max(1, this.peersAlive.size + 1);
    const requiredMajority = Math.floor(activePeerCount / 2) + 1;

    if (this.votesReceived.size >= requiredMajority && !this.isLeader) {
      this.becomeLeader();
    }
  }

  becomeLeader() {
    this.isLeader = true;
    this.currentLeaderId = this.nodeId;
    this.lastLeaderHeartbeat = Date.now();

    const declarePacket = ProtocolPacket.create(MessageType.ELECTION_DECLARE, this.nodeId, {
      term: this.term,
      leaderId: this.nodeId
    });
    this.broadcast(declarePacket);

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
