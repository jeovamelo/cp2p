import { CryptoEngine } from '../crypto/keys.js';

export class AuditLogModel {
  static create({
    communityId,
    event,
    actorPublicKey,
    actorPrivateKey,
    target = null,
    details = {}
  }) {
    const timestamp = Date.now();
    const id = `audit_${timestamp}_${Math.random().toString(36).slice(2, 9)}`;

    const canonicalData = `${id}:${communityId}:${event}:${actorPublicKey}:${target || ''}:${timestamp}:${JSON.stringify(details)}`;
    const hash = CryptoEngine.sha256(canonicalData);
    const signature = actorPrivateKey ? CryptoEngine.sign(hash, actorPrivateKey) : null;

    return {
      id,
      communityId,
      event,
      actorPublicKey,
      target,
      details,
      timestamp,
      hash,
      signature
    };
  }

  static verify(auditEntry) {
    if (!auditEntry || !auditEntry.hash) return false;
    const { id, communityId, event, actorPublicKey, target, timestamp, details, hash, signature } = auditEntry;

    const expectedCanonical = `${id}:${communityId}:${event}:${actorPublicKey}:${target || ''}:${timestamp}:${JSON.stringify(details)}`;
    const expectedHash = CryptoEngine.sha256(expectedCanonical);

    if (expectedHash !== hash) return false;
    if (signature && actorPublicKey) {
      return CryptoEngine.verify(hash, signature, actorPublicKey);
    }
    return true;
  }
}
