/**
 * Comunidade Resiliente - Runtime Completo do Nó P2P Pessoal
 * Executado localmente em cada computador membro.
 * Integra: Storage SQLite em WAL, Crypto Ed25519/AES-256-GCM, Chain CRDT,
 * P2P Engine com NAT/STUN/Relay, Consenso Raft-lite, Notificações VAPID e Servidor Web Local para UI/PWA.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const CryptoEngine = require('../common/crypto');
const StorageManager = require('../core/storage');
const MessageChain = require('../core/crdt_chain');
const NotificationService = require('../core/notification_service');
const AuditLogger = require('../core/audit_logger');
const P2PEngine = require('../core/p2p_engine');
const SystemConfig = require('../common/config');
const LinkPreviewService = require('../core/link_preview');
const FileManager = require('../core/file_manager');
const QRCodeGenerator = require('../common/qrcode');

class P2PNode {
  /**
   * @param {object} config
   * @param {string} config.nodeId - Identificador único deste nó
   * @param {string} [config.dataDir] - Diretório de dados SQLite
   * @param {number} config.p2pPort - Porta da malha P2P
   * @param {number} config.httpPort - Porta da interface Web local / PWA
   * @param {Array<string>} [config.bootstrapNodes] - URLs da VPS / outros bootstraps
   * @param {string} [config.username] - Nome de usuário inicial
   * @param {string} [config.role='Membro'] - 'Administrador', 'Moderador' ou 'Membro'
   * @param {string} [config.genesisAdminPubkey] - Chave pública do admin gênesis da comunidade
   * @param {string} [config.channelKey] - Chave simétrica inicial do canal
   */
  constructor(config) {
    this.config = config;
    this.nodeId = config.nodeId;
    this.httpPort = config.httpPort;
    this.p2pPort = config.p2pPort;
    this.bootstrapNodes = config.bootstrapNodes && config.bootstrapNodes.length > 0
      ? config.bootstrapNodes
      : SystemConfig.BOOTSTRAP_NODES;
    this.dataDir = config.dataDir || path.join(process.cwd(), 'data', this.nodeId);
    this.startTime = Date.now();

    this.currentUser = null;
    this.activePrivateKeyPem = null;
    this.activeChannelKeyHex = null;

    const dbPath = path.join(this.dataDir, 'comunidade.db');
    this.storage = new StorageManager(dbPath);

    this.auditLogger = new AuditLogger(this.storage);
    this.notificationService = new NotificationService(this.storage);
    this.chain = new MessageChain(this.storage);

    this.p2p = new P2PEngine({
      nodeId: this.nodeId,
      host: '0.0.0.0',
      p2pPort: this.p2pPort,
      bootstrapNodes: this.bootstrapNodes,
      storage: this.storage,
      chain: this.chain,
      notificationService: this.notificationService,
      auditLogger: this.auditLogger,
      role: config.role || 'Membro'
    });

    this.httpServer = null;
    this.uiWss = null;
    this.uiClients = new Set();
  }

  async start() {
    this.initDefaultCommunityAndUser();
    await this.p2p.start();

    this.p2p.on('message_received', (msg) => {
      this.broadcastToUI({
        type: 'NEW_MESSAGE',
        message: this.formatMessageForUI(msg)
      });
      this.broadcastNetworkUpdate();
    });

    this.p2p.on('peer_connected', (peer) => {
      this.broadcastToUI({
        type: 'PEER_CHANGE',
        event: 'connected',
        peer,
        networkStatus: this.p2p.getNetworkStatus()
      });
      this.broadcastNetworkUpdate();
    });

    this.p2p.on('peer_disconnected', (peer) => {
      this.broadcastToUI({
        type: 'PEER_CHANGE',
        event: 'disconnected',
        peer,
        networkStatus: this.p2p.getNetworkStatus()
      });
      this.broadcastNetworkUpdate();
    });

    this.p2p.on('leader_change', (leaderData) => {
      this.broadcastToUI({
        type: 'LEADER_CHANGE',
        leaderData,
        networkStatus: this.p2p.getNetworkStatus()
      });
      this.broadcastNetworkUpdate();
    });

    this.p2p.on('vps_status_change', (vpsData) => {
      this.broadcastToUI({
        type: 'VPS_STATUS_CHANGE',
        vpsData,
        networkStatus: this.p2p.getNetworkStatus()
      });
      this.broadcastNetworkUpdate();
    });

    this.notificationService.on('push', (notif) => {
      this.broadcastToUI({
        type: 'PUSH_NOTIFICATION',
        notification: notif
      });
    });

    await this.startHttpServer();

    console.log(`[Nó ${this.nodeId}] Ativo! Web/PWA: http://localhost:${this.httpPort} | P2P Port: ${this.p2pPort}`);
  }

  initDefaultCommunityAndUser() {
    let comm = this.storage.getCommunity('geral');
    if (!comm) {
      const initialKey = this.config.channelKey || CryptoEngine.generateChannelKey();
      const genesisAdmin = this.config.genesisAdminPubkey || 'GENESIS_ADMIN_PENDING';

      comm = {
        id: 'geral',
        name: 'Comunidade Resiliente',
        description: 'Canal seguro, descentralizado e à prova de censura operado em rede P2P.',
        genesis_admin_pubkey: genesisAdmin,
        current_epoch: 1,
        created_at: Date.now()
      };
      this.storage.saveCommunity(comm);
      this.storage.saveKeyEpoch('geral', 1, initialKey, 'genesis');
      this.activeChannelKeyHex = initialKey;
    } else {
      if (this.config.genesisAdminPubkey && comm.genesis_admin_pubkey === 'GENESIS_ADMIN_PENDING') {
        comm.genesis_admin_pubkey = this.config.genesisAdminPubkey;
        this.storage.saveCommunity(comm);
      }
      if (this.config.channelKey) {
        this.storage.saveKeyEpoch('geral', 1, this.config.channelKey, 'genesis');
        this.activeChannelKeyHex = this.config.channelKey;
      } else {
        const keyObj = this.storage.getKeyForEpoch('geral', comm.current_epoch);
        if (keyObj) this.activeChannelKeyHex = keyObj;
      }
    }

    if (this.config.username) {
      let user = this.storage.getUserByUsername(this.config.username);
      if (!user) {
        const keypair = CryptoEngine.generateEd25519KeyPair();
        // Não utiliza senhas estáticas fracas em produção
        const password = this.config.password || crypto.randomBytes(8).toString('hex');
        const passwordHash = CryptoEngine.hashPassword(password);
        const encryptedPrivKey = CryptoEngine.encryptPrivateKey(keypair.privateKey, password);

        user = {
          id: `usr_${this.nodeId}`,
          username: this.config.username,
          password_hash: passwordHash,
          public_key: keypair.publicKey,
          encrypted_private_key: JSON.stringify(encryptedPrivKey),
          role: this.config.role || 'Membro',
          status: 'active',
          created_at: Date.now()
        };
        this.storage.createUser(user);

        if (user.role === 'Administrador' && comm.genesis_admin_pubkey === 'GENESIS_ADMIN_PENDING') {
          comm.genesis_admin_pubkey = user.public_key;
          this.storage.saveCommunity(comm);
        }

        this.currentUser = user;
        this.activePrivateKeyPem = keypair.privateKey;
      } else {
        this.currentUser = user;
        if (this.config.password) {
          try {
            const encObj = JSON.parse(user.encrypted_private_key);
            this.activePrivateKeyPem = CryptoEngine.decryptPrivateKey(encObj, this.config.password);
          } catch (e) {}
        }
      }
    }
  }

  startHttpServer() {
    return new Promise((resolve) => {
      this.httpServer = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      this.uiWss = new WebSocket.Server({ noServer: true });
      this.httpServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (url.pathname === '/live' || url.pathname === '/live/network') {
          this.uiWss.handleUpgrade(req, socket, head, (ws) => {
            this.uiClients.add(ws);

            // Rastreamento seguro do dispositivo (Prompt 2)
            const ua = (req.headers['user-agent'] || '').toLowerCase();
            const isMobile = /mobile|android|iphone|ipad/i.test(ua);
            const deviceType = isMobile ? 'mobile' : 'desktop';
            const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            ws.sessionId = sessionId;

            this.storage.registerDeviceSession({
              sessionId,
              userId: this.currentUser ? this.currentUser.id : null,
              deviceType,
              clientType: url.pathname === '/live/network' ? 'dashboard' : 'app',
              isRelay: false
            });

            ws.on('close', () => {
              this.uiClients.delete(ws);
              this.storage.removeDeviceSession(sessionId);
              this.broadcastNetworkUpdate();
            });

            // Envia estado inicial
            ws.send(JSON.stringify({
              type: 'INIT_STATE',
              networkStatus: this.p2p.getNetworkStatus(),
              networkOverview: this.p2p.getNetworkOverview(),
              user: this.currentUser ? {
                id: this.currentUser.id,
                username: this.currentUser.username,
                role: this.currentUser.role,
                publicKey: this.currentUser.public_key
              } : null
            }));

            this.broadcastNetworkUpdate();
          });
        } else {
          socket.destroy();
        }
      });

      this.httpServer.listen(this.httpPort, () => {
        resolve();
      });
    });
  }

  broadcastNetworkUpdate() {
    this.broadcastToUI({
      type: 'NETWORK_OVERVIEW',
      overview: this.p2p.getNetworkOverview(),
      events: this.storage.getRecentNetworkEvents(20)
    });
  }

  async handleHttpRequest(req, res) {
    const hostHeader = req.headers.host || SystemConfig.APP_DOMAIN || 'localhost';
    const isHttps = req.headers['x-forwarded-proto'] === 'https' || (req.socket && req.socket.encrypted);

    // 1. Redirecionamento HTTP -> HTTPS em Produção
    if (SystemConfig.isProduction && req.headers['x-forwarded-proto'] === 'http') {
      const redirectUrl = `https://${SystemConfig.APP_DOMAIN}${req.url}`;
      res.writeHead(301, {
        'Location': redirectUrl,
        'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload'
      });
      res.end(`Redirecionando para ${redirectUrl}`);
      return;
    }

    // 2. Cabeçalhos de Segurança Estritos (HSTS, CSP, X-Frame-Options, etc.)
    for (const [header, value] of Object.entries(SystemConfig.SECURITY_HEADERS)) {
      res.setHeader(header, value);
    }

    // 3. CORS Seguro
    const origin = req.headers.origin;
    if (origin) {
      if (SystemConfig.isOriginAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      } else if (SystemConfig.isProduction) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'CORS_FORBIDDEN', message: 'Origem de requisição não autorizada.' }));
        return;
      }
    } else if (!SystemConfig.isProduction) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${hostHeader}`);
    const pathname = url.pathname;

    // 4. Endpoint de Saúde do Sistema (Health Check sem segredos)
    if (pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'HEALTHY',
        version: '1.1.0',
        domain: SystemConfig.APP_DOMAIN,
        https: isHttps || SystemConfig.isProduction,
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
        database: 'CONNECTED',
        bootstrap: {
          status: this.p2p && this.p2p.peers && this.p2p.peers.size > 0 ? 'CONNECTED' : (this.p2p && this.p2p.bootstrapStatus ? this.p2p.bootstrapStatus : 'STANDBY_FALLBACK'),
          activePeers: this.p2p ? this.p2p.peers.size : 0
        }
      }, null, 2));
      return;
    }

    // 5. Configuração do Frontend para PWA / Web
    if (pathname === '/api/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(SystemConfig.getFrontendConfig()));
      return;
    }

    if (pathname.startsWith('/api/')) {
      return this.handleApiRoute(pathname, url, req, res);
    }

    this.serveStaticFile(pathname, res);
  }

  async handleApiRoute(pathname, url, req, res) {
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const getBody = async () => {
      return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch (e) {
            reject(new Error('JSON Inválido'));
          }
        });
      });
    };

    // Auxiliar para extrair usuário da sessão
    const getSessionUser = () => {
      const authHeader = req.headers['authorization'];
      if (!authHeader) return this.currentUser;
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      const session = this.storage.getSession(token);
      if (session) {
        return {
          id: session.user_id,
          username: session.username,
          role: session.role
        };
      }
      return this.currentUser;
    };

    try {
      // 1. Status Geral do Nó
      if (pathname === '/api/status' && req.method === 'GET') {
        const comm = this.storage.getCommunity('geral');
        return sendJson(200, {
          nodeId: this.nodeId,
          role: this.p2p.role,
          httpPort: this.httpPort,
          p2pPort: this.p2pPort,
          community: comm,
          network: this.p2p.getNetworkStatus(),
          networkOverview: this.p2p.getNetworkOverview(),
          user: this.currentUser ? {
            id: this.currentUser.id,
            username: this.currentUser.username,
            role: this.currentUser.role,
            publicKey: this.currentUser.public_key,
            isUnlocked: !!this.activePrivateKeyPem
          } : null
        });
      }

      // 2. Autenticação e Registro com Sessões Reais e Rate Limiting
      if (pathname === '/api/auth/register' && req.method === 'POST') {
        const { username, password, role } = await getBody();
        if (!username || !password) return sendJson(400, { error: 'Usuário e senha são obrigatórios' });

        const existing = this.storage.getUserByUsername(username);
        if (existing) return sendJson(409, { error: 'Nome de usuário já em uso' });

        // Regra de Segurança: Membros comuns não podem se registrar diretamente como 'Administrador'
        const allUsers = this.storage.getAllUsers();
        const hasAdmins = allUsers.some(u => u.role === 'Administrador');

        if (role === 'Administrador' && hasAdmins) {
          return sendJson(403, {
            error: 'O papel de Administrador só pode ser concedido por um administrador já ativo através de promoção assinada.'
          });
        }

        const effectiveRole = hasAdmins ? (role === 'Administrador' ? 'Membro' : (role || 'Membro')) : 'Administrador';

        const keypair = CryptoEngine.generateEd25519KeyPair();
        const passwordHash = CryptoEngine.hashPassword(password);
        const encryptedPrivKey = CryptoEngine.encryptPrivateKey(keypair.privateKey, password);

        const newUser = {
          id: `usr_${Date.now()}`,
          username,
          password_hash: passwordHash,
          public_key: keypair.publicKey,
          encrypted_private_key: JSON.stringify(encryptedPrivKey),
          role: effectiveRole,
          status: 'active',
          created_at: Date.now()
        };

        this.storage.createUser(newUser);
        this.currentUser = newUser;
        this.activePrivateKeyPem = keypair.privateKey;
        this.p2p.role = newUser.role;
        this.p2p.consensus.role = newUser.role;

        // Cria sessão persistente com expiração (24 horas)
        const token = crypto.randomBytes(32).toString('hex');
        this.storage.createSession({
          token,
          userId: newUser.id,
          username: newUser.username,
          role: newUser.role,
          expiresAt: Date.now() + (24 * 3600 * 1000)
        });

        this.auditLogger.log('USER_REGISTERED', newUser.public_key, { username, role: newUser.role });

        return sendJson(201, {
          success: true,
          token,
          user: { id: newUser.id, username: newUser.username, role: newUser.role, publicKey: newUser.public_key }
        });
      }

      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const { username, password } = await getBody();
        if (!username || !password) return sendJson(400, { error: 'Usuário e senha são obrigatórios' });

        // Proteção contra força bruta
        const lockout = this.storage.getLoginLockout(username);
        if (lockout.isLocked) {
          return sendJson(429, {
            error: `Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em ${lockout.remainingSecs} segundos.`
          });
        }

        const user = this.storage.getUserByUsername(username);
        if (!user) {
          this.storage.recordLoginAttempt(username);
          return sendJson(401, { error: 'Credenciais inválidas.' });
        }

        const isValid = CryptoEngine.verifyPassword(password, user.password_hash);
        if (!isValid) {
          const attempt = this.storage.recordLoginAttempt(username);
          if (attempt.isLocked) {
            return sendJson(429, { error: 'Muitas tentativas incorretas. Conta bloqueada por 15 minutos.' });
          }
          return sendJson(401, { error: 'Credenciais inválidas.' });
        }

        this.storage.resetLoginAttempts(username);

        try {
          const encObj = JSON.parse(user.encrypted_private_key);
          this.activePrivateKeyPem = CryptoEngine.decryptPrivateKey(encObj, password);
        } catch (e) {
          return sendJson(500, { error: 'Falha ao descriptografar chave privada' });
        }

        this.currentUser = user;
        this.p2p.role = user.role;
        this.p2p.consensus.role = user.role;

        // Gera token de sessão real
        const token = crypto.randomBytes(32).toString('hex');
        this.storage.createSession({
          token,
          userId: user.id,
          username: user.username,
          role: user.role,
          expiresAt: Date.now() + (24 * 3600 * 1000)
        });

        return sendJson(200, {
          success: true,
          token,
          user: { id: user.id, username: user.username, role: user.role, publicKey: user.public_key }
        });
      }

      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const authHeader = req.headers['authorization'];
        if (authHeader) {
          const token = authHeader.replace(/^Bearer\s+/i, '').trim();
          this.storage.deleteSession(token);
        }
        this.activePrivateKeyPem = null;
        return sendJson(200, { success: true, message: 'Sessão encerrada com segurança.' });
      }

      if (pathname === '/api/auth/me' && req.method === 'GET') {
        const user = getSessionUser();
        if (!user) return sendJson(401, { error: 'Não autenticado' });
        return sendJson(200, {
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            status: user.status || 'active',
            publicKey: user.public_key,
            isPseudonym: !!user.is_pseudonym
          }
        });
      }

      // Validação em Tempo Real de Nome de Usuário Pseudônimo e Sugestões
      if (pathname === '/api/auth/check-username' && req.method === 'GET') {
        const username = url.searchParams.get('username') || '';
        const val = this.storage.validateUsername(username);
        if (!val.valid) {
          return sendJson(400, { valid: false, available: false, error: val.error });
        }

        const isAvailable = this.storage.isUsernameAvailable(val.cleanUsername);
        if (!isAvailable) {
          const suggestions = this.storage.generateUsernameSuggestions(val.cleanUsername);
          return sendJson(200, {
            valid: true,
            available: false,
            error: `O nome "${val.cleanUsername}" já está em uso na comunidade.`,
            suggestions
          });
        }

        return sendJson(200, {
          valid: true,
          available: true,
          cleanUsername: val.cleanUsername,
          message: 'Nome de usuário disponível!'
        });
      }

      // Cadastro Simples e Pseudônimo (Sem exigência de senha, e-mail ou dados pessoais)
      if (pathname === '/api/auth/register-simple' && req.method === 'POST') {
        // Proteção anti-abuso e rate limiting por IP/conexão
        const clientIp = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'client';
        const rateCheck = this.storage.checkRegistrationRateLimit(clientIp);
        if (!rateCheck.allowed) {
          return sendJson(429, { error: rateCheck.error });
        }

        const { username, inviteCode } = await getBody();
        const val = this.storage.validateUsername(username);
        if (!val.valid) {
          return sendJson(400, { error: val.error });
        }

        const isAvailable = this.storage.isUsernameAvailable(val.cleanUsername);
        if (!isAvailable) {
          const suggestions = this.storage.generateUsernameSuggestions(val.cleanUsername);
          return sendJson(409, {
            error: `O nome de usuário "${val.cleanUsername}" já existe na comunidade.`,
            suggestions
          });
        }

        // Validação de convite se informado
        let targetCommunityId = 'geral';
        let initialStatus = 'active';
        if (inviteCode) {
          const validation = this.storage.useInvite(inviteCode);
          if (validation && validation.valid) {
            targetCommunityId = validation.invite.community_id;
            if (validation.invite.requires_approval) {
              initialStatus = 'pending';
            }
          }
        }

        // Identificador interno aleatório separado do pseudônimo público
        const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
        const deviceId = `dev_${crypto.randomBytes(6).toString('hex')}`;

        // Geração automática de par de chaves Ed25519
        const keypair = CryptoEngine.generateEd25519KeyPair();

        // Geração de chave de cofre local de 256 bits protegida
        const vaultKey = crypto.randomBytes(32).toString('hex');
        const encPrivKey = CryptoEngine.encryptPrivateKey(keypair.privateKey, vaultKey);

        // Código de recuperação seguro de uso pessoal (opcional)
        const recoveryCode = 'REC-' + crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
        const recoveryCodeHash = CryptoEngine.hashPassword(recoveryCode);

        // Define papel: se não há administradores na rede, o primeiro é Administrador; caso contrário, Membro
        const allUsers = this.storage.getAllUsers();
        const hasAdmins = allUsers.some(u => u.role === 'Administrador');
        const effectiveRole = hasAdmins ? 'Membro' : 'Administrador';

        const newUser = {
          id: userId,
          username: val.cleanUsername,
          publicKey: keypair.publicKey,
          public_key: keypair.publicKey,
          encryptedPrivateKey: JSON.stringify(encPrivKey),
          encrypted_private_key: JSON.stringify(encPrivKey),
          role: effectiveRole,
          status: initialStatus,
          recoveryCodeHash,
          recovery_code_hash: recoveryCodeHash,
          deviceId,
          device_id: deviceId
        };

        this.storage.createPseudonymUser(newUser);
        this.currentUser = newUser;
        this.activePrivateKeyPem = keypair.privateKey;
        this.p2p.role = newUser.role;
        this.p2p.consensus.role = newUser.role;

        // Se o convite requer aprovação, cria a solicitação de entrada (Join Request)
        if (initialStatus === 'pending') {
          this.storage.createJoinRequest({
            communityId: targetCommunityId,
            userId: newUser.id,
            username: newUser.username,
            publicKey: newUser.public_key,
            inviteCode: inviteCode || null
          });
          this.broadcastToUI({
            type: 'JOIN_REQUEST_SUBMITTED',
            request: {
              userId: newUser.id,
              username: newUser.username,
              communityId: targetCommunityId
            }
          });
        }

        // Sessão com token real persistente (30 dias)
        const token = crypto.randomBytes(32).toString('hex');
        this.storage.createSession({
          token,
          userId: newUser.id,
          username: newUser.username,
          role: newUser.role,
          expiresAt: Date.now() + (30 * 24 * 3600 * 1000)
        });

        // Registrar sessão de dispositivo inicial
        const ua = (req.headers['user-agent'] || '').toLowerCase();
        const isMobile = /mobile|android|iphone|ipad/i.test(ua);
        this.storage.registerDeviceSession({
          sessionId: `sess_${token.slice(0, 8)}`,
          userId: newUser.id,
          deviceType: isMobile ? 'mobile' : 'desktop',
          clientType: 'pwa_web',
          isRelay: false
        });

        this.auditLogger.log('USER_REGISTERED_PSEUDONYM', newUser.public_key, {
          username: newUser.username,
          role: newUser.role,
          status: initialStatus
        });

        return sendJson(201, {
          success: true,
          message: 'Usuário criado com sucesso.',
          token,
          vaultKey,
          recoveryCode,
          isPending: initialStatus === 'pending',
          user: {
            id: newUser.id,
            username: newUser.username,
            role: newUser.role,
            status: newUser.status,
            publicKey: newUser.public_key,
            isPseudonym: true
          }
        });
      }

      // Atualização de Pseudônimo Público
      if (pathname === '/api/auth/profile' && req.method === 'PATCH') {
        const user = getSessionUser();
        if (!user) return sendJson(401, { error: 'Autenticação necessária.' });

        const { username } = await getBody();
        const updateRes = this.storage.updatePseudonymUsername(user.id, username);
        if (!updateRes.success) {
          return sendJson(400, { error: updateRes.error });
        }

        user.username = updateRes.username;
        if (this.currentUser) this.currentUser.username = updateRes.username;
        this.broadcastToUI({ type: 'USER_PROFILE_UPDATED', userId: user.id, username: updateRes.username });

        return sendJson(200, {
          success: true,
          message: 'Nome de usuário atualizado com sucesso.',
          user: { id: user.id, username: updateRes.username, role: user.role, publicKey: user.public_key }
        });
      }

      // Recuperação de Acesso via Código de Recuperação Seguro
      if (pathname === '/api/auth/recover' && req.method === 'POST') {
        const { recoveryCode } = await getBody();
        if (!recoveryCode) return sendJson(400, { error: 'Código de recuperação é obrigatório.' });

        const cleanCode = recoveryCode.trim().toUpperCase();
        const allUsers = this.storage.getAllUsers();
        let matchedUser = null;

        for (const u of allUsers) {
          const fullUser = this.storage.getUserByUsername(u.username);
          if (fullUser && fullUser.recovery_code_hash) {
            if (CryptoEngine.verifyPassword(cleanCode, fullUser.recovery_code_hash)) {
              matchedUser = fullUser;
              break;
            }
          }
        }

        if (!matchedUser) {
          return sendJson(404, { error: 'Código de recuperação inválido ou inexistente.' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        this.storage.createSession({
          token,
          userId: matchedUser.id,
          username: matchedUser.username,
          role: matchedUser.role,
          expiresAt: Date.now() + (30 * 24 * 3600 * 1000)
        });

        this.currentUser = matchedUser;
        this.p2p.role = matchedUser.role;
        this.p2p.consensus.role = matchedUser.role;

        return sendJson(200, {
          success: true,
          message: `Acesso recuperado para o pseudônimo "${matchedUser.username}".`,
          token,
          user: {
            id: matchedUser.id,
            username: matchedUser.username,
            role: matchedUser.role,
            publicKey: matchedUser.public_key
          }
        });
      }

      // Pareamento e Revogação Segura de Dispositivos (Múltiplos Dispositivos / QR Code)
      if (pathname === '/api/devices/pairing-code' && req.method === 'POST') {
        const user = getSessionUser();
        if (!user) return sendJson(401, { error: 'Autenticação necessária.' });

        const pairingCode = 'PAIR-' + crypto.randomBytes(4).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
        const fullUser = this.storage.getUserByUsername(user.username);
        const vaultPayload = {
          userId: user.id,
          username: user.username,
          publicKey: user.public_key,
          encKey: fullUser ? fullUser.encrypted_private_key : null
        };
        const encryptedVaultKey = JSON.stringify(vaultPayload);

        this.storage.createDevicePairing({
          pairingCode,
          userId: user.id,
          username: user.username,
          encryptedVaultKey,
          publicKey: user.public_key,
          expiresInMs: 10 * 60 * 1000
        });

        const pairingUrl = `${this.appUrl || 'https://cp2p.democracias.org'}/pair/${pairingCode}`;
        const qrcodeSvg = QRCodeGenerator.generateSVG(pairingUrl, 240);

        return sendJson(201, {
          success: true,
          pairingCode,
          pairingUrl,
          qrcodeSvg,
          expiresInMinutes: 10
        });
      }

      if (pathname === '/api/devices/pair' && req.method === 'POST') {
        const { pairingCode, deviceType = 'mobile' } = await getBody();
        if (!pairingCode) return sendJson(400, { error: 'Código de pareamento é obrigatório.' });

        const pairing = this.storage.completeDevicePairing(pairingCode);
        if (!pairing) {
          return sendJson(400, { error: 'Código de pareamento inválido, expirado ou já utilizado.' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        this.storage.createSession({
          token,
          userId: pairing.user_id,
          username: pairing.username,
          role: 'Membro',
          expiresAt: Date.now() + (30 * 24 * 3600 * 1000)
        });

        const newSessionId = `sess_${token.slice(0, 8)}`;
        this.storage.registerDeviceSession({
          sessionId: newSessionId,
          userId: pairing.user_id,
          deviceType,
          clientType: 'paired_device',
          isRelay: false
        });

        return sendJson(200, {
          success: true,
          message: 'Dispositivo vinculado com sucesso.',
          token,
          sessionId: newSessionId,
          user: {
            id: pairing.user_id,
            username: pairing.username,
            publicKey: pairing.public_key
          }
        });
      }

      if (pathname === '/api/devices' && req.method === 'GET') {
        const user = getSessionUser();
        if (!user) return sendJson(401, { error: 'Autenticação necessária.' });

        const devices = this.storage.getUserDeviceSessions(user.id);
        return sendJson(200, { devices });
      }

      const revokeDeviceMatch = pathname.match(/^\/api\/devices\/([a-zA-Z0-9_\-]+)\/revoke$/);
      if ((revokeDeviceMatch && req.method === 'POST') || (pathname.startsWith('/api/devices/') && req.method === 'DELETE')) {
        const user = getSessionUser();
        if (!user) return sendJson(401, { error: 'Autenticação necessária.' });

        const sessionId = revokeDeviceMatch ? revokeDeviceMatch[1] : pathname.replace('/api/devices/', '');
        const revoked = this.storage.revokeDeviceSession(user.id, sessionId);
        return sendJson(200, { success: true, revoked, message: 'Dispositivo revogado com sucesso.' });
      }

      // 3. Gestão de Comunidades e Convites
      if (pathname === '/api/communities' && req.method === 'GET') {
        const communities = this.storage.getAllCommunities().map(c => {
          const messages = this.storage.getMessagesByCommunity(c.id, 100);
          const latest = messages[messages.length - 1];
          const isAdmin = !!(this.currentUser && (
            this.currentUser.role === 'Administrador' ||
            (c.genesis_admin_pubkey && this.currentUser.public_key.replace(/-----[^\n]+-----|\s+/g, '') === c.genesis_admin_pubkey.replace(/-----[^\n]+-----|\s+/g, ''))
          ));
          return {
            ...c,
            messageCount: messages.length,
            latestMessage: latest ? this.formatMessageForUI(latest) : null,
            isAdmin
          };
        });
        return sendJson(200, { communities });
      }

      if (pathname === '/api/communities' && req.method === 'POST') {
        const { name, description } = await getBody();
        if (!name || name.trim() === '') {
          return sendJson(400, { error: 'O nome da comunidade é obrigatório.' });
        }

        const id = 'comm-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 25) + '-' + Math.floor(100 + Math.random() * 900);
        const initialKey = CryptoEngine.generateChannelKey();
        const genesisAdmin = this.currentUser ? this.currentUser.public_key : 'GENESIS_ADMIN_PENDING';

        const newComm = {
          id,
          name: name.trim(),
          description: description ? description.trim() : 'Comunidade descentralizada P2P',
          genesis_admin_pubkey: genesisAdmin,
          current_epoch: 1,
          created_at: Date.now()
        };

        this.storage.saveCommunity(newComm);
        this.storage.saveKeyEpoch(id, 1, initialKey, genesisAdmin);
        this.auditLogger.log('COMMUNITY_CREATED', genesisAdmin, { communityId: id, name: newComm.name });

        const invitePayload = {
          type: 'comunidade_resiliente_invite',
          communityId: id,
          name: newComm.name,
          description: newComm.description,
          genesisAdminPubkey: genesisAdmin,
          channelKey: initialKey,
          bootstraps: this.bootstrapNodes
        };
        const inviteCode = Buffer.from(JSON.stringify(invitePayload)).toString('base64');

        return sendJson(201, {
          success: true,
          community: newComm,
          inviteCode
        });
      }

      const matchInvite = pathname.match(/^\/api\/communities\/([^\/]+)\/invite$/);
      if (matchInvite && req.method === 'GET') {
        const commId = decodeURIComponent(matchInvite[1]);
        const comm = this.storage.getCommunity(commId);
        if (!comm) return sendJson(404, { error: 'Comunidade não encontrada' });
        const key = this.storage.getKeyForEpoch(commId, comm.current_epoch);
        const invitePayload = {
          type: 'comunidade_resiliente_invite',
          communityId: comm.id,
          name: comm.name,
          description: comm.description,
          genesisAdminPubkey: comm.genesis_admin_pubkey,
          channelKey: key,
          bootstraps: this.bootstrapNodes
        };
        const inviteCode = Buffer.from(JSON.stringify(invitePayload)).toString('base64');
        return sendJson(200, {
          communityId: comm.id,
          name: comm.name,
          inviteCode
        });
      }

      if (pathname === '/api/communities/join' && req.method === 'POST') {
        const { inviteCode } = await getBody();
        if (!inviteCode) return sendJson(400, { error: 'Código de convite obrigatório' });
        let inviteData;
        try {
          const raw = inviteCode.trim();
          const jsonStr = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
          inviteData = JSON.parse(jsonStr);
        } catch (e) {
          return sendJson(400, { error: 'Código de convite inválido ou corrompido.' });
        }

        const { communityId, name, description, genesisAdminPubkey, channelKey, bootstraps } = inviteData;
        if (!communityId || !channelKey) {
          return sendJson(400, { error: 'Dados do convite incompletos.' });
        }

        let comm = this.storage.getCommunity(communityId);
        if (!comm) {
          comm = {
            id: communityId,
            name: name || communityId,
            description: description || 'Comunidade importada via convite',
            genesis_admin_pubkey: genesisAdminPubkey || 'GENESIS_ADMIN_PENDING',
            current_epoch: 1,
            created_at: Date.now()
          };
          this.storage.saveCommunity(comm);
        }

        this.storage.saveKeyEpoch(communityId, 1, channelKey, genesisAdminPubkey || 'invite');

        if (Array.isArray(bootstraps)) {
          for (const b of bootstraps) {
            if (!this.bootstrapNodes.includes(b)) {
              this.bootstrapNodes.push(b);
              this.p2p.connectToPeerUrl(b, true);
            }
          }
        }

        for (const socket of this.p2p.peers.values()) {
          this.p2p.sendSyncRequest(socket, communityId, 0);
        }

        this.auditLogger.log('COMMUNITY_JOINED', this.currentUser ? this.currentUser.public_key : 'ANONYMOUS', {
          communityId,
          name: comm.name
        });

        return sendJson(200, {
          success: true,
          community: comm,
          message: `Você entrou na comunidade "${comm.name}"!`
        });
      }

      // 4. CANAIS DA COMUNIDADE
      if (pathname === '/api/channels' && req.method === 'GET') {
        const communityId = url.searchParams.get('communityId') || 'geral';
        const channels = this.storage.getChannelsByCommunity(communityId);
        return sendJson(200, { communityId, channels });
      }

      if (pathname === '/api/channels' && req.method === 'POST') {
        const user = getSessionUser();
        if (!user || (user.role !== 'Administrador' && user.role !== 'Moderador')) {
          return sendJson(403, { error: 'Apenas Administradores ou Moderadores podem criar novos canais.' });
        }

        const { id, communityId = 'geral', name, description, icon, allowMemberPosts } = await getBody();
        if (!id || !name) {
          return sendJson(400, { error: 'Identificador e nome do canal são obrigatórios.' });
        }

        const safeId = id.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const channel = this.storage.createChannel({
          id: safeId,
          community_id: communityId,
          name,
          description: description || null,
          icon: icon || '💬',
          allow_member_posts: allowMemberPosts ? 1 : 0
        });

        this.broadcastToUI({ type: 'CHANNEL_CREATED', channel });
        return sendJson(201, { success: true, channel });
      }

      const channelActionMatch = pathname.match(/^\/api\/channels\/([a-zA-Z0-9_\-]+)$/);
      if (channelActionMatch && req.method === 'PATCH') {
        const channelId = channelActionMatch[1];
        const user = getSessionUser();
        if (!user || user.role !== 'Administrador') {
          return sendJson(403, { error: 'Apenas Administradores podem alterar permissões de canais.' });
        }

        const { communityId = 'geral', allowMemberPosts } = await getBody();
        this.storage.updateChannelPermissions(communityId, channelId, allowMemberPosts);
        const updated = this.storage.getChannel(communityId, channelId);

        this.broadcastToUI({ type: 'CHANNEL_UPDATED', channel: updated });
        return sendJson(200, { success: true, channel: updated });
      }

      if (channelActionMatch && req.method === 'DELETE') {
        const channelId = channelActionMatch[1];
        const user = getSessionUser();
        if (!user || user.role !== 'Administrador') {
          return sendJson(403, { error: 'Apenas Administradores podem excluir canais.' });
        }

        const communityId = url.searchParams.get('communityId') || 'geral';
        const deleted = this.storage.deleteChannel(communityId, channelId);
        if (!deleted) {
          return sendJson(400, { error: 'O canal oficial de Avisos é protegido e não pode ser excluído.' });
        }

        this.broadcastToUI({ type: 'CHANNEL_DELETED', channelId, communityId });
        return sendJson(200, { success: true });
      }

      // Silenciamento de Notificações por Canal
      const channelMuteMatch = pathname.match(/^\/api\/channels\/([a-zA-Z0-9_\-]+)\/mute$/);
      if (channelMuteMatch && req.method === 'POST') {
        const channelId = channelMuteMatch[1];
        const user = getSessionUser();
        if (!user) return sendJson(401, { error: 'Autenticação necessária.' });

        const { communityId = 'geral', isMuted, mutedUntil = 0 } = await getBody();
        this.storage.setChannelMute(user.id, communityId, channelId, isMuted, mutedUntil);
        return sendJson(200, { success: true, isMuted: !!isMuted });
      }

      // 5. PRÉ-VISUALIZAÇÃO SEGURA DE LINKS (OPENGRAPH / SSRF-SAFE)
      if (pathname === '/api/links/preview' && req.method === 'POST') {
        const { url: targetUrl } = await getBody();
        if (!targetUrl) {
          return sendJson(400, { error: 'URL é obrigatória para pré-visualização.' });
        }

        const preview = await LinkPreviewService.fetchLinkPreview(targetUrl, 3000);
        return sendJson(200, { preview });
      }

      // 6. GESTÃO DE ARQUIVOS, UPLOAD, CHUNKING E DOWNLOAD RESILIENTE
      if (pathname === '/api/files/upload' && req.method === 'POST') {
        const { filename, dataBase64, communityId = 'geral', channelId = 'documentos' } = await getBody();
        if (!filename || !dataBase64) {
          return sendJson(400, { error: 'Nome do arquivo e conteúdo codificado em Base64 são obrigatórios.' });
        }

        const user = getSessionUser();
        if (!user) return sendJson(401, { error: 'Autenticação necessária para envio de anexos.' });

        // Validação de cota e política de armazenamento do nó
        const storageSummary = this.storage.getStorageUsageSummary();
        if (storageSummary.policy === 'messages_only' || storageSummary.policy === 'no_persistence') {
          return sendJson(403, { error: 'Este nó está configurado para não persistir anexos pesados de acordo com a política de armazenamento.' });
        }

        const buffer = Buffer.from(dataBase64, 'base64');
        const validation = FileManager.validateFile(buffer, filename);
        if (!validation.valid) {
          return sendJson(400, { error: validation.error });
        }

        // Fragmenta o arquivo em chunks de 512KB para replicação resiliente
        const chunked = FileManager.chunkBuffer(buffer);
        for (const c of chunked.chunks) {
          this.storage.saveFileChunk(c);
        }

        return sendJson(201, {
          success: true,
          fileHash: chunked.fileHash,
          fileName: validation.safeFilename,
          fileSize: chunked.fileSize,
          fileMime: validation.mimeType,
          chunksTotal: chunked.totalChunks
        });
      }

      // Endpoint para envio individual de chunks (resumable upload)
      if (pathname === '/api/files/chunk' && req.method === 'POST') {
        const chunkData = await getBody();
        if (!chunkData.fileHash || chunkData.chunkIndex === undefined || !chunkData.chunkData) {
          return sendJson(400, { error: 'Dados do fragmento incompletos.' });
        }
        this.storage.saveFileChunk(chunkData);
        return sendJson(201, { success: true });
      }

      const fileChunksCheckMatch = pathname.match(/^\/api\/files\/([a-fA-F0-9]{64})\/chunks$/);
      if (fileChunksCheckMatch && req.method === 'GET') {
        const fileHash = fileChunksCheckMatch[1];
        const count = this.storage.getStoredChunksCount(fileHash);
        return sendJson(200, { fileHash, storedChunks: count });
      }

      const fileDownloadMatch = pathname.match(/^\/api\/files\/([a-fA-F0-9]{64})\/download$/);
      if (fileDownloadMatch && req.method === 'GET') {
        const fileHash = fileDownloadMatch[1];
        const chunks = this.storage.getFileChunks(fileHash);

        if (!chunks || chunks.length === 0) {
          return sendJson(404, { error: 'Arquivo ou fragmentos não encontrados no nó local.' });
        }

        try {
          const completeBuffer = FileManager.reassembleChunks(chunks, fileHash);
          const reqFilename = url.searchParams.get('filename') || 'anexo_comunidade';
          const safeName = FileManager.sanitizeFilename(reqFilename);

          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': completeBuffer.length,
            'Content-Disposition': `attachment; filename="${safeName}"`
          });
          res.end(completeBuffer);
          return;
        } catch (err) {
          return sendJson(500, { error: `Erro na reconstituição segura do arquivo: ${err.message}` });
        }
      }

      // 7. MENSAGENS ENRIQUECIDAS (CRDT / CANAIS / LINKS / ANEXOS)
      if (pathname === '/api/messages' && req.method === 'GET') {
        const communityId = url.searchParams.get('communityId') || 'geral';
        const channelId = url.searchParams.get('channelId');
        const limit = parseInt(url.searchParams.get('limit') || '100', 10);

        let rawMessages;
        if (channelId) {
          rawMessages = this.storage.getMessagesByChannel(communityId, channelId, limit);
        } else {
          rawMessages = this.storage.getMessagesByCommunity(communityId, limit);
        }

        const formatted = rawMessages.map(msg => this.formatMessageForUI(msg));

        return sendJson(200, {
          communityId,
          channelId: channelId || 'all',
          total: formatted.length,
          messages: formatted
        });
      }

      if (pathname === '/api/messages' && req.method === 'POST') {
        const {
          text,
          communityId = 'geral',
          channelId = 'avisos',
          attachmentType,
          attachmentData,
          replyToId,
          fileHash,
          fileName,
          fileSize,
          fileMime,
          fileChunksTotal,
          linkPreview: clientLinkPreview
        } = await getBody();

        if (!text || text.trim() === '') {
          return sendJson(400, { error: 'O texto da mensagem é obrigatório.' });
        }

        const comm = this.storage.getCommunity(communityId);
        if (!comm) {
          return sendJson(404, { error: 'Comunidade não encontrada localmente.' });
        }

        const channel = this.storage.getChannel(communityId, channelId);
        const allowMemberPosts = channel ? channel.allow_member_posts === 1 : false;

        const user = getSessionUser();
        const isAdminRole = user && (user.role === 'Administrador' || user.role === 'Moderador');
        const isGenesisAdmin = user && user.publicKey &&
          (user.publicKey.replace(/-----[^\n]+-----|\s+/g, '') === (comm.genesis_admin_pubkey || '').replace(/-----[^\n]+-----|\s+/g, ''));
        const isAuthorizedAuthor = isAdminRole || isGenesisAdmin || (allowMemberPosts && user && user.status === 'active');

        if (!isAuthorizedAuthor) {
          return sendJson(403, {
            error: channelId === 'avisos'
              ? 'O canal oficial de avisos é exclusivo para comunicados de Administradores.'
              : 'Você não possui permissão para publicar neste canal.'
          });
        }

        if (!this.activePrivateKeyPem) {
          return sendJson(401, { error: 'Chave privada não está desbloqueada nesta sessão.' });
        }

        const channelKey = this.storage.getKeyForEpoch(communityId, comm.current_epoch);
        if (!channelKey) {
          return sendJson(500, { error: 'Chave de criptografia da comunidade não encontrada localmente.' });
        }

        // Detecção e geração de link preview se aplicável
        let linkPreview = clientLinkPreview || null;
        if (!linkPreview) {
          const urls = LinkPreviewService.extractUrls(text);
          if (urls.length > 0) {
            try {
              linkPreview = await LinkPreviewService.fetchLinkPreview(urls[0], 2000);
            } catch (e) {
              linkPreview = null;
            }
          }
        }

        const signedMessage = this.chain.createSignedMessage({
          communityId,
          channelId,
          plaintext: text,
          channelKeyHex: channelKey,
          authorPublicKey: this.currentUser.public_key,
          authorPrivateKey: this.activePrivateKeyPem,
          epoch: comm.current_epoch,
          attachmentType: attachmentType || (fileHash ? 'file' : null),
          attachmentData: attachmentData || null,
          replyToId: replyToId || null,
          fileHash: fileHash || null,
          fileName: fileName || null,
          fileSize: fileSize || null,
          fileMime: fileMime || null,
          fileChunksTotal: fileChunksTotal || null,
          linkPreview: linkPreview || null
        });

        this.p2p.publishMessage(signedMessage);

        this.broadcastToUI({
          type: 'NEW_MESSAGE',
          message: this.formatMessageForUI(signedMessage)
        });

        return sendJson(201, {
          success: true,
          message: this.formatMessageForUI(signedMessage)
        });
      }

      // 8. ENCAMINHAMENTO DE CONTEÚDO (SEM DUPLICAÇÃO FÍSICA DE ARQUIVOS)
      if (pathname === '/api/messages/forward' && req.method === 'POST') {
        const { messageId, targetCommunityId = 'geral', targetChannelId = 'conversas', comment = '' } = await getBody();
        if (!messageId) {
          return sendJson(400, { error: 'ID da mensagem a ser encaminhada é obrigatório.' });
        }

        const originalMsg = this.storage.getMessageById(messageId);
        if (!originalMsg) {
          return sendJson(404, { error: 'Mensagem original não encontrada.' });
        }

        const user = getSessionUser();
        const targetChannel = this.storage.getChannel(targetCommunityId, targetChannelId);
        const allowMemberPosts = targetChannel ? targetChannel.allow_member_posts === 1 : false;
        const isAdmin = user && (user.role === 'Administrador' || user.role === 'Moderador');

        if (!isAdmin && !allowMemberPosts) {
          return sendJson(403, { error: 'Você não tem permissão para publicar no canal de destino.' });
        }

        const targetComm = this.storage.getCommunity(targetCommunityId);
        const targetKey = this.storage.getKeyForEpoch(targetCommunityId, targetComm.current_epoch);

        // Descriptografa o texto original para re-criptografia com a chave da comunidade/canal de destino
        const origKey = this.storage.getKeyForEpoch(originalMsg.community_id, originalMsg.epoch);
        let origPlaintext = '';
        try {
          origPlaintext = CryptoEngine.decryptAESGCM(
            { ciphertext: originalMsg.encrypted_content, iv: originalMsg.iv, tag: originalMsg.tag },
            origKey
          );
        } catch (e) {
          origPlaintext = '[Conteúdo Encaminhado]';
        }

        const forwardedText = comment ? `${comment}\n\n[Encaminhado]:\n${origPlaintext}` : origPlaintext;
        const origAuthorUser = this.storage.getUserByPublicKey(originalMsg.author_pubkey);
        const originAuthorName = origAuthorUser ? origAuthorUser.username : originalMsg.author_pubkey.substring(0, 10);

        const forwardedSignedMsg = this.chain.createSignedMessage({
          communityId: targetCommunityId,
          channelId: targetChannelId,
          plaintext: forwardedText,
          channelKeyHex: targetKey,
          authorPublicKey: this.currentUser.public_key,
          authorPrivateKey: this.activePrivateKeyPem,
          epoch: targetComm.current_epoch,
          attachmentType: originalMsg.attachment_type,
          attachmentData: originalMsg.attachment_data,
          forwardedFromChannelId: originalMsg.channel_id || 'avisos',
          forwardedFromCommunityId: originalMsg.community_id,
          forwardedOriginAuthor: originAuthorName,
          fileHash: originalMsg.file_hash,
          fileName: originalMsg.file_name,
          fileSize: originalMsg.file_size,
          fileMime: originalMsg.file_mime,
          fileChunksTotal: originalMsg.file_chunks_total,
          linkPreview: originalMsg.link_preview
        });

        this.p2p.publishMessage(forwardedSignedMsg);
        this.broadcastToUI({
          type: 'NEW_MESSAGE',
          message: this.formatMessageForUI(forwardedSignedMsg)
        });

        return sendJson(201, {
          success: true,
          message: this.formatMessageForUI(forwardedSignedMsg)
        });
      }

      // 9. REAÇÕES, FIXAÇÃO, EDIÇÃO E EXCLUSÃO DE MENSAGENS
      const reactMatch = pathname.match(/^\/api\/messages\/([a-zA-Z0-9_\-]+)\/react$/);
      if (reactMatch && req.method === 'POST') {
        const messageId = reactMatch[1];
        const user = getSessionUser();
        if (!user) return sendJson(401, { error: 'Autenticação necessária para reagir.' });

        const { emoji } = await getBody();
        if (!emoji) return sendJson(400, { error: 'Emoji é obrigatório.' });

        const reactions = this.storage.addReaction(messageId, user.id, user.username, emoji);
        this.broadcastToUI({ type: 'MESSAGE_REACTION', messageId, reactions });
        return sendJson(200, { success: true, reactions });
      }

      if (reactMatch && req.method === 'DELETE') {
        const messageId = reactMatch[1];
        const user = getSessionUser();
        if (!user) return sendJson(401, { error: 'Autenticação necessária.' });

        const { emoji } = await getBody();
        const reactions = this.storage.removeReaction(messageId, user.id, emoji);
        this.broadcastToUI({ type: 'MESSAGE_REACTION', messageId, reactions });
        return sendJson(200, { success: true, reactions });
      }

      const pinMatch = pathname.match(/^\/api\/messages\/([a-zA-Z0-9_\-]+)\/pin$/);
      if (pinMatch && req.method === 'POST') {
        const messageId = pinMatch[1];
        const user = getSessionUser();
        if (!user || (user.role !== 'Administrador' && user.role !== 'Moderador')) {
          return sendJson(403, { error: 'Apenas Administradores ou Moderadores podem fixar mensagens.' });
        }

        const pinned = this.storage.pinMessage(messageId, user.username);
        this.broadcastToUI({ type: 'MESSAGE_PINNED', message: this.formatMessageForUI(pinned) });
        return sendJson(200, { success: true, message: this.formatMessageForUI(pinned) });
      }

      const unpinMatch = pathname.match(/^\/api\/messages\/([a-zA-Z0-9_\-]+)\/unpin$/);
      if (unpinMatch && req.method === 'POST') {
        const messageId = unpinMatch[1];
        const user = getSessionUser();
        if (!user || (user.role !== 'Administrador' && user.role !== 'Moderador')) {
          return sendJson(403, { error: 'Apenas Administradores ou Moderadores podem desafixar mensagens.' });
        }

        const unpinned = this.storage.unpinMessage(messageId);
        this.broadcastToUI({ type: 'MESSAGE_UNPINNED', message: this.formatMessageForUI(unpinned) });
        return sendJson(200, { success: true, message: this.formatMessageForUI(unpinned) });
      }

      const msgActionMatch = pathname.match(/^\/api\/messages\/([a-zA-Z0-9_\-]+)$/);
      if (msgActionMatch && req.method === 'PATCH') {
        const messageId = msgActionMatch[1];
        const user = getSessionUser();
        const msg = this.storage.getMessageById(messageId);
        if (!msg) return sendJson(404, { error: 'Mensagem não encontrada.' });

        const isAuthor = user && user.publicKey &&
          user.publicKey.replace(/-----[^\n]+-----|\s+/g, '') === msg.author_pubkey.replace(/-----[^\n]+-----|\s+/g, '');
        const isAdmin = user && user.role === 'Administrador';

        if (!isAuthor && !isAdmin) {
          return sendJson(403, { error: 'Apenas o autor ou um Administrador pode editar esta mensagem.' });
        }

        const { text: newText } = await getBody();
        if (!newText || newText.trim() === '') {
          return sendJson(400, { error: 'Novo texto é obrigatório.' });
        }

        const channelKey = this.storage.getKeyForEpoch(msg.community_id, msg.epoch);
        const enc = CryptoEngine.encryptAESGCM(newText, channelKey);
        const updated = this.storage.editMessage(messageId, enc.ciphertext, enc.iv, enc.tag);

        this.broadcastToUI({ type: 'MESSAGE_EDITED', message: this.formatMessageForUI(updated) });
        return sendJson(200, { success: true, message: this.formatMessageForUI(updated) });
      }

      if (msgActionMatch && req.method === 'DELETE') {
        const messageId = msgActionMatch[1];
        const user = getSessionUser();
        const msg = this.storage.getMessageById(messageId);
        if (!msg) return sendJson(404, { error: 'Mensagem não encontrada.' });

        const isAuthor = user && user.publicKey &&
          user.publicKey.replace(/-----[^\n]+-----|\s+/g, '') === msg.author_pubkey.replace(/-----[^\n]+-----|\s+/g, '');
        const isAdmin = user && (user.role === 'Administrador' || user.role === 'Moderador');

        if (!isAuthor && !isAdmin) {
          return sendJson(403, { error: 'Sem permissão para excluir esta mensagem.' });
        }

        this.storage.softDeleteMessage(messageId);
        this.broadcastToUI({ type: 'MESSAGE_DELETED', messageId });
        return sendJson(200, { success: true });
      }

      // 10. CONVITES AMIGÁVEIS E SOLICITAÇÕES DE ENTRADA (ETAPA 4)
      const inviteQrMatch = pathname.match(/^\/api\/invites\/([a-zA-Z0-9_\-]+)\/qrcode$/);
      if (inviteQrMatch && req.method === 'GET') {
        const code = inviteQrMatch[1];
        const invite = this.storage.getInvite(code);
        if (!invite) return sendJson(404, { error: 'Convite não encontrado.' });
        const inviteUrl = `${SystemConfig.PUBLIC_URL}/join/${code}`;
        const svg = QRCodeGenerator.generateSVG(inviteUrl, 300);
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=3600'
        });
        res.end(svg);
        return;
      }

      if (pathname === '/api/invites' && req.method === 'GET') {
        const communityId = url.searchParams.get('communityId') || 'geral';
        const invites = this.storage.getInvitesByCommunity(communityId);
        return sendJson(200, { communityId, invites });
      }

      if (pathname === '/api/invites' && req.method === 'POST') {
        const user = getSessionUser();
        if (!user || (user.role !== 'Administrador' && user.role !== 'Moderador')) {
          return sendJson(403, { error: 'Apenas Administradores ou Moderadores podem gerar convites.' });
        }

        const { communityId = 'geral', maxUses = 0, expiresInHours = 48, requiresApproval = 0 } = await getBody();
        const expiresAt = expiresInHours > 0 ? Date.now() + (expiresInHours * 3600 * 1000) : 0;
        const invite = this.storage.createInvite({
          communityId,
          createdBy: user.username,
          maxUses: parseInt(maxUses, 10) || 0,
          expiresAt,
          requiresApproval: requiresApproval ? 1 : 0
        });

        return sendJson(201, { success: true, invite });
      }

      if (pathname === '/api/invites/validate' && req.method === 'POST') {
        const { code } = await getBody();
        if (!code) return sendJson(400, { error: 'Código de convite é obrigatório.' });

        const validation = this.storage.useInvite(code);
        if (!validation.valid) {
          return sendJson(400, { error: 'Convite inválido, expirado ou com limite de usos esgotado.' });
        }

        const comm = this.storage.getCommunity(validation.invite.community_id);
        return sendJson(200, {
          valid: true,
          community: comm ? { id: comm.id, name: comm.name, description: comm.description } : null,
          requiresApproval: !!validation.invite.requires_approval
        });
      }

      if (pathname === '/api/join-requests' && req.method === 'GET') {
        const user = getSessionUser();
        if (!user || (user.role !== 'Administrador' && user.role !== 'Moderador')) {
          return sendJson(403, { error: 'Acesso restrito a moderadores.' });
        }
        const communityId = url.searchParams.get('communityId') || 'geral';
        const requests = this.storage.getJoinRequests(communityId, 'pending');
        return sendJson(200, { requests });
      }

      if (pathname === '/api/join-requests' && req.method === 'POST') {
        const user = getSessionUser();
        if (!user) return sendJson(401, { error: 'Cadastro inicial necessário.' });

        const { communityId = 'geral', inviteCode } = await getBody();
        const reqRow = this.storage.createJoinRequest({
          communityId,
          userId: user.id,
          username: user.username,
          publicKey: user.publicKey,
          inviteCode: inviteCode || null
        });

        this.broadcastToUI({ type: 'JOIN_REQUEST_SUBMITTED', request: reqRow });
        return sendJson(201, { success: true, request: reqRow });
      }

      const reviewReqMatch = pathname.match(/^\/api\/join-requests\/([a-zA-Z0-9_\-]+)\/review$/);
      if (reviewReqMatch && req.method === 'POST') {
        const requestId = reviewReqMatch[1];
        const user = getSessionUser();
        if (!user || (user.role !== 'Administrador' && user.role !== 'Moderador')) {
          return sendJson(403, { error: 'Apenas Administradores podem revisar solicitações.' });
        }

        const { status } = await getBody();
        if (status !== 'approved' && status !== 'rejected') {
          return sendJson(400, { error: 'Status deve ser "approved" ou "rejected".' });
        }

        const reviewed = this.storage.reviewJoinRequest(requestId, status, user.username);
        this.broadcastToUI({ type: 'JOIN_REQUEST_REVIEWED', request: reviewed });
        return sendJson(200, { success: true, request: reviewed });
      }

      // 11. COTAS E POLÍTICAS DE ARMAZENAMENTO POR NÓ
      if (pathname === '/api/storage/settings' && req.method === 'GET') {
        const summary = this.storage.getStorageUsageSummary();
        return sendJson(200, summary);
      }

      if (pathname === '/api/storage/settings' && req.method === 'POST') {
        const user = getSessionUser();
        if (!user || user.role !== 'Administrador') {
          return sendJson(403, { error: 'Apenas Administradores podem alterar configurações de armazenamento.' });
        }

        const { policy, maxStorageMB } = await getBody();
        if (policy) this.storage.setStorageSetting('storage_policy', policy);
        if (maxStorageMB) this.storage.setStorageSetting('max_storage_mb', maxStorageMB);

        const updated = this.storage.getStorageUsageSummary();
        return sendJson(200, { success: true, settings: updated });
      }

      // 12. FILA OUTBOX OFFLINE
      if (pathname === '/api/outbox' && req.method === 'GET') {
        const pending = this.storage.getPendingOutbox(100);
        return sendJson(200, {
          count: pending.length,
          pending: pending.map(p => ({
            id: p.id,
            communityId: p.community_id,
            channelId: p.channel_id,
            status: p.status,
            attempts: p.attempts,
            createdAt: p.created_at
          }))
        });
      }

      if (pathname === '/api/outbox/flush' && req.method === 'POST') {
        const flushed = this.p2p.flushOutbox();
        return sendJson(200, { success: true, flushedCount: flushed });
      }

      // 5. ENDPOINTS DO PAINEL "VISÃO DA COMUNIDADE" (PROMPT 2 REQUISITO)
      if (pathname === '/api/network/overview' && req.method === 'GET') {
        const overview = this.p2p.getNetworkOverview();
        return sendJson(200, overview);
      }

      if (pathname === '/api/network/nodes' && req.method === 'GET') {
        const nodes = this.p2p.getConnectedNodesList();
        return sendJson(200, { nodes });
      }

      if (pathname === '/api/community/members' && req.method === 'GET') {
        // Retorna apenas dados públicos e não sensíveis dos membros
        const users = this.storage.getAllUsers().map(u => ({
          id: u.id,
          username: u.username,
          role: u.role,
          status: u.status,
          deviceType: 'Desktop / Celular',
          lastSeen: Date.now() - 30000
        }));
        return sendJson(200, { members: users });
      }

      if (pathname === '/api/community/devices' && req.method === 'GET') {
        const activeSessions = this.storage.getActiveDeviceSessions();
        const pushSubs = this.storage.getAllPushSubscriptions();
        return sendJson(200, {
          activeSessionsCount: activeSessions.length,
          mobileCount: activeSessions.filter(s => s.device_type === 'mobile').length,
          desktopCount: activeSessions.filter(s => s.device_type === 'desktop').length,
          webCount: activeSessions.filter(s => s.device_type === 'web').length,
          pushSubscribersCount: pushSubs.length
        });
      }

      if (pathname === '/api/network/events' && req.method === 'GET') {
        const events = this.storage.getRecentNetworkEvents(50);
        return sendJson(200, { events });
      }

      // 6. Inscrição Web Push (VAPID)
      if (pathname === '/api/notifications/subscribe' && req.method === 'POST') {
        const body = await getBody();
        this.notificationService.registerSubscription(body);
        return sendJson(200, { success: true });
      }

      if (pathname === '/api/notifications/vapid-key' && req.method === 'GET') {
        return sendJson(200, {
          vapidPublicKey: this.notificationService.getVapidPublicKey()
        });
      }

      // 7. Auditoria Criptográfica Imutável
      if (pathname === '/api/audit' && req.method === 'GET') {
        const logs = this.auditLogger.getRecentLogs(100);
        const integrity = this.auditLogger.verifyChainIntegrity();
        return sendJson(200, { integrity, logs });
      }

      // 8. Administração e Governança
      if (pathname === '/api/admin/role' && req.method === 'POST') {
        const user = getSessionUser();
        if (!user || user.role !== 'Administrador') {
          return sendJson(403, { error: 'Acesso negado. Requer privilégios de Administrador.' });
        }

        const { userId, newRole } = await getBody();
        this.storage.updateUserRole(userId, newRole);
        this.auditLogger.log('ADMIN_ROLE_CHANGED', this.currentUser.public_key, { userId, newRole });

        return sendJson(200, { success: true });
      }

      if (pathname === '/api/admin/revoke' && req.method === 'POST') {
        const user = getSessionUser();
        if (!user || user.role !== 'Administrador') {
          return sendJson(403, { error: 'Acesso negado. Requer privilégios de Administrador.' });
        }

        const { userId } = await getBody();
        this.storage.setUserStatus(userId, 'revoked');

        const comm = this.storage.getCommunity('geral');
        const nextEpoch = comm.current_epoch + 1;
        const newChannelKey = CryptoEngine.generateChannelKey();

        this.storage.saveKeyEpoch('geral', nextEpoch, newChannelKey, this.currentUser.public_key);
        this.storage.updateCommunityEpoch('geral', nextEpoch);
        this.activeChannelKeyHex = newChannelKey;

        this.auditLogger.log('MEMBER_REVOKED_AND_KEY_ROTATED', this.currentUser.public_key, {
          revokedUserId: userId,
          newEpoch: nextEpoch
        });

        return sendJson(200, {
          success: true,
          message: `Membro revogado. Nova época criptográfica #${nextEpoch} ativada.`,
          newEpoch
        });
      }

      // 9. Exportação de Backup Criptografado
      if (pathname === '/api/export' && req.method === 'GET') {
        const backup = this.storage.createBackup();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="backup-comunidade-${Date.now()}.json"`
        });
        res.end(JSON.stringify(backup, null, 2));
        return;
      }

      return sendJson(404, { error: 'Endpoint não encontrado' });
    } catch (err) {
      return sendJson(500, { error: err.message });
    }
  }

  formatMessageForUI(msg) {
    const key = this.storage.getKeyForEpoch(msg.community_id, msg.epoch);
    let decryptedText = '[Conteúdo Criptografado - Chave Indisponível]';
    let isDecrypted = false;

    if (key) {
      try {
        decryptedText = CryptoEngine.decryptAESGCM(
          {
            ciphertext: msg.encrypted_content,
            iv: msg.iv,
            tag: msg.tag
          },
          key
        );
        isDecrypted = true;
      } catch (e) {}
    }

    const authorUser = this.storage.getUserByPublicKey(msg.author_pubkey);
    const authorName = authorUser ? authorUser.username : `Admin (${msg.author_pubkey.substring(0, 10)}...)`;

    let linkPreview = null;
    if (msg.link_preview) {
      try {
        linkPreview = typeof msg.link_preview === 'string' ? JSON.parse(msg.link_preview) : msg.link_preview;
      } catch (e) {
        linkPreview = null;
      }
    }

    const reactions = this.storage.getReactionsForMessage(msg.id);

    return {
      id: msg.id,
      sequence: msg.sequence,
      communityId: msg.community_id,
      channelId: msg.channel_id || 'avisos',
      prevHash: msg.prev_hash,
      authorName,
      authorPubkey: msg.author_pubkey,
      text: decryptedText,
      isDecrypted,
      epoch: msg.epoch,
      attachmentType: msg.attachment_type,
      attachmentData: msg.attachment_data,
      fileHash: msg.file_hash || null,
      fileName: msg.file_name || null,
      fileSize: msg.file_size || null,
      fileMime: msg.file_mime || null,
      fileChunksTotal: msg.file_chunks_total || null,
      linkPreview,
      replyToId: msg.reply_to_id || null,
      forwardedFromChannelId: msg.forwarded_from_channel_id || null,
      forwardedFromCommunityId: msg.forwarded_from_community_id || null,
      forwardedOriginAuthor: msg.forwarded_origin_author || null,
      isPinned: !!msg.is_pinned,
      pinnedAt: msg.pinned_at || null,
      pinnedBy: msg.pinned_by || null,
      isEdited: !!msg.is_edited,
      editedAt: msg.edited_at || null,
      reactions,
      timestamp: msg.timestamp,
      signature: msg.signature,
      signatureValid: CryptoEngine.verifySignature(msg.id, msg.signature, msg.author_pubkey)
    };
  }

  broadcastToUI(payload) {
    const str = JSON.stringify(payload);
    for (const ws of this.uiClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(str);
        } catch (e) {}
      }
    }
  }

  serveStaticFile(pathname, res) {
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const webRoot = path.join(__dirname, '..', 'web');
    const fullPath = path.join(webRoot, filePath);

    // Proteção contra Path Traversal e vazamento de arquivos confidenciais
    if (!fullPath.startsWith(webRoot) ||
        fullPath.includes('.env') ||
        fullPath.includes('.db') ||
        fullPath.includes('.git') ||
        fullPath.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Acesso proibido');
      return;
    }

    if (!fs.existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const isCacheable = ['.css', '.js', '.png', '.jpg', '.svg'].includes(ext) && !filePath.includes('sw.js');
    const cacheControl = isCacheable ? 'public, max-age=86400' : 'no-cache, no-store, must-revalidate';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl
    });
    fs.createReadStream(fullPath).pipe(res);
  }

  async stop() {
    for (const ws of this.uiClients) {
      try { ws.terminate(); } catch (e) {}
    }
    this.uiClients.clear();

    if (this.uiWss) {
      try { this.uiWss.close(); } catch (e) {}
    }

    await this.p2p.stop();

    return new Promise((resolve) => {
      if (this.httpServer) {
        if (typeof this.httpServer.closeAllConnections === 'function') {
          this.httpServer.closeAllConnections();
        }
        this.httpServer.close(() => {
          this.storage.close();
          resolve();
        });
      } else {
        this.storage.close();
        resolve();
      }
    });
  }
}

if (require.main === module) {
  const nodeId = process.env.NODE_ID || `node-${Math.random().toString(36).substring(2, 7)}`;
  const p2pPort = parseInt(process.env.P2P_PORT || '6001', 10);
  const httpPort = parseInt(process.env.HTTP_PORT || '5001', 10);
  const role = process.env.ROLE || 'Membro';
  const username = process.env.USERNAME || (role === 'Administrador' ? 'admin' : `membro_${nodeId}`);
  const bootstrapNodes = process.env.BOOTSTRAPS ? process.env.BOOTSTRAPS.split(',') : ['ws://127.0.0.1:4001'];

  const node = new P2PNode({
    nodeId,
    p2pPort,
    httpPort,
    role,
    username,
    bootstrapNodes
  });

  node.start();

  process.on('SIGINT', async () => {
    console.log('\nDesligando nó P2P...');
    await node.stop();
    process.exit(0);
  });
}

module.exports = P2PNode;
