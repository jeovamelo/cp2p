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

    // Migração 3: Canais, Mensagens Enriquecidas, Reações, Convites, Outbox e Chunking de Arquivos
    if (!applied.has(3)) {
      this.db.exec(`
        -- Canais da Comunidade (Avisos, Eventos, Documentos, Conversas, Suporte, etc.)
        CREATE TABLE IF NOT EXISTS channels (
          id TEXT NOT NULL,
          community_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          icon TEXT DEFAULT '💬',
          allow_member_posts INTEGER DEFAULT 0,
          is_default INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (community_id, id)
        );

        -- Reações com Emojis nas mensagens
        CREATE TABLE IF NOT EXISTS message_reactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          emoji TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(message_id, user_id, emoji)
        );

        -- Convites da Comunidade com códigos curtos amigáveis e QR Code
        CREATE TABLE IF NOT EXISTS community_invites (
          code TEXT PRIMARY KEY,
          community_id TEXT NOT NULL,
          created_by TEXT NOT NULL,
          max_uses INTEGER DEFAULT 0,
          uses_count INTEGER DEFAULT 0,
          expires_at INTEGER DEFAULT 0,
          requires_approval INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        -- Solicitações de Entrada com Moderação de Administradores
        CREATE TABLE IF NOT EXISTS join_requests (
          id TEXT PRIMARY KEY,
          community_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          public_key TEXT NOT NULL,
          invite_code TEXT,
          status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
          reviewed_by TEXT,
          reviewed_at INTEGER,
          created_at INTEGER NOT NULL
        );

        -- Fila Outbox para Mensagens e Anexos Offline com Sincronização Posterior
        CREATE TABLE IF NOT EXISTS outbox_pending (
          id TEXT PRIMARY KEY,
          community_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT DEFAULT 'pending', -- 'pending', 'syncing', 'synced', 'failed'
          attempts INTEGER DEFAULT 0,
          last_attempt INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        -- Fragmentação de Arquivos Grandes (Chunking com Merkle Verificação)
        CREATE TABLE IF NOT EXISTS file_chunks (
          file_hash TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          total_chunks INTEGER NOT NULL,
          chunk_hash TEXT NOT NULL,
          chunk_size INTEGER NOT NULL,
          chunk_data TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY(file_hash, chunk_index)
        );

        -- Políticas e Limites de Armazenamento por Nó
        CREATE TABLE IF NOT EXISTS node_storage_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        -- Silenciamento e Preferências de Notificação por Canal
        CREATE TABLE IF NOT EXISTS channel_notifications (
          user_id TEXT NOT NULL,
          community_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          is_muted INTEGER DEFAULT 0,
          muted_until INTEGER DEFAULT 0,
          PRIMARY KEY(user_id, community_id, channel_id)
        );
      `);

      // Atualização dinâmica de colunas na tabela messages (compatibilidade com SQLite)
      const msgCols = new Set(
        this.db.prepare('PRAGMA table_info(messages)').all().map(c => c.name)
      );
      const newCols = [
        ['channel_id', "TEXT DEFAULT 'avisos'"],
        ['reply_to_id', 'TEXT'],
        ['forwarded_from_channel_id', 'TEXT'],
        ['forwarded_from_community_id', 'TEXT'],
        ['forwarded_origin_author', 'TEXT'],
        ['is_pinned', 'INTEGER DEFAULT 0'],
        ['pinned_at', 'INTEGER'],
        ['pinned_by', 'TEXT'],
        ['link_preview', 'TEXT'],
        ['file_hash', 'TEXT'],
        ['file_name', 'TEXT'],
        ['file_size', 'INTEGER'],
        ['file_mime', 'TEXT'],
        ['file_chunks_total', 'INTEGER'],
        ['is_edited', 'INTEGER DEFAULT 0'],
        ['edited_at', 'INTEGER'],
        ['deleted_at', 'INTEGER']
      ];
      for (const [col, colDef] of newCols) {
        if (!msgCols.has(col)) {
          this.db.exec(`ALTER TABLE messages ADD COLUMN ${col} ${colDef};`);
        }
      }

      // Índices da Migração 3
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_comm_chan ON messages(community_id, channel_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(community_id, channel_id, is_pinned);
        CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions(message_id);
        CREATE INDEX IF NOT EXISTS idx_invites_comm ON community_invites(community_id);
        CREATE INDEX IF NOT EXISTS idx_join_req_comm ON join_requests(community_id, status);
        CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_pending(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_file_chunks_hash ON file_chunks(file_hash);
      `);

      this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(3, Date.now());
    }

    // Migração 4: Cadastro Simples e Pseudônimo, Pareamento e Revogação de Dispositivos
    if (!applied.has(4)) {
      this.db.exec(`
        -- Tabela de pareamento seguro de novos dispositivos (celular, tablet, desktop adicional)
        CREATE TABLE IF NOT EXISTS device_pairings (
          pairing_code TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          encrypted_vault_key TEXT NOT NULL,
          public_key TEXT NOT NULL,
          status TEXT DEFAULT 'pending', -- 'pending', 'paired', 'expired', 'revoked'
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );

        -- Limitação de criação de contas e proteção anti-abuso por identificador/IP
        CREATE TABLE IF NOT EXISTS registration_rate_limits (
          client_identifier TEXT PRIMARY KEY,
          registration_count INTEGER DEFAULT 1,
          first_attempt INTEGER NOT NULL,
          last_attempt INTEGER NOT NULL
        );
      `);

      // Colunas opcionais na tabela users para cadastro pseudônimo
      const userCols = new Set(
        this.db.prepare('PRAGMA table_info(users)').all().map(c => c.name)
      );
      const userNewCols = [
        ['recovery_code_hash', 'TEXT'],
        ['is_pseudonym', 'INTEGER DEFAULT 1'],
        ['device_id', 'TEXT']
      ];
      for (const [col, colDef] of userNewCols) {
        if (!userCols.has(col)) {
          this.db.exec(`ALTER TABLE users ADD COLUMN ${col} ${colDef};`);
        }
      }

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users(username COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_device_pairings_status ON device_pairings(status, expires_at);
      `);

      this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(4, Date.now());
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
    this.ensureDefaultChannels(community.id);
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
      INSERT INTO users (id, username, password_hash, public_key, encrypted_private_key, role, status, created_at, recovery_code_hash, is_pseudonym, device_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      user.id,
      user.username,
      user.password_hash || 'PSEUDONYM_NO_PASSWORD',
      user.public_key,
      user.encrypted_private_key || null,
      user.role || 'Membro',
      user.status || 'active',
      user.created_at || Date.now(),
      user.recovery_code_hash || null,
      user.is_pseudonym !== undefined ? (user.is_pseudonym ? 1 : 0) : 1,
      user.device_id || null
    );
    return this.getUserByUsername(user.username);
  }

  validateUsername(username) {
    if (!username || typeof username !== 'string') {
      return { valid: false, error: 'O nome de usuário não pode ser vazio.' };
    }
    const trimmed = username.trim();
    if (trimmed.length < 3) {
      return { valid: false, error: 'O nome de usuário deve ter no mínimo 3 caracteres.' };
    }
    if (trimmed.length > 25) {
      return { valid: false, error: 'O nome de usuário deve ter no máximo 25 caracteres.' };
    }
    // Permitir letras (incluindo acentuação em português), números, sublinhado e hífen. Sem espaços.
    const validPattern = /^[a-zA-Z0-9_\-\u00C0-\u00FF]+$/;
    if (!validPattern.test(trimmed)) {
      return { valid: false, error: 'O nome deve conter apenas letras, números, hífen (-) ou sublinhado (_), sem espaços ou caracteres especiais.' };
    }

    const lower = trimmed.toLowerCase();
    const reserved = new Set([
      'admin', 'administrador', 'moderador', 'mod', 'root', 'sistema',
      'system', 'suporte', 'comunidade', 'cp2p', 'todos', 'all',
      'broadcast', 'bot', 'vps', 'server', 'servidor', 'anon', 'anonymous', 'geral', 'rede'
    ]);
    if (reserved.has(lower)) {
      return { valid: false, error: `O nome "${trimmed}" é reservado para o sistema.` };
    }

    const offensiveTerms = ['arrombado', 'fdp', 'nazista', 'racista', 'babaca', 'otario'];
    if (offensiveTerms.some(term => lower.includes(term))) {
      return { valid: false, error: 'O nome de usuário contém termos não permitidos.' };
    }

    return { valid: true, cleanUsername: trimmed };
  }

  getUserByUsername(username) {
    if (!username || typeof username !== 'string') return null;
    return this.db.prepare(`SELECT * FROM users WHERE LOWER(username) = LOWER(?)`).get(username.trim());
  }

  getUserById(id) {
    if (!id || typeof id !== 'string') return null;
    return this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id.trim());
  }

  isUsernameAvailable(username) {
    const user = this.getUserByUsername(username);
    return !user;
  }

  generateUsernameSuggestions(baseUsername) {
    const clean = (baseUsername || 'membro')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_\-\u00C0-\u00FF]/g, '')
      .slice(0, 18);
    const prefix = clean || 'membro';
    const suggestions = [];

    const candidates = [
      `${prefix}_1`,
      `${prefix}_2`,
      `${prefix}_p2p`,
      `${prefix}_br`,
      `${prefix}_${Math.floor(100 + Math.random() * 900)}`,
      `${prefix}_${Math.floor(1000 + Math.random() * 9000)}`
    ];

    for (const cand of candidates) {
      if (this.isUsernameAvailable(cand) && !suggestions.includes(cand)) {
        suggestions.push(cand);
        if (suggestions.length >= 3) break;
      }
    }

    let counter = 1;
    while (suggestions.length < 3 && counter < 50) {
      const fallback = `${prefix}_${counter}`;
      if (this.isUsernameAvailable(fallback) && !suggestions.includes(fallback)) {
        suggestions.push(fallback);
      }
      counter++;
    }

    return suggestions;
  }

  createPseudonymUser(userData) {
    const id = userData.id;
    const username = (userData.username || '').trim();
    const publicKey = userData.publicKey || userData.public_key || '';
    const encryptedPrivateKey = userData.encryptedPrivateKey || userData.encrypted_private_key || null;
    const recoveryCodeHash = userData.recoveryCodeHash || userData.recovery_code_hash || null;
    const deviceId = userData.deviceId || userData.device_id || null;
    const role = userData.role || 'Membro';
    const status = userData.status || 'active';

    const stmt = this.db.prepare(`
      INSERT INTO users (id, username, password_hash, public_key, encrypted_private_key, role, status, created_at, recovery_code_hash, is_pseudonym, device_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    const now = Date.now();
    stmt.run(
      id,
      username,
      recoveryCodeHash || 'PSEUDONYM_PASSWORDLESS',
      publicKey,
      encryptedPrivateKey,
      role,
      status,
      now,
      recoveryCodeHash,
      deviceId
    );
    return this.getUserByUsername(username);
  }

  updatePseudonymUsername(userId, newUsername) {
    const val = this.validateUsername(newUsername);
    if (!val.valid) return { success: false, error: val.error };
    
    const existing = this.getUserByUsername(val.cleanUsername);
    if (existing && existing.id !== userId) {
      return { success: false, error: 'Este nome de usuário já está em uso.' };
    }

    this.db.prepare(`UPDATE users SET username = ? WHERE id = ?`).run(val.cleanUsername, userId);
    return { success: true, username: val.cleanUsername };
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
    return this.db.prepare(`SELECT id, username, public_key, role, status, created_at, is_pseudonym, device_id FROM users ORDER BY created_at ASC`).all();
  }

  updateUserRole(userId, newRole) {
    this.db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(newRole, userId);
  }

  setUserStatus(userId, status) {
    this.db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(status, userId);
  }

  // --- PAREAMENTO SEGURO DE DISPOSITIVOS ---
  createDevicePairing({ pairingCode, userId, username, encryptedVaultKey, publicKey, expiresInMs = 10 * 60 * 1000 }) {
    const expiresAt = Date.now() + expiresInMs;
    this.db.prepare(`
      INSERT OR REPLACE INTO device_pairings (pairing_code, user_id, username, encrypted_vault_key, public_key, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(pairingCode.toUpperCase(), userId, username, encryptedVaultKey, publicKey, Date.now(), expiresAt);

    return { pairingCode: pairingCode.toUpperCase(), expiresAt };
  }

  getDevicePairing(pairingCode) {
    if (!pairingCode) return null;
    const pairing = this.db.prepare(`SELECT * FROM device_pairings WHERE pairing_code = ?`).get(pairingCode.trim().toUpperCase());
    if (!pairing) return null;
    if (pairing.expires_at < Date.now()) {
      this.db.prepare(`UPDATE device_pairings SET status = 'expired' WHERE pairing_code = ?`).run(pairing.pairing_code);
      return null;
    }
    return pairing;
  }

  completeDevicePairing(pairingCode) {
    const pairing = this.getDevicePairing(pairingCode);
    if (!pairing || pairing.status !== 'pending') return null;
    this.db.prepare(`UPDATE device_pairings SET status = 'paired' WHERE pairing_code = ?`).run(pairing.pairing_code);
    pairing.status = 'paired';
    return pairing;
  }

  getUserDeviceSessions(userId) {
    if (!userId) return [];
    return this.db.prepare(`
      SELECT session_id, user_id, device_type, client_type, status, last_seen, is_relay
      FROM device_sessions
      WHERE user_id = ?
      ORDER BY last_seen DESC
    `).all(userId);
  }

  revokeDeviceSession(userId, sessionId) {
    this.db.prepare(`DELETE FROM sessions WHERE token = ? OR (user_id = ? AND token LIKE ?)`).run(sessionId, userId, `%${sessionId}%`);
    const res = this.db.prepare(`DELETE FROM device_sessions WHERE session_id = ? AND user_id = ?`).run(sessionId, userId);
    return res.changes > 0;
  }

  // --- CONTROLE DE CADASTROS ABUSIVOS (RATE LIMIT) ---
  checkRegistrationRateLimit(clientIdentifier, maxRegistrations = 5, windowMs = 15 * 60 * 1000) {
    if (!clientIdentifier || clientIdentifier === '::1' || clientIdentifier === '127.0.0.1' || clientIdentifier === 'localhost' || clientIdentifier.includes('127.0.0.1')) {
      return { allowed: true, remaining: 999 };
    }
    const now = Date.now();
    const row = this.db.prepare(`SELECT * FROM registration_rate_limits WHERE client_identifier = ?`).get(clientIdentifier);

    if (!row) {
      this.db.prepare(`
        INSERT INTO registration_rate_limits (client_identifier, registration_count, first_attempt, last_attempt)
        VALUES (?, 1, ?, ?)
      `).run(clientIdentifier, now, now);
      return { allowed: true, remaining: maxRegistrations - 1 };
    }

    if (now - row.first_attempt > windowMs) {
      this.db.prepare(`
        UPDATE registration_rate_limits
        SET registration_count = 1, first_attempt = ?, last_attempt = ?
        WHERE client_identifier = ?
      `).run(now, now, clientIdentifier);
      return { allowed: true, remaining: maxRegistrations - 1 };
    }

    if (row.registration_count >= maxRegistrations) {
      const waitMinutes = Math.ceil((windowMs - (now - row.first_attempt)) / 60000);
      return {
        allowed: false,
        error: `Limite de novos cadastros atingido para este dispositivo/rede. Aguarde ${waitMinutes} minutos antes de tentar novamente.`
      };
    }

    this.db.prepare(`
      UPDATE registration_rate_limits
      SET registration_count = registration_count + 1, last_attempt = ?
      WHERE client_identifier = ?
    `).run(now, clientIdentifier);

    return { allowed: true, remaining: maxRegistrations - (row.registration_count + 1) };
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

  // --- MÉTODOS DE CANAIS ---
  createChannel({ id, community_id, name, description, icon, allow_member_posts, is_default, created_at }) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO channels (id, community_id, name, description, icon, allow_member_posts, is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      community_id,
      name,
      description || null,
      icon || '💬',
      allow_member_posts ? 1 : 0,
      is_default ? 1 : 0,
      created_at || Date.now()
    );
    return this.getChannel(community_id, id);
  }

  getChannel(communityId, channelId) {
    return this.db.prepare(`SELECT * FROM channels WHERE community_id = ? AND id = ?`).get(communityId, channelId);
  }

  getChannelsByCommunity(communityId) {
    this.ensureDefaultChannels(communityId);
    return this.db.prepare(`SELECT * FROM channels WHERE community_id = ? ORDER BY is_default DESC, created_at ASC`).all(communityId);
  }

  ensureDefaultChannels(communityId) {
    if (!communityId) return;
    const defaults = [
      {
        id: 'avisos',
        name: 'Avisos Oficiais',
        description: 'Canal oficial de comunicados importantes da comunidade',
        icon: '📢',
        allow_member_posts: 0,
        is_default: 1
      },
      {
        id: 'eventos',
        name: 'Eventos e Agendas',
        description: 'Datas importantes, reuniões e mobilizações',
        icon: '📅',
        allow_member_posts: 0,
        is_default: 0
      },
      {
        id: 'documentos',
        name: 'Documentos e Materiais',
        description: 'Arquivos, cartilhas e documentos verificados',
        icon: '📁',
        allow_member_posts: 0,
        is_default: 0
      },
      {
        id: 'conversas',
        name: 'Conversas e Debates',
        description: 'Espaço aberto para conversas e debates entre membros',
        icon: '💬',
        allow_member_posts: 1,
        is_default: 0
      },
      {
        id: 'suporte',
        name: 'Dúvidas e Suporte',
        description: 'Canal de ajuda mútua e orientações',
        icon: '🤝',
        allow_member_posts: 1,
        is_default: 0
      }
    ];

    const existingStmt = this.db.prepare(`SELECT id FROM channels WHERE community_id = ? AND id = ?`);
    const insertStmt = this.db.prepare(`
      INSERT INTO channels (id, community_id, name, description, icon, allow_member_posts, is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const d of defaults) {
      const exists = existingStmt.get(communityId, d.id);
      if (!exists) {
        insertStmt.run(d.id, communityId, d.name, d.description, d.icon, d.allow_member_posts, d.is_default, Date.now());
      }
    }
  }

  updateChannelPermissions(communityId, channelId, allowMemberPosts) {
    this.db.prepare(`UPDATE channels SET allow_member_posts = ? WHERE community_id = ? AND id = ?`)
      .run(allowMemberPosts ? 1 : 0, communityId, channelId);
  }

  deleteChannel(communityId, channelId) {
    if (channelId === 'avisos') return false; // Canal padrão de avisos é protegido
    this.db.prepare(`DELETE FROM channels WHERE community_id = ? AND id = ?`).run(communityId, channelId);
    return true;
  }

  // --- MÉTODOS DE MENSAGENS (CRDT / HASH CHAIN) ---
  saveMessage(msg) {
    const existing = this.getMessageById(msg.id);
    if (existing) return false;

    const stmt = this.db.prepare(`
      INSERT INTO messages (
        id, community_id, channel_id, sequence, prev_hash, author_pubkey,
        encrypted_content, iv, tag, attachment_type, attachment_data,
        epoch, timestamp, signature, received_at,
        reply_to_id, forwarded_from_channel_id, forwarded_from_community_id, forwarded_origin_author,
        is_pinned, pinned_at, pinned_by, link_preview,
        file_hash, file_name, file_size, file_mime, file_chunks_total,
        is_edited, edited_at, deleted_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?
      )
    `);
    stmt.run(
      msg.id,
      msg.community_id,
      msg.channel_id || 'avisos',
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
      msg.received_at || Date.now(),
      msg.reply_to_id || null,
      msg.forwarded_from_channel_id || null,
      msg.forwarded_from_community_id || null,
      msg.forwarded_origin_author || null,
      msg.is_pinned ? 1 : 0,
      msg.pinned_at || null,
      msg.pinned_by || null,
      msg.link_preview ? (typeof msg.link_preview === 'string' ? msg.link_preview : JSON.stringify(msg.link_preview)) : null,
      msg.file_hash || null,
      msg.file_name || null,
      msg.file_size || null,
      msg.file_mime || null,
      msg.file_chunks_total || null,
      msg.is_edited ? 1 : 0,
      msg.edited_at || null,
      msg.deleted_at || null
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
      WHERE community_id = ? AND deleted_at IS NULL
      ORDER BY sequence ASC 
      LIMIT ?
    `).all(communityId, limit);
  }

  getMessagesByChannel(communityId, channelId = 'avisos', limit = 100) {
    return this.db.prepare(`
      SELECT * FROM messages 
      WHERE community_id = ? AND channel_id = ? AND deleted_at IS NULL
      ORDER BY sequence ASC 
      LIMIT ?
    `).all(communityId, channelId, limit);
  }

  getPinnedMessages(communityId, channelId = null) {
    if (channelId) {
      return this.db.prepare(`
        SELECT * FROM messages 
        WHERE community_id = ? AND channel_id = ? AND is_pinned = 1 AND deleted_at IS NULL
        ORDER BY pinned_at DESC
      `).all(communityId, channelId);
    }
    return this.db.prepare(`
      SELECT * FROM messages 
      WHERE community_id = ? AND is_pinned = 1 AND deleted_at IS NULL
      ORDER BY pinned_at DESC
    `).all(communityId);
  }

  pinMessage(messageId, pinnedBy) {
    this.db.prepare(`
      UPDATE messages 
      SET is_pinned = 1, pinned_at = ?, pinned_by = ? 
      WHERE id = ?
    `).run(Date.now(), pinnedBy, messageId);
    return this.getMessageById(messageId);
  }

  unpinMessage(messageId) {
    this.db.prepare(`
      UPDATE messages 
      SET is_pinned = 0, pinned_at = NULL, pinned_by = NULL 
      WHERE id = ?
    `).run(messageId);
    return this.getMessageById(messageId);
  }

  editMessage(messageId, newEncryptedContent, iv, tag) {
    this.db.prepare(`
      UPDATE messages 
      SET encrypted_content = ?, iv = ?, tag = ?, is_edited = 1, edited_at = ? 
      WHERE id = ?
    `).run(newEncryptedContent, iv, tag, Date.now(), messageId);
    return this.getMessageById(messageId);
  }

  softDeleteMessage(messageId) {
    this.db.prepare(`
      UPDATE messages 
      SET deleted_at = ? 
      WHERE id = ?
    `).run(Date.now(), messageId);
    return true;
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

  // --- REAÇÕES COM EMOJIS ---
  addReaction(messageId, userId, username, emoji) {
    this.db.prepare(`
      INSERT OR REPLACE INTO message_reactions (message_id, user_id, username, emoji, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(messageId, userId, username, emoji, Date.now());
    return this.getReactionsForMessage(messageId);
  }

  removeReaction(messageId, userId, emoji) {
    this.db.prepare(`
      DELETE FROM message_reactions 
      WHERE message_id = ? AND user_id = ? AND emoji = ?
    `).run(messageId, userId, emoji);
    return this.getReactionsForMessage(messageId);
  }

  getReactionsForMessage(messageId) {
    const rows = this.db.prepare(`
      SELECT emoji, user_id, username 
      FROM message_reactions 
      WHERE message_id = ? 
      ORDER BY created_at ASC
    `).all(messageId);

    const map = {};
    for (const r of rows) {
      if (!map[r.emoji]) {
        map[r.emoji] = { emoji: r.emoji, count: 0, users: [] };
      }
      map[r.emoji].count++;
      map[r.emoji].users.push({ userId: r.user_id, username: r.username });
    }
    return Object.values(map);
  }

  getReactionsForMessages(messageIds) {
    if (!messageIds || messageIds.length === 0) return {};
    const placeholders = messageIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT message_id, emoji, user_id, username 
      FROM message_reactions 
      WHERE message_id IN (${placeholders})
      ORDER BY created_at ASC
    `).all(...messageIds);

    const result = {};
    for (const r of rows) {
      if (!result[r.message_id]) result[r.message_id] = {};
      if (!result[r.message_id][r.emoji]) {
        result[r.message_id][r.emoji] = { emoji: r.emoji, count: 0, users: [] };
      }
      result[r.message_id][r.emoji].count++;
      result[r.message_id][r.emoji].users.push({ userId: r.user_id, username: r.username });
    }

    const finalMap = {};
    for (const mId of messageIds) {
      finalMap[mId] = result[mId] ? Object.values(result[mId]) : [];
    }
    return finalMap;
  }

  // --- CONVITES DA COMUNIDADE E QR CODES ---
  createInvite({ code, communityId, createdBy, maxUses = 0, expiresAt = 0, requiresApproval = 0 }) {
    const inviteCode = code || `CR-${Math.floor(1000 + Math.random() * 9000)}`;
    this.db.prepare(`
      INSERT OR REPLACE INTO community_invites (code, community_id, created_by, max_uses, uses_count, expires_at, requires_approval, created_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?)
    `).run(inviteCode, communityId, createdBy, maxUses, expiresAt, requiresApproval ? 1 : 0, Date.now());
    return this.getInvite(inviteCode);
  }

  getInvite(code) {
    return this.db.prepare(`SELECT * FROM community_invites WHERE code = ?`).get(code);
  }

  useInvite(code) {
    const invite = this.getInvite(code);
    if (!invite) return { valid: false, reason: 'INVITE_NOT_FOUND' };
    if (invite.expires_at > 0 && invite.expires_at < Date.now()) {
      return { valid: false, reason: 'INVITE_EXPIRED' };
    }
    if (invite.max_uses > 0 && invite.uses_count >= invite.max_uses) {
      return { valid: false, reason: 'INVITE_MAX_USES_REACHED' };
    }
    this.db.prepare(`UPDATE community_invites SET uses_count = uses_count + 1 WHERE code = ?`).run(code);
    return { valid: true, invite };
  }

  revokeInvite(code) {
    this.db.prepare(`DELETE FROM community_invites WHERE code = ?`).run(code);
    return true;
  }

  getInvitesByCommunity(communityId) {
    return this.db.prepare(`SELECT * FROM community_invites WHERE community_id = ? ORDER BY created_at DESC`).all(communityId);
  }

  // --- SOLICITAÇÕES DE ENTRADA (JOIN REQUESTS) ---
  createJoinRequest({ id, communityId, userId, username, publicKey, inviteCode }) {
    const reqId = id || `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.db.prepare(`
      INSERT OR REPLACE INTO join_requests (id, community_id, user_id, username, public_key, invite_code, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(reqId, communityId, userId, username, publicKey, inviteCode || null, Date.now());
    return this.db.prepare(`SELECT * FROM join_requests WHERE id = ?`).get(reqId);
  }

  getJoinRequests(communityId, status = 'pending') {
    return this.db.prepare(`
      SELECT * FROM join_requests 
      WHERE community_id = ? AND status = ?
      ORDER BY created_at ASC
    `).all(communityId, status);
  }

  getJoinRequestByUser(communityId, userId) {
    return this.db.prepare(`
      SELECT * FROM join_requests 
      WHERE community_id = ? AND user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(communityId, userId);
  }

  reviewJoinRequest(requestId, status, reviewedBy) {
    this.db.prepare(`
      UPDATE join_requests 
      SET status = ?, reviewed_by = ?, reviewed_at = ? 
      WHERE id = ?
    `).run(status, reviewedBy, Date.now(), requestId);
    const req = this.db.prepare(`SELECT * FROM join_requests WHERE id = ?`).get(requestId);
    if (req && status === 'approved') {
      this.updateUserRole(req.user_id, 'Membro');
    }
    return req;
  }

  // --- FILA OUTBOX OFFLINE ---
  queueOutbox({ id, communityId, channelId, payload }) {
    const outboxId = id || `out_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.db.prepare(`
      INSERT OR REPLACE INTO outbox_pending (id, community_id, channel_id, payload, status, attempts, last_attempt, created_at)
      VALUES (?, ?, ?, ?, 'pending', 0, 0, ?)
    `).run(outboxId, communityId, channelId || 'avisos', payloadStr, Date.now());
    return outboxId;
  }

  getPendingOutbox(limit = 50) {
    const rows = this.db.prepare(`
      SELECT * FROM outbox_pending 
      WHERE status IN ('pending', 'failed') AND attempts < 10
      ORDER BY created_at ASC 
      LIMIT ?
    `).all(limit);
    return rows.map(r => ({
      ...r,
      payload: JSON.parse(r.payload)
    }));
  }

  updateOutboxStatus(id, status) {
    this.db.prepare(`
      UPDATE outbox_pending 
      SET status = ?, attempts = attempts + 1, last_attempt = ? 
      WHERE id = ?
    `).run(status, Date.now(), id);
  }

  removeOutbox(id) {
    this.db.prepare(`DELETE FROM outbox_pending WHERE id = ?`).run(id);
  }

  // --- FRAGMENTAÇÃO DE ARQUIVOS (CHUNKING MERKLE) ---
  saveFileChunk({ fileHash, chunkIndex, totalChunks, chunkHash, chunkSize, chunkData }) {
    this.db.prepare(`
      INSERT OR REPLACE INTO file_chunks (file_hash, chunk_index, total_chunks, chunk_hash, chunk_size, chunk_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(fileHash, chunkIndex, totalChunks, chunkHash, chunkSize, chunkData, Date.now());
    return true;
  }

  getFileChunks(fileHash) {
    return this.db.prepare(`
      SELECT * FROM file_chunks 
      WHERE file_hash = ? 
      ORDER BY chunk_index ASC
    `).all(fileHash);
  }

  getFileChunk(fileHash, chunkIndex) {
    return this.db.prepare(`
      SELECT * FROM file_chunks 
      WHERE file_hash = ? AND chunk_index = ?
    `).get(fileHash, chunkIndex);
  }

  getStoredChunksCount(fileHash) {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM file_chunks WHERE file_hash = ?`).get(fileHash);
    return row ? row.count : 0;
  }

  deleteFileChunks(fileHash) {
    this.db.prepare(`DELETE FROM file_chunks WHERE file_hash = ?`).run(fileHash);
  }

  // --- POLÍTICAS E LIMITES DE ARMAZENAMENTO POR NÓ ---
  setStorageSetting(key, value) {
    this.db.prepare(`INSERT OR REPLACE INTO node_storage_settings (key, value) VALUES (?, ?)`).run(key, String(value));
  }

  getStorageSetting(key, defaultValue = null) {
    const row = this.db.prepare(`SELECT value FROM node_storage_settings WHERE key = ?`).get(key);
    return row ? row.value : defaultValue;
  }

  getStorageUsageSummary() {
    const msgCount = this.db.prepare(`SELECT COUNT(*) as count FROM messages`).get().count;
    const chunkRow = this.db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(chunk_size), 0) as total_bytes FROM file_chunks`).get();
    const policy = this.getStorageSetting('storage_policy', 'all'); // 'all', 'messages_images', 'messages_only', 'no_persistence'
    const maxStorageMB = parseInt(this.getStorageSetting('max_storage_mb', '500'), 10);

    return {
      policy,
      maxStorageMB,
      totalMessages: msgCount,
      totalFileChunks: chunkRow.count,
      totalChunkBytes: chunkRow.total_bytes,
      totalChunkMB: (chunkRow.total_bytes / (1024 * 1024)).toFixed(2)
    };
  }

  // --- SILENCIAMENTO E NOTIFICAÇÕES POR CANAL ---
  setChannelMute(userId, communityId, channelId, isMuted, mutedUntil = 0) {
    this.db.prepare(`
      INSERT OR REPLACE INTO channel_notifications (user_id, community_id, channel_id, is_muted, muted_until)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, communityId, channelId, isMuted ? 1 : 0, mutedUntil);
  }

  isChannelMuted(userId, communityId, channelId) {
    const row = this.db.prepare(`
      SELECT is_muted, muted_until 
      FROM channel_notifications 
      WHERE user_id = ? AND community_id = ? AND channel_id = ?
    `).get(userId, communityId, channelId);
    if (!row) return false;
    if (row.is_muted === 0) return false;
    if (row.muted_until > 0 && row.muted_until < Date.now()) {
      return false; // Mute expirou
    }
    return true;
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

  // --- DISPOSITIVOS E SESSÕES ---
  heartbeatDeviceSession(sessionId) {
    this.db.prepare(`UPDATE device_sessions SET last_seen = ?, status = 'online' WHERE session_id = ?`).run(Date.now(), sessionId);
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
      version: 3,
      exportedAt: Date.now(),
      communities: this.getAllCommunities(),
      channels: this.db.prepare(`SELECT * FROM channels`).all(),
      users: this.getAllUsers(),
      messages: this.db.prepare(`SELECT * FROM messages ORDER BY sequence ASC`).all(),
      reactions: this.db.prepare(`SELECT * FROM message_reactions`).all(),
      invites: this.db.prepare(`SELECT * FROM community_invites`).all(),
      storageSettings: this.db.prepare(`SELECT * FROM node_storage_settings`).all(),
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
    for (const ch of (backup.channels || [])) {
      this.createChannel(ch);
    }
    for (const keyRow of (backup.keyEpochs || [])) {
      this.saveKeyEpoch(keyRow.community_id, keyRow.epoch, keyRow.channel_key, keyRow.created_by);
    }
    for (const msg of backup.messages) {
      this.saveMessage(msg);
    }
    for (const r of (backup.reactions || [])) {
      this.addReaction(r.message_id, r.user_id, r.username, r.emoji);
    }
    for (const inv of (backup.invites || [])) {
      this.createInvite(inv);
    }
    for (const st of (backup.storageSettings || [])) {
      this.setStorageSetting(st.key, st.value);
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
