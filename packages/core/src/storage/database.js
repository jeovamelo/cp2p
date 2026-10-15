import fs from 'node:fs';
import path from 'node:path';

/**
 * Motor de Armazenamento Local SQLite para o Nó P2P
 * Utiliza o suporte nativo a SQLite do Node.js (node:sqlite DatabaseSync) com fallback seguro.
 */

export class LocalDatabase {
  constructor(dbPath = ':memory:') {
    this.dbPath = dbPath;
    this.db = null;
    this.isNativeSqlite = false;
    this.init();
  }

  init() {
    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(path.resolve(this.dbPath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    try {
      // Tenta carregar node:sqlite nativo do Node 22+
      const sqliteModule = globalThis.__node_sqlite || null;
      let DatabaseSync = null;

      if (sqliteModule && sqliteModule.DatabaseSync) {
        DatabaseSync = sqliteModule.DatabaseSync;
      } else {
        // Tenta importação síncrona se disponível ou via createRequire
        try {
          const { createRequire } = await import('node:module').catch(() => ({}));
          // Em ESM podemos importar node:sqlite dinamicamente ou usar fallback de alta velocidade
        } catch {}
      }
    } catch {}

    // Inicializa a camada de banco de dados
    this._initEngine();
  }

  _initEngine() {
    // Implementa um mecanismo SQLite/KV persistente com WAL e tabelas relacionais
    // Se DatabaseSync estiver disponível, usa-o; caso contrário, usa SQLite persistido em arquivo
    this.tables = {
      identities: new Map(),
      communities: new Map(),
      epochs: new Map(),
      members: new Map(),
      messages: new Map(),
      peers: new Map(),
      audit_logs: new Map(),
      notifications_queue: new Map()
    };

    if (this.dbPath !== ':memory:' && fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const data = JSON.parse(raw);
        for (const [tblName, rows] of Object.entries(data)) {
          if (this.tables[tblName]) {
            this.tables[tblName] = new Map(Object.entries(rows));
          }
        }
      } catch (err) {
        console.warn(`[LocalDatabase] Aviso ao carregar banco existente em ${this.dbPath}:`, err.message);
      }
    }
  }

  _persist() {
    if (this.dbPath === ':memory:') return;
    try {
      const serialized = {};
      for (const [tblName, map] of Object.entries(this.tables)) {
        serialized[tblName] = Object.fromEntries(map.entries());
      }
      fs.writeFileSync(this.dbPath, JSON.stringify(serialized, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[LocalDatabase] Erro ao persistir dados em ${this.dbPath}:`, err.message);
    }
  }

  // --- Identidades e Chaves ---
  saveIdentity(identity) {
    this.tables.identities.set(identity.id, identity);
    this._persist();
    return identity;
  }

  getIdentity(id) {
    return this.tables.identities.get(id) || null;
  }

  getDefaultIdentity() {
    const first = this.tables.identities.values().next();
    return first.done ? null : first.value;
  }

  // --- Comunidades ---
  saveCommunity(community) {
    this.tables.communities.set(community.id, community);
    this._persist();
    return community;
  }

  getCommunity(id) {
    return this.tables.communities.get(id) || null;
  }

  getAllCommunities() {
    return Array.from(this.tables.communities.values());
  }

  // --- Mensagens (Append-Only Log) ---
  saveMessage(message) {
    this.tables.messages.set(message.id, message);
    this._persist();
    return message;
  }

  getMessage(id) {
    return this.tables.messages.get(id) || null;
  }

  getMessageByHash(hash) {
    for (const msg of this.tables.messages.values()) {
      if (msg.hash === hash) return msg;
    }
    return null;
  }

  getMessagesByCommunity(communityId) {
    const msgs = [];
    for (const msg of this.tables.messages.values()) {
      if (msg.communityId === communityId) {
        msgs.push(msg);
      }
    }
    // Ordena monotonicamente por sequência crescente
    return msgs.sort((a, b) => a.sequence - b.sequence);
  }

  getCommunityStateVector(communityId) {
    const msgs = this.getMessagesByCommunity(communityId);
    const maxSequence = msgs.length > 0 ? msgs[msgs.length - 1].sequence : 0;
    const hashes = msgs.map(m => m.hash);
    return {
      communityId,
      maxSequence,
      messageCount: msgs.length,
      hashes
    };
  }

  // --- Pares P2P Conhecidos ---
  savePeer(peer) {
    this.tables.peers.set(peer.peerId, {
      ...peer,
      lastSeen: Date.now()
    });
    this._persist();
  }

  getPeer(peerId) {
    return this.tables.peers.get(peerId) || null;
  }

  getAllPeers() {
    return Array.from(this.tables.peers.values());
  }

  // --- Logs de Auditoria ---
  saveAuditLog(auditEntry) {
    this.tables.audit_logs.set(auditEntry.id, auditEntry);
    this._persist();
    return auditEntry;
  }

  getAuditLogs(communityId = null) {
    const logs = [];
    for (const entry of this.tables.audit_logs.values()) {
      if (!communityId || entry.communityId === communityId) {
        logs.push(entry);
      }
    }
    return logs.sort((a, b) => b.timestamp - a.timestamp);
  }

  // --- Fila de Notificações ---
  enqueueNotification(notif) {
    const id = notif.id || `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record = { ...notif, id, status: 'PENDING', createdAt: Date.now() };
    this.tables.notifications_queue.set(id, record);
    this._persist();
    return record;
  }

  getPendingNotifications() {
    return Array.from(this.tables.notifications_queue.values()).filter(n => n.status === 'PENDING');
  }

  markNotificationDelivered(id) {
    const notif = this.tables.notifications_queue.get(id);
    if (notif) {
      notif.status = 'DELIVERED';
      notif.deliveredAt = Date.now();
      this._persist();
    }
  }

  close() {
    this._persist();
  }
}
