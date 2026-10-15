/**
 * Comunidade Resiliente - Módulo de Auditoria Criptográfica
 * Registra eventos administrativos e de segurança em uma cadeia imutável encadeada por hash SHA-256
 */

const CryptoEngine = require('../common/crypto');

class AuditLogger {
  /**
   * @param {import('./storage')} storageManager
   */
  constructor(storageManager) {
    this.storage = storageManager;
  }

  /**
   * Registra um evento de auditoria
   * @param {string} action - Código da ação
   * @param {string} actorPubkey - Chave pública de quem realizou a ação
   * @param {object|string} details - Detalhes do evento
   * @param {string} [signature=null] - Assinatura Ed25519 do autor da ação (quando aplicável)
   * @returns {string} Hash SHA-256 do registro
   */
  log(action, actorPubkey, details, signature = null) {
    return this.storage.appendAuditLog(action, actorPubkey, details, signature);
  }

  /**
   * Valida a integridade matemática de toda a cadeia de auditoria
   * @returns {{ valid: boolean, totalLogs: number, corruptedAt?: number }}
   */
  verifyChainIntegrity() {
    const logs = this.storage.getAuditLogs(1000); // Ordem decrescente
    if (logs.length === 0) return { valid: true, totalLogs: 0 };

    // Inverte para validar do primeiro ao último
    const chronological = [...logs].reverse();
    let expectedPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';

    for (let i = 0; i < chronological.length; i++) {
      const log = chronological[i];
      if (log.prev_audit_hash !== expectedPrevHash) {
        return { valid: false, totalLogs: logs.length, corruptedAt: log.id };
      }

      const calculatedHash = CryptoEngine.sha256({
        timestamp: log.timestamp,
        action: log.action,
        actorPubkey: log.actor_pubkey,
        detailsStr: log.details,
        prevHash: log.prev_audit_hash
      });

      if (calculatedHash !== log.audit_hash) {
        return { valid: false, totalLogs: logs.length, corruptedAt: log.id };
      }

      expectedPrevHash = log.audit_hash;
    }

    return { valid: true, totalLogs: logs.length };
  }

  getRecentLogs(limit = 50) {
    return this.storage.getAuditLogs(limit);
  }
}

module.exports = AuditLogger;
