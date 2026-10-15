/**
 * Comunidade Resiliente - Módulo de Armazenamento Local SQLite
 * Armazena mensagens assinadas, histórico criptografado, pares de rede e logs de auditoria
 * Suporta o motor nativo node:sqlite (Node 22+) com fallback para better-sqlite3
 */

const path = require('path');
const fs = require('fs');
const CryptoEngine = require('../common/crypto');

// Detecção dinâmica de driver SQLite
let DatabaseClass;
try {
  const { DatabaseSync } = require('node:sqlite');
  DatabaseClass = DatabaseSync;
} catch (e) {
  try {
    DatabaseClass = require('better-sqlite3');
  } catch (e2) {
    throw new Error('Nenhum driver SQLite disponível (node:sqlite ou better-sqlite3).');
  }
}

class StorageManager {
  /**
   * Inicializa o banco de dados SQLite local
   * @param {string} dbPath - Caminho para o arquivo sqlite (ou ':memory:' para testes)
   */
  constructor(dbPath) {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseClass(dbPath);
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
    } catch (e) {}

    this.initTables();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS communities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        genesis_admin_pubkey TEXT NOT NULL,
        current_epoch INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        public_key TEXT NOT NULL,
        encrypted_private_key TEXT,
        role TEXT NOT NULL DEFAULT 'Membro',
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,                -- Hash SHA-256 do bloco
        community_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        prev_hash TEXT NOT NULL,
        author_pubkey TEXT NOT NULL,
        encrypted_content TEXT NOT NULL,    -- AES-256-GCM ciphertext
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        attachment_type TEXT,               -- 'image', 'file', null
        attachment_data TEXT,               -- base64 ou link local
        epoch INTEGER NOT NULL DEFAULT 1,   -- Época da chave do canal
        timestamp INTEGER NOT NULL,
        signature TEXT NOT NULL,            -- Assinatura Ed25519 do Administrador
        received_at INTEGER NOT NULL,
        UNIQUE(community_id, sequence)
      );

      CREATE TABLE IF NOT EXISTS peers (
        node_id TEXT PRIMARY KEY,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        is_bootstrap INTEGER DEFAULT 0,
        last_seen INTEGER NOT NULL,
        latency INTEGER DEFAULT 0,
        status TEXT DEFAULT 'alive'
      );

      CREATE TABLE IF NOT EXISTS key_epochs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        community_id TEXT NOT NULL,
        epoch INTEGER NOT NULL,
        channel_key TEXT NOT NULL,         -- Chave AES-256 da época
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(community_id, epoch)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        action TEXT NOT NULL,
        actor_pubkey TEXT,
        details TEXT NOT NULL,
        prev_audit_hash TEXT NOT NULL,
        audit_hash TEXT NOT NULL,
        signature TEXT
      );

      CREATE TABLE IF NOT EXISTS pending_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL
      );
    `);
  }

  // --- MÉTODOS DE COMUNIDADE ---
  saveCommunity(community) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO communities (id, name, description, genesis_admin_pubkey, current_epoch, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      community.id,
      community.name,
      community.description,
      community.genesis_admin_pubkey,
      community.current_epoch,
      community.created_at
    );
  }

  getCommunity(id) {
    return this.db.prepare(`SELECT * FROM communities WHERE id = ?`).get(id);
  }

  getAllCommunities() {
    return this.db.prepare(`SELECT * FROM communities ORDER BY created_at DESC`).all();
  }

  updateCommunityEpoch(communityId, epoch) {
    this.db.prepare(`UPDATE communities SET current_epoch = ? WHERE id = ?`).run(epoch, communityId);
  }

  // --- MÉTODOS DE USUÁRIOS ---
  createUser(user) {
    const stmt = this.db.prepare(`
      INSERT INTO users (id, username, password_hash, public_key, encrypted_private_key, role, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      user.id,
      user.username,
      user.password_hash,
      user.public_key,
      user.encrypted_private_key,
      user.role,
      user.status,
      user.created_at
    );
    return user;
  }

  getUserByUsername(username) {
    return this.db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
  }

  getUserByPublicKey(publicKey) {
    return this.db.prepare(`SELECT * FROM users WHERE public_key = ?`).get(publicKey);
  }

  getAllUsers() {
    return this.db.prepare(`SELECT id, username, public_key, role, status, created_at FROM users ORDER BY created_at ASC`).all();
  }

  updateUserRole(userId, newRole) {
    this.db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(newRole, userId);
  }

  setUserStatus(userId, status) {
    this.db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(status, userId);
  }

  // --- MÉTODOS DE MENSAGENS (CRDT / HASH CHAIN) ---
  saveMessage(msg) {
    // Evita duplicações
    const existing = this.getMessageById(msg.id);
    if (existing) return false;

    const stmt = this.db.prepare(`
      INSERT INTO messages (
        id, community_id, sequence, prev_hash, author_pubkey,
        encrypted_content, iv, tag, attachment_type, attachment_data,
        epoch, timestamp, signature, received_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);
    stmt.run(
      msg.id,
      msg.community_id,
      msg.sequence,
      msg.prev_hash,
      msg.author_pubkey,
      msg.encrypted_content,
      msg.iv,
      msg.tag,
      msg.attachment_type,
      msg.attachment_data,
      msg.epoch,
      msg.timestamp,
      msg.signature,
      msg.received_at
    );
    return true;
  }

  getMessageById(id) {
    return this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id);
  }

  getMessagesByCommunity(communityId, limit = 100) {
    return this.db.prepare(`
      SELECT * FROM messages 
      WHERE community_id = ? 
      ORDER BY sequence ASC 
      LIMIT ?
    `).all(communityId, limit);
  }

  getLatestMessage(communityId) {
    return this.db.prepare(`
      SELECT * FROM messages 
      WHERE community_id = ? 
      ORDER BY sequence DESC 
      LIMIT 1
    `).get(communityId);
  }

  getMissingMessages(communityId, knownMaxSequence) {
    return this.db.prepare(`
      SELECT * FROM messages 
      WHERE community_id = ? AND sequence > ? 
      ORDER BY sequence ASC
    `).all(communityId, knownMaxSequence);
  }

  // --- MÉTODOS DE CHAVES E ÉPOCAS (KEY ROTATION) ---
  saveKeyEpoch(communityId, epoch, channelKey, createdBy) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO key_epochs (community_id, epoch, channel_key, created_by, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(communityId, epoch, channelKey, createdBy, Date.now());
  }

  getKeyForEpoch(communityId, epoch) {
    const row = this.db.prepare(`SELECT channel_key FROM key_epochs WHERE community_id = ? AND epoch = ?`).get(communityId, epoch);
    return row ? row.channel_key : null;
  }

  getLatestKey(communityId) {
    return this.db.prepare(`
      SELECT * FROM key_epochs 
      WHERE community_id = ? 
      ORDER BY epoch DESC 
      LIMIT 1
    `).get(communityId);
  }

  // --- MÉTODOS DE PEERS (DESCOBERTA P2P) ---
  upsertPeer(peer) {
    const existing = this.db.prepare(`SELECT node_id FROM peers WHERE node_id = ?`).get(peer.node_id);
    if (existing) {
      this.db.prepare(`
        UPDATE peers SET
          host = ?,
          port = ?,
          last_seen = ?,
          latency = ?,
          status = ?
        WHERE node_id = ?
      `).run(peer.host, peer.port, peer.last_seen, peer.latency, peer.status, peer.node_id);
    } else {
      this.db.prepare(`
        INSERT INTO peers (node_id, host, port, is_bootstrap, last_seen, latency, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(peer.node_id, peer.host, peer.port, peer.is_bootstrap, peer.last_seen, peer.latency, peer.status);
    }
  }

  getActivePeers(maxAgeMs = 60000) {
    const threshold = Date.now() - maxAgeMs;
    return this.db.prepare(`SELECT * FROM peers WHERE last_seen > ? AND status = 'alive'`).all(threshold);
  }

  getAllPeers() {
    return this.db.prepare(`SELECT * FROM peers ORDER BY last_seen DESC`).all();
  }

  // --- LOGS DE AUDITORIA IMUTÁVEIS ---
  appendAuditLog(action, actorPubkey, details, signature = null) {
    const lastLog = this.db.prepare(`SELECT audit_hash FROM audit_logs ORDER BY id DESC LIMIT 1`).get();
    const prevHash = lastLog ? lastLog.audit_hash : '0000000000000000000000000000000000000000000000000000000000000000';
    const timestamp = Date.now();
    const detailsStr = typeof details === 'string' ? details : JSON.stringify(details);
    const hash = CryptoEngine.sha256({ timestamp, action, actorPubkey, detailsStr, prevHash });

    this.db.prepare(`
      INSERT INTO audit_logs (timestamp, action, actor_pubkey, details, prev_audit_hash, audit_hash, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(timestamp, action, actorPubkey, detailsStr, prevHash, hash, signature);

    return hash;
  }

  getAuditLogs(limit = 100) {
    return this.db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?`).all(limit);
  }

  // --- NOTIFICAÇÕES PENDENTES ---
  addPendingNotification(messageId, title, body) {
    this.db.prepare(`
      INSERT INTO pending_notifications (message_id, title, body, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(messageId, title, body, Date.now());
  }

  getPendingNotifications() {
    return this.db.prepare(`SELECT * FROM pending_notifications WHERE status = 'pending' ORDER BY id ASC`).all();
  }

  markNotificationDelivered(id) {
    this.db.prepare(`UPDATE pending_notifications SET status = 'delivered' WHERE id = ?`).run(id);
  }

  close() {
    try {
      this.db.close();
    } catch (e) {}
  }
}

module.exports = StorageManager;
