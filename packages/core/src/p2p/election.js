/**
 * Mecanismo de Eleição de Líder Distribuído (Bully / Raft-Lite)
 * Ativado quando a VPS principal se torna inacessível ou é desligada.
 * Os nós remanescentes elegem autonomamente um novo nó coordenador da malha P2P.
 */

export class LeaderElection {
  constructor({ nodeId, role = 'MEMBER', onLeaderChange = () => {} }) {
    this.nodeId = nodeId;
    this.role = role;
    this.onLeaderChange = onLeaderChange;

    this.startTime = Date.now();
    this.currentLeaderId = null;
    this.isLeader = false;
    this.electionInProgress = false;
    this.electionTimeout = null;
    this.peers = new Map(); // peerId -> { priority, lastSeen }
  }

  /**
   * Calcula a prioridade determinística deste nó.
   * Administradores têm prioridade máxima, seguidos por moderadores e maior uptime.
   */
  getPriority() {
    let roleWeight = 10;
    if (this.role === 'ADMIN') roleWeight = 100;
    if (this.role === 'MODERATOR') roleWeight = 50;

    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    // Combinação de papel, uptime e hash estável
    return (roleWeight * 100000) + uptimeSeconds;
  }

  registerPeer(peerId, role = 'MEMBER', priority = 0) {
    this.peers.set(peerId, { role, priority, lastSeen: Date.now() });
  }

  unregisterPeer(peerId) {
    this.peers.delete(peerId);
    if (this.currentLeaderId === peerId) {
      // Líder caiu! Dispara nova eleição imediatamente
      this.startElection();
    }
  }

  /**
   * Inicia o processo de eleição quando a VPS ou o líder atual fica offline.
   */
  startElection(broadcastVoteFn) {
    if (this.electionInProgress) return;
    this.electionInProgress = true;

    const myPriority = this.getPriority();
    let higherPeerExists = false;

    for (const [peerId, peer] of this.peers.entries()) {
      if (peer.priority > myPriority || (peer.priority === myPriority && peerId < this.nodeId)) {
        higherPeerExists = true;
        break;
      }
    }

    if (!higherPeerExists) {
      // Nenhum par conhecido tem prioridade maior. Este nó declara vitória!
      this._claimLeadership(broadcastVoteFn);
    } else {
      // Notifica pares com mensagem de eleição e aguarda resposta
      if (broadcastVoteFn) {
        broadcastVoteFn({
          type: 'ELECTION_START',
          candidateId: this.nodeId,
          priority: myPriority
        });
      }

      // Aguarda 2 segundos para declaração de vitória de nó com maior prioridade
      clearTimeout(this.electionTimeout);
      this.electionTimeout = setTimeout(() => {
        if (!this.currentLeaderId || this.currentLeaderId === this.nodeId) {
          this._claimLeadership(broadcastVoteFn);
        }
        this.electionInProgress = false;
      }, 2000);
    }
  }

  _claimLeadership(broadcastVoteFn) {
    this.isLeader = true;
    this.currentLeaderId = this.nodeId;
    this.electionInProgress = false;

    if (broadcastVoteFn) {
      broadcastVoteFn({
        type: 'ELECTION_VICTORY',
        leaderId: this.nodeId,
        priority: this.getPriority(),
        timestamp: Date.now()
      });
    }

    this.onLeaderChange({
      leaderId: this.nodeId,
      isSelf: true,
      timestamp: Date.now()
    });
  }

  handleElectionMessage(msg, broadcastVoteFn) {
    if (msg.type === 'ELECTION_START') {
      const myPriority = this.getPriority();
      if (myPriority > msg.priority || (myPriority === msg.priority && this.nodeId < msg.candidateId)) {
        // Responde que este nó tem maior prioridade e assume
        this._claimLeadership(broadcastVoteFn);
      }
    } else if (msg.type === 'ELECTION_VICTORY') {
      this.currentLeaderId = msg.leaderId;
      this.isLeader = (msg.leaderId === this.nodeId);
      this.electionInProgress = false;
      clearTimeout(this.electionTimeout);

      this.onLeaderChange({
        leaderId: msg.leaderId,
        isSelf: this.isLeader,
        timestamp: msg.timestamp
      });
    }
  }
}
