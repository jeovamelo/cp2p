/**
 * Comunidade Resiliente - Módulo de Armazenamento Local SQLite
 * Armazena mensagens assinadas, histórico criptografado, pares de rede,
 * identidades de nós, sessões seguras, termos de consenso, eventos de rede e auditoria.
 * Suporta o motor nativo node:sqlite (Node 22+) com fallback para better-sqlite3.
 * Executa em modo WAL (Write-Ahead Logging) com migrações versionadas.
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
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseClass(dbPath);
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
      this.db.exec('PRAGMA foreign_keys = ON;');
    } catch (e) {}

    this.runMigrations();
  }

  runMigrations() {
    // Tabela de controle de versões de migração
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    const applied = new Set(
      this.db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
    );

    // Migração 1: Tabelas Base do Sistema P2P
    if (!applied.has(1)) {
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
      this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(1, Date.now());
    }

    // Migração 2: Índices de Performance, Sessões com Expiração, Rate Limiting & Identidades de Nós
    if (!applied.has(2)) {
      this.db.exec(`
        -- Identidade criptográfica persistente de cada nó desktop
        CREATE TABLE IF NOT EXISTS node_identities (
          node_id TEXT PRIMARY KEY,
          display_name TEXT,
          public_key TEXT NOT NULL,
          encrypted_private_key TEXT NOT NULL,
          certificate TEXT,
          created_at INTEGER NOT NULL
        );

        -- Sessões de autenticação reais com expiração
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          role TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          last_active INTEGER NOT NULL
        );

        -- Limitação de tentativas de login contra força bruta
        CREATE TABLE IF NOT EXISTS login_attempts (
          ip_or_user TEXT PRIMARY KEY,
          attempts INTEGER DEFAULT 0,
          locked_until INTEGER DEFAULT 0,
          last_attempt INTEGER NOT NULL
        );

        -- Estado persistente de consenso e eleições Raft-lite
        CREATE TABLE IF NOT EXISTS consensus_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        -- Subscrições Web Push reais com chaves VAPID
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          endpoint TEXT PRIMARY KEY,
          user_id TEXT,
          keys_p256dh TEXT NOT NULL,
          keys_auth TEXT NOT NULL,
          device_type TEXT DEFAULT 'mobile',
          created_at INTEGER NOT NULL
        );

        -- Linha do tempo de eventos técnicos da malha (zero conteúdo privado)
        CREATE TABLE IF NOT EXISTS network_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          summary TEXT NOT NULL,
          severity TEXT DEFAULT 'info'
        );

        -- Registro de dispositivos e sessões conectadas
        CREATE TABLE IF NOT EXISTS device_sessions (
          session_id TEXT PRIMARY KEY,
          user_id TEXT,
          device_type TEXT NOT NULL, -- 'desktop', 'mobile', 'web'
          client_type TEXT NOT NULL,
          status TEXT DEFAULT 'online',
          last_seen INTEGER NOT NULL,
          is_relay INTEGER DEFAULT 0
        );

        -- Índices otimizados
        CREATE INDEX IF NOT EXISTS idx_messages_comm_seq ON messages(community_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
        CREATE INDEX IF NOT EXISTS idx_peers_status_last_seen ON peers(status, last_seen);
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
        CREATE INDEX IF NOT EXISTS idx_network_events_ts ON network_events(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_device_sessions_user ON device_sessions(user_id);
      `);
      this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(2, Date.now());
    }
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
      user.encrypted_private_key || null,
      user.role || 'Membro',
      user.status || 'active',
      user.created_at || Date.now()
    );
    return user;
  }

  getUserByUsername(username) {
    return this.db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
  }

  getUserByPublicKey(publicKey) {
    if (!publicKey) return null;
    const cleanKey = publicKey.replace(/-----[^\n]+-----|\s+/g, '');
    const users = this.getAllUsers();
    for (const u of users) {
      if (u.public_key && u.public_key.replace(/-----[^\n]+-----|\s+/g, '') === cleanKey) {
        return u;
      }
    }
    return null;
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

  // --- SESSÕES SEGURAS & AUTENTICAÇÃO ---
  createSession({ token, userId, username, role, expiresAt }) {
    this.db.prepare(`
      INSERT INTO sessions (token, user_id, username, role, expires_at, created_at, last_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(token, userId, username, role, expiresAt, Date.now(), Date.now());
  }

  getSession(token) {
    if (!token) return null;
    const now = Date.now();
    const session = this.db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token);
    if (!session) return null;
    if (session.expires_at < now) {
      this.deleteSession(token);
      return null;
    }
    this.touchSession(token);
    return session;
  }

  touchSession(token) {
    try {
      this.db.prepare(`UPDATE sessions SET last_active = ? WHERE token = ?`).run(Date.now(), token);
    } catch (e) {}
  }

  deleteSession(token) {
    this.db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  }

  cleanExpiredSessions() {
    this.db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(Date.now());
  }

  // --- CONTROLE DE FORÇA BRUTA DE LOGIN ---
  recordLoginAttempt(ipOrUser) {
    const record = this.db.prepare(`SELECT * FROM login_attempts WHERE ip_or_user = ?`).get(ipOrUser);
    const now = Date.now();
    if (!record) {
      this.db.prepare(`
        INSERT INTO login_attempts (ip_or_user, attempts, locked_until, last_attempt)
        VALUES (?, 1, 0, ?)
      `).run(ipOrUser, now);
      return { attempts: 1, isLocked: false };
    }

    const newAttempts = record.attempts + 1;
    let lockedUntil = 0;
    if (newAttempts >= 5) {
      // Bloqueio temporário por 15 minutos após 5 tentativas falhas
      lockedUntil = now + (15 * 60 * 1000);
    }

    this.db.prepare(`
      UPDATE login_attempts SET attempts = ?, locked_until = ?, last_attempt = ?
      WHERE ip_or_user = ?
    `).run(newAttempts, lockedUntil, now, ipOrUser);

    return { attempts: newAttempts, isLocked: lockedUntil > now, lockedUntil };
  }

  getLoginLockout(ipOrUser) {
    const record = this.db.prepare(`SELECT * FROM login_attempts WHERE ip_or_user = ?`).get(ipOrUser);
    if (!record) return { isLocked: false };
    const now = Date.now();
    if (record.locked_until > now) {
      return { isLocked: true, remainingSecs: Math.ceil((record.locked_until - now) / 1000) };
    }
    return { isLocked: false };
  }

  resetLoginAttempts(ipOrUser) {
    this.db.prepare(`DELETE FROM login_attempts WHERE ip_or_user = ?`).run(ipOrUser);
  }

  // --- IDENTIDADE CRIPTOGRÁFICA DO NÓ DESKTOP ---
  saveNodeIdentity(identity) {
    this.db.prepare(`
      INSERT OR REPLACE INTO node_identities (node_id, display_name, public_key, encrypted_private_key, certificate, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      identity.node_id,
      identity.display_name || identity.node_id,
      identity.public_key,
      identity.encrypted_private_key,
      identity.certificate || null,
      identity.created_at || Date.now()
    );
  }

  getNodeIdentity(nodeId) {
    return this.db.prepare(`SELECT * FROM node_identities WHERE node_id = ?`).get(nodeId);
  }

  getFirstNodeIdentity() {
    return this.db.prepare(`SELECT * FROM node_identities ORDER BY created_at ASC LIMIT 1`).get();
  }

  // --- CONSENSO E ELEIÇÃO RAFT-LITE ---
  setConsensusState(key, val) {
    this.db.prepare(`
      INSERT OR REPLACE INTO consensus_state (key, value)
      VALUES (?, ?)
    `).run(key, String(val));
  }

  getConsensusState(key) {
    const row = this.db.prepare(`SELECT value FROM consensus_state WHERE key = ?`).get(key);
    return row ? row.value : null;
  }

  // --- MÉTODOS DE MENSAGENS (CRDT / HASH CHAIN) ---
  saveMessage(msg) {
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
      msg.attachment_type || null,
      msg.attachment_data || null,
      msg.epoch || 1,
      msg.timestamp,
      msg.signature,
      msg.received_at || Date.now()
    );
    return true;
  }

  getMessageById(id) {
    return this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id);
  }

  deleteMessageById(id) {
    this.db.prepare(`DELETE FROM messages WHERE id = ?`).run(id);
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

  getMessageBySequence(communityId, sequence) {
    return this.db.prepare(`
      SELECT * FROM messages 
      WHERE community_id = ? AND sequence = ?
    `).get(communityId, sequence);
  }

  getMessageCount(communityId) {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM messages WHERE community_id = ?`).get(communityId);
    return row ? row.count : 0;
  }

  // --- ÉPOCAS DE CHAVES SIMÉTRICAS ---
  saveKeyEpoch(communityId, epoch, channelKey, createdBy) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO key_epochs (community_id, epoch, channel_key, created_by, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(communityId, epoch, channelKey, createdBy, Date.now());
  }

  getKeyForEpoch(communityId, epoch) {
    const row = this.db.prepare(`
      SELECT channel_key FROM key_epochs 
      WHERE community_id = ? AND epoch = ?
    `).get(communityId, epoch);
    return row ? row.channel_key : null;
  }

  // --- GESTÃO DE PARES P2P (PERSISTÊNCIA & CACHE OFFLINE) ---
  upsertPeer(peer) {
    const existing = this.db.prepare(`SELECT * FROM peers WHERE node_id = ?`).get(peer.node_id);
    if (existing) {
      this.db.prepare(`
        UPDATE peers 
        SET host = ?, port = ?, is_bootstrap = ?, last_seen = ?, latency = ?, status = ?
        WHERE node_id = ?
      `).run(peer.host, peer.port, peer.is_bootstrap ? 1 : 0, peer.last_seen || Date.now(), peer.latency || 0, peer.status || 'alive', peer.node_id);
    } else {
      this.db.prepare(`
        INSERT INTO peers (node_id, host, port, is_bootstrap, last_seen, latency, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(peer.node_id, peer.host, peer.port, peer.is_bootstrap ? 1 : 0, peer.last_seen || Date.now(), peer.latency || 0, peer.status || 'alive');
    }
  }

  getActivePeers(maxAgeMs = 120000) {
    const threshold = Date.now() - maxAgeMs;
    return this.db.prepare(`SELECT * FROM peers WHERE last_seen > ? AND status = 'alive'`).all(threshold);
  }

  getAllPeers() {
    return this.db.prepare(`SELECT * FROM peers ORDER BY last_seen DESC`).all();
  }

  getCachedPeersForBootstrapFallback() {
    return this.db.prepare(`
      SELECT * FROM peers 
      WHERE is_bootstrap = 0 
      ORDER BY last_seen DESC 
      LIMIT 50
    `).all();
  }

  // --- DISPOSITIVOS E SESSÕES (PROMPT 2 REQUISITO) ---
  registerDeviceSession({ sessionId, userId, deviceType, clientType, isRelay }) {
    this.db.prepare(`
      INSERT OR REPLACE INTO device_sessions (session_id, user_id, device_type, client_type, status, last_seen, is_relay)
      VALUES (?, ?, ?, ?, 'online', ?, ?)
    `).run(sessionId, userId || null, deviceType || 'desktop', clientType || 'app', Date.now(), isRelay ? 1 : 0);
  }

  heartbeatDeviceSession(sessionId) {
    this.db.prepare(`UPDATE device_sessions SET last_seen = ?, status = 'online' WHERE session_id = ?`).run(Date.now(), sessionId);
  }

  removeDeviceSession(sessionId) {
    this.db.prepare(`DELETE FROM device_sessions WHERE session_id = ?`).run(sessionId);
  }

  getActiveDeviceSessions(maxAgeMs = 60000) {
    const threshold = Date.now() - maxAgeMs;
    return this.db.prepare(`SELECT * FROM device_sessions WHERE last_seen > ?`).all(threshold);
  }

  // --- LINHA DO TEMPO DE EVENTOS DA REDE (ZERO CONTEÚDO PRIVADO) ---
  addNetworkEvent({ eventType, summary, severity = 'info' }) {
    this.db.prepare(`
      INSERT INTO network_events (timestamp, event_type, summary, severity)
      VALUES (?, ?, ?, ?)
    `).run(Date.now(), eventType, summary, severity);

    // Mantém no máximo 500 eventos recentes
    this.db.exec(`
      DELETE FROM network_events WHERE id NOT IN (
        SELECT id FROM network_events ORDER BY timestamp DESC LIMIT 500
      );
    `);
  }

  getRecentNetworkEvents(limit = 50) {
    return this.db.prepare(`
      SELECT * FROM network_events ORDER BY timestamp DESC LIMIT ?
    `).all(limit);
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

  // --- WEB PUSH SUBSCRIPTIONS REAL (VAPID) ---
  savePushSubscription({ endpoint, userId, p256dh, auth, deviceType }) {
    this.db.prepare(`
      INSERT OR REPLACE INTO push_subscriptions (endpoint, user_id, keys_p256dh, keys_auth, device_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(endpoint, userId || null, p256dh, auth, deviceType || 'mobile', Date.now());
  }

  removePushSubscription(endpoint) {
    this.db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
  }

  getAllPushSubscriptions() {
    return this.db.prepare(`SELECT * FROM push_subscriptions`).all();
  }

  // --- NOTIFICAÇÕES PENDENTES E LIMPEZA ---
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

  cleanOldNotifications(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    const threshold = Date.now() - maxAgeMs;
    this.db.prepare(`DELETE FROM pending_notifications WHERE created_at < ? AND status = 'delivered'`).run(threshold);
  }

  // --- TELEMETRIA DE EVENTOS TÉCNICOS DA MALHA (ZERO DADOS PRIVADOS) ---
  recordNetworkEvent(eventType, summary, severity = 'info') {
    const timestamp = Date.now();
    this.db.prepare(`
      INSERT INTO network_events (timestamp, event_type, summary, severity)
      VALUES (?, ?, ?, ?)
    `).run(timestamp, eventType, summary, severity);
  }

  getRecentNetworkEvents(limit = 50) {
    return this.db.prepare(`
      SELECT id, timestamp, event_type, summary, severity, summary as description
      FROM network_events
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
  }

  // --- REGISTRO DE SESSÕES E DISPOSITIVOS (DESKTOP, CELULAR, WEB) ---
  registerDeviceSession({ sessionId, userId, deviceType, clientType, isRelay }) {
    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO device_sessions (session_id, user_id, device_type, client_type, status, last_seen, is_relay)
      VALUES (?, ?, ?, ?, 'online', ?, ?)
    `).run(sessionId, userId || null, deviceType || 'desktop', clientType || 'app', now, isRelay ? 1 : 0);
  }

  removeDeviceSession(sessionId) {
    this.db.prepare(`DELETE FROM device_sessions WHERE session_id = ?`).run(sessionId);
  }

  getActiveDeviceSessions(maxAgeMs = 120000) {
    const threshold = Date.now() - maxAgeMs;
    return this.db.prepare(`SELECT * FROM device_sessions WHERE last_seen > ?`).all(threshold);
  }

  updateDeviceSessionActivity(sessionId) {
    this.db.prepare(`UPDATE device_sessions SET last_seen = ? WHERE session_id = ?`).run(Date.now(), sessionId);
  }

  // --- BACKUP E RESTAURAÇÃO INTEGRAL ---
  createBackup() {
    return {
      version: 2,
      exportedAt: Date.now(),
      communities: this.getAllCommunities(),
      users: this.getAllUsers(),
      messages: this.db.prepare(`SELECT * FROM messages ORDER BY sequence ASC`).all(),
      peers: this.getAllPeers(),
      keyEpochs: this.db.prepare(`SELECT * FROM key_epochs`).all(),
      auditLogs: this.db.prepare(`SELECT * FROM audit_logs`).all()
    };
  }

  restoreBackup(backup) {
    if (!backup || !backup.communities || !backup.messages) {
      throw new Error('Formato de backup inválido.');
    }

    for (const comm of backup.communities) {
      this.saveCommunity(comm);
    }
    for (const keyRow of (backup.keyEpochs || [])) {
      this.saveKeyEpoch(keyRow.community_id, keyRow.epoch, keyRow.channel_key, keyRow.created_by);
    }
    for (const msg of backup.messages) {
      this.saveMessage(msg);
    }
    return true;
  }

  close() {
    try {
      this.db.close();
    } catch (e) {}
  }
}

module.exports = StorageManager;
