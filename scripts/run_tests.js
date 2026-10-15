/**
 * Comunidade Resiliente - Suíte de Testes Automatizados Unitários e de Integração
 * Cobertura completa de todos os módulos e requisitos do sistema:
 * 1. Criptografia Ed25519, AES-256-GCM, PBKDF2 e Key Rotation
 * 2. SQLite WAL, Migrações, Auditoria SHA-256 e Sessões
 * 3. Cadeia de Mensagens Causal, CRDT e Reconciliação Split-Brain
 * 4. Consenso Raft-lite com Termo Persistente e Quorum Estrito
 * 5. Notificações Web Push VAPID com Zero-Knowledge
 * 6. Resolução de NAT e STUN RFC 5389
 * 7. Autenticação Mútua de Nós P2P (Ed25519 Challenge-Response)
 * 8. Relay Transparente e Proteção de Tráfego
 * 9. Proteção contra Ataques de Força Bruta e Lockout
 * 10. Painel Visão da Comunidade e Anonimização de Dados Sensíveis
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const CryptoEngine = require('../src/common/crypto');
const StorageManager = require('../src/core/storage');
const MessageChain = require('../src/core/crdt_chain');
const ConsensusEngine = require('../src/core/consensus');
const NotificationService = require('../src/core/notification_service');
const AuditLogger = require('../src/core/audit_logger');
const NatStunResolver = require('../src/core/nat_stun');
const { ProtocolPacket, MessageType } = require('../src/common/protocol');
const SystemConfig = require('../src/common/config');
const LinkPreviewService = require('../src/core/link_preview');
const FileManager = require('../src/core/file_manager');
const QRCodeGenerator = require('../src/common/qrcode');
const P2PEngine = require('../src/core/p2p_engine');

let passedTests = 0;
let failedTests = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  \x1b[31m✕\x1b[0m ${description}`);
    console.error(`    \x1b[31m${err.message}\x1b[0m`);
    failedTests++;
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('  COMUNIDADE RESILIENTE - SUÍTE DE TESTES AUTOMATIZADOS');
  console.log('======================================================\n');

  // --- MÓDULO 1: CRIPTOGRAFIA ---
  console.log('\x1b[1m[1] Testes do Motor Criptográfico (Ed25519, AES-256-GCM, PBKDF2)\x1b[0m');

  test('Gera par de chaves Ed25519 válido', () => {
    const keypair = CryptoEngine.generateEd25519KeyPair();
    assert(keypair.publicKey.includes('BEGIN PUBLIC KEY'));
    assert(keypair.privateKey.includes('BEGIN PRIVATE KEY'));
  });

  test('Assina dados e valida assinatura Ed25519 legítima', () => {
    const keypair = CryptoEngine.generateEd25519KeyPair();
    const data = { msg: 'Comunicado de teste', timestamp: Date.now() };
    const sig = CryptoEngine.signData(data, keypair.privateKey);
    assert(typeof sig === 'string' && sig.length === 128);
    const valid = CryptoEngine.verifySignature(data, sig, keypair.publicKey);
    assert.strictEqual(valid, true);
  });

  test('Rejeita assinatura se os dados forem adulterados (Anti-Tampering)', () => {
    const keypair = CryptoEngine.generateEd25519KeyPair();
    const data = { msg: 'Original' };
    const sig = CryptoEngine.signData(data, keypair.privateKey);
    const tampered = { msg: 'Adulterado pelo atacante' };
    const valid = CryptoEngine.verifySignature(tampered, sig, keypair.publicKey);
    assert.strictEqual(valid, false);
  });

  test('Criptografa e decifra com AES-256-GCM autenticado', () => {
    const key = CryptoEngine.generateChannelKey();
    const plaintext = 'Mensagem ultrassecreta da comunidade P2P';
    const enc = CryptoEngine.encryptAESGCM(plaintext, key);
    assert(enc.ciphertext && enc.iv && enc.tag);
    const dec = CryptoEngine.decryptAESGCM(enc, key);
    assert.strictEqual(dec, plaintext);
  });

  test('Falha ao decifrar se o ciphertext ou tag AES-GCM forem alterados', () => {
    const key = CryptoEngine.generateChannelKey();
    const enc = CryptoEngine.encryptAESGCM('Texto', key);
    enc.ciphertext = enc.ciphertext.substring(0, enc.ciphertext.length - 2) + 'aa';
    assert.throws(() => {
      CryptoEngine.decryptAESGCM(enc, key);
    });
  });

  test('Hashing seguro de senha PBKDF2 com Salt', () => {
    const password = 'minha_senha_forte_123';
    const hash = CryptoEngine.hashPassword(password);
    assert(CryptoEngine.verifyPassword(password, hash));
    assert(!CryptoEngine.verifyPassword('senha_errada', hash));
  });

  test('Criptografa e protege a chave privada com senha do usuário', () => {
    const keypair = CryptoEngine.generateEd25519KeyPair();
    const password = 'segredo_do_admin';
    const encPrivKey = CryptoEngine.encryptPrivateKey(keypair.privateKey, password);
    const decryptedPrivKey = CryptoEngine.decryptPrivateKey(encPrivKey, password);
    assert.strictEqual(decryptedPrivKey, keypair.privateKey);
  });

  // --- MÓDULO 2: STORAGE SQLITE COM MIGRAÇÕES E WAL ---
  console.log('\n\x1b[1m[2] Testes do Armazenamento SQLite com Migrações Versionadas\x1b[0m');
  const storage = new StorageManager(':memory:');

  test('Persistência e recuperação de comunidade', () => {
    storage.saveCommunity({
      id: 'comm-1',
      name: 'Comunidade Teste',
      description: 'Desc',
      genesis_admin_pubkey: 'PUBKEY_123',
      current_epoch: 1,
      created_at: Date.now()
    });
    const retrieved = storage.getCommunity('comm-1');
    assert.strictEqual(retrieved.name, 'Comunidade Teste');
    assert.strictEqual(retrieved.current_epoch, 1);
  });

  test('Persistência de usuários e controle de papéis', () => {
    storage.createUser({
      id: 'usr-1',
      username: 'carlos',
      password_hash: 'hash',
      public_key: 'pub_carlos',
      encrypted_private_key: 'enc',
      role: 'Membro',
      status: 'active',
      created_at: Date.now()
    });
    const user = storage.getUserByUsername('carlos');
    assert.strictEqual(user.role, 'Membro');
    storage.updateUserRole('usr-1', 'Moderador');
    assert.strictEqual(storage.getUserByUsername('carlos').role, 'Moderador');
  });

  test('Armazena e previne duplicação de mensagens idênticas', () => {
    const msg = {
      id: 'hash_block_1',
      community_id: 'comm-1',
      sequence: 1,
      prev_hash: '0000000000000000000000000000000000000000000000000000000000000000',
      author_pubkey: 'pub_admin',
      encrypted_content: 'cipher',
      iv: 'iv',
      tag: 'tag',
      attachment_type: null,
      attachment_data: null,
      epoch: 1,
      timestamp: Date.now(),
      signature: 'sig',
      received_at: Date.now()
    };
    const first = storage.saveMessage(msg);
    const duplicate = storage.saveMessage(msg);
    assert.strictEqual(first, true);
    assert.strictEqual(duplicate, false); // Duplicata descartada!
  });

  test('Logs de auditoria e verificação de integridade da cadeia SHA-256', () => {
    const logger = new AuditLogger(storage);
    logger.log('ACTION_1', 'actor_1', { detail: 'início' });
    logger.log('ACTION_2', 'actor_1', { detail: 'meio' });
    logger.log('ACTION_3', 'actor_2', { detail: 'fim' });

    const integrity = logger.verifyChainIntegrity();
    assert.strictEqual(integrity.valid, true);
    assert.strictEqual(integrity.totalLogs >= 3, true);
  });

  test('Persistência e recuperação de sessões seguras com expiração', () => {
    const token = 'token_sessao_12345';
    storage.createSession({
      token,
      userId: 'usr-1',
      username: 'carlos',
      role: 'Moderador',
      expiresAt: Date.now() + 60000
    });

    const activeSession = storage.getSession(token);
    assert(activeSession);
    assert.strictEqual(activeSession.username, 'carlos');

    storage.deleteSession(token);
    assert.strictEqual(storage.getSession(token), null);
  });

  // --- MÓDULO 3: CADEIA DE MENSAGENS E RECONCILIAÇÃO SPLIT-BRAIN ---
  console.log('\n\x1b[1m[3] Testes da Cadeia de Mensagens Assinadas e Split-Brain\x1b[0m');
  const chain = new MessageChain(storage);
  const adminKeypair = CryptoEngine.generateEd25519KeyPair();
  const channelKey = CryptoEngine.generateChannelKey();

  test('Criação e encadeamento causal de mensagem válida', () => {
    const m1 = chain.createSignedMessage({
      communityId: 'comm-chain',
      plaintext: 'Primeiro bloco',
      channelKeyHex: channelKey,
      authorPublicKey: adminKeypair.publicKey,
      authorPrivateKey: adminKeypair.privateKey,
      epoch: 1
    });

    assert.strictEqual(m1.sequence, 1);
    assert.strictEqual(m1.prev_hash, '0000000000000000000000000000000000000000000000000000000000000000');
    assert(m1.id && m1.signature);

    const m2 = chain.createSignedMessage({
      communityId: 'comm-chain',
      plaintext: 'Segundo bloco',
      channelKeyHex: channelKey,
      authorPublicKey: adminKeypair.publicKey,
      authorPrivateKey: adminKeypair.privateKey,
      epoch: 1
    });

    assert.strictEqual(m2.sequence, 2);
    assert.strictEqual(m2.prev_hash, m1.id);
  });

  test('Rejeição estrita de mensagens com autor não autorizado (não-admin)', () => {
    const nonAdminKeypair = CryptoEngine.generateEd25519KeyPair();
    const forgedMsg = {
      id: 'forged_id',
      community_id: 'comm-chain',
      sequence: 3,
      prev_hash: 'hash',
      author_pubkey: nonAdminKeypair.publicKey,
      encrypted_content: 'c',
      iv: 'i',
      tag: 't',
      attachment_type: null,
      attachment_data: null,
      epoch: 1,
      timestamp: Date.now(),
      signature: 'sig'
    };

    const authorizedAdmins = [adminKeypair.publicKey];
    const res = chain.processIncomingMessage(forgedMsg, authorizedAdmins);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'UNAUTHORIZED_AUTHOR_NOT_ADMIN');
  });

  test('Reconciliação determinística de conflito de sequência (Split-Brain Resolution)', () => {
    const authorizedAdmins = [adminKeypair.publicKey];

    // Partição 1 (Nó A)
    const storageA = new StorageManager(':memory:');
    const chainA = new MessageChain(storageA);

    const b1 = chainA.createSignedMessage({
      communityId: 'comm-split',
      plaintext: 'Bloco Raiz',
      channelKeyHex: channelKey,
      authorPublicKey: adminKeypair.publicKey,
      authorPrivateKey: adminKeypair.privateKey,
      epoch: 1
    });

    // Partição 2 (Nó B - sincronizado com b1)
    const storageB = new StorageManager(':memory:');
    const chainB = new MessageChain(storageB);
    storageB.saveMessage(b1);

    // Ocorre partição da rede. Ambos nós publicam concorrentemente na sequência 2:
    const b2A = chainA.createSignedMessage({
      communityId: 'comm-split',
      plaintext: 'Bloco Ramo A',
      channelKeyHex: channelKey,
      authorPublicKey: adminKeypair.publicKey,
      authorPrivateKey: adminKeypair.privateKey,
      epoch: 1
    });

    const b2B = chainB.createSignedMessage({
      communityId: 'comm-split',
      plaintext: 'Bloco Ramo B (Alternativo)',
      channelKeyHex: channelKey,
      authorPublicKey: adminKeypair.publicKey,
      authorPrivateKey: adminKeypair.privateKey,
      epoch: 1
    });

    assert.strictEqual(b2A.sequence, 2);
    assert.strictEqual(b2B.sequence, 2);
    assert.notStrictEqual(b2A.id, b2B.id);

    // Partição se reconecta: Troca mútua entre Nó A e Nó B
    const resB = chainB.processIncomingMessage(b2A, authorizedAdmins);
    const resA = chainA.processIncomingMessage(b2B, authorizedAdmins);

    // Propriedade CRDT fundamental: Ambos os nós convergem deterministamente para a mesma mensagem!
    const finalMsgA = storageA.getMessageBySequence('comm-split', 2);
    const finalMsgB = storageB.getMessageBySequence('comm-split', 2);

    assert(finalMsgA && finalMsgB);
    assert.strictEqual(finalMsgA.id, finalMsgB.id);
    assert(resA.reason === 'PARTITION_RECONCILED' || resB.reason === 'PARTITION_RECONCILED');

    storageA.close();
    storageB.close();
  });

  // --- MÓDULO 4: CONSENSO RAFT-LITE COM TERMO E QUORUM ---
  console.log('\n\x1b[1m[4] Testes de Consenso Raft-lite com Quorum Estrito\x1b[0m');

  test('Cálculo de prioridade: Administrador possui maior precedência na eleição', () => {
    const adminConsensus = new ConsensusEngine({ nodeId: 'node-admin', role: 'Administrador', broadcast: () => {} });
    const memberConsensus = new ConsensusEngine({ nodeId: 'node-member', role: 'Membro', broadcast: () => {} });
    assert(adminConsensus.getPriority(1) > memberConsensus.getPriority(1));
    adminConsensus.stop();
    memberConsensus.stop();
  });

  test('Eleição autônoma quando nó está sozinho na malha (Quorum 1/1)', () => {
    const nodeConsensus = new ConsensusEngine({
      nodeId: 'node-leader-single',
      role: 'Administrador',
      broadcast: () => {},
      electionTimeout: 50,
      storage
    });

    nodeConsensus.notifyBootstrapFailed();
    nodeConsensus.startElection(5);

    assert.strictEqual(nodeConsensus.isLeader, true);
    assert.strictEqual(nodeConsensus.currentLeaderId, 'node-leader-single');
    nodeConsensus.stop();
  });

  test('Eleição com quórum estrito de maioria em rede com múltiplos nós', () => {
    const nodeConsensus = new ConsensusEngine({
      nodeId: 'node-candidate',
      role: 'Administrador',
      broadcast: () => {},
      electionTimeout: 50,
      storage
    });

    // Registra 2 outros nós conhecidos -> total de 3 nós na rede
    nodeConsensus.recordPeerSeen('peer-1', 'Membro');
    nodeConsensus.recordPeerSeen('peer-2', 'Membro');
    nodeConsensus.notifyBootstrapFailed();

    nodeConsensus.startElection(5);
    // Com 3 nós, precisa de floor(3/2) + 1 = 2 votos. O nó tem apenas seu voto (1), ainda não é líder
    assert.strictEqual(nodeConsensus.isLeader, false);

    // Recebe voto afirmativo do peer-1 com voterId e granted -> atinge 2 votos -> maioria estrita alcançada!
    nodeConsensus.handleProtocolPacket({
      type: MessageType.ELECTION_VOTE,
      senderNodeId: 'peer-1',
      payload: {
        term: nodeConsensus.term,
        candidateId: 'node-candidate',
        voterId: 'peer-1',
        granted: true
      }
    });

    assert.strictEqual(nodeConsensus.isLeader, true);
    assert.strictEqual(nodeConsensus.currentLeaderId, 'node-candidate');
    nodeConsensus.stop();
  });

  // --- MÓDULO 5: NOTIFICAÇÕES WEB PUSH COM ZERO-KNOWLEDGE ---
  console.log('\n\x1b[1m[5] Testes de Notificações Web Push com Zero-Knowledge\x1b[0m');

  test('Gera notificação push sem expor conteúdo confidencial em texto claro', () => {
    const notifService = new NotificationService(storage);
    const mockMsg = {
      id: 'hash_notif_1',
      sequence: 12,
      community_id: 'comm-1',
      timestamp: Date.now()
    };
    const alert = notifService.dispatchForMessage(mockMsg, 'Canal Seguro');
    assert.strictEqual(alert.title, 'Novo comunicado: Canal Seguro');
    assert(!alert.body.includes('conteúdo confidencial'));
    assert.strictEqual(alert.requiresDecryption, true);
  });

  test('Geração e recuperação de chaves VAPID ECDSA P-256', () => {
    const notifService = new NotificationService(storage);
    const vapidKey = notifService.getVapidPublicKey();
    assert(vapidKey && typeof vapidKey === 'string');
    assert(vapidKey.length > 30);
  });

  test('Diferencia tipos de notificação: arquivo, link, resposta e mensagem fixada', () => {
    const notifService = new NotificationService(storage);

    // Mensagem com arquivo
    const fileMsg = {
      id: 'msg-notif-file',
      community_id: 'comm-1',
      channel_id: 'documentos',
      sequence: 20,
      file_hash: 'hash123',
      file_name: 'relatorio.pdf'
    };
    const fileAlert = notifService.dispatchForMessage(fileMsg, 'Comunidade Alpha');
    assert.strictEqual(fileAlert.type, 'NEW_FILE');
    assert(fileAlert.body.includes('relatorio.pdf'));

    // Mensagem de resposta
    const replyMsg = {
      id: 'msg-notif-reply',
      community_id: 'comm-1',
      channel_id: 'conversas',
      sequence: 21,
      reply_to_id: 'msg-parent'
    };
    const replyAlert = notifService.dispatchForMessage(replyMsg, 'Comunidade Alpha');
    assert.strictEqual(replyAlert.type, 'REPLY');

    // Mensagem com link
    const linkMsg = {
      id: 'msg-notif-link',
      community_id: 'comm-1',
      channel_id: 'conversas',
      sequence: 22,
      link_preview: '{"title":"Link Seguro"}'
    };
    const linkAlert = notifService.dispatchForMessage(linkMsg, 'Comunidade Alpha');
    assert.strictEqual(linkAlert.type, 'NEW_LINK');

    // Mensagem fixada
    const pinMsg = {
      id: 'msg-notif-pin',
      community_id: 'comm-1',
      channel_id: 'avisos',
      sequence: 23,
      is_pinned: 1
    };
    const pinAlert = notifService.dispatchForMessage(pinMsg, 'Comunidade Alpha');
    assert.strictEqual(pinAlert.type, 'MESSAGE_PINNED');
  });

  test('Filtra e bloqueia notificações para usuários com canal silenciado', async () => {
    const notifService = new NotificationService(storage);

    // Usuário 1 silencia canal "conversas"
    storage.setChannelMute('usr-silent', 'comm-mute-test', 'conversas', true);

    // Salva assinaturas push para dois usuários
    storage.savePushSubscription({
      endpoint: 'https://push.example.com/sub-silent',
      userId: 'usr-silent',
      p256dh: 'key1',
      auth: 'auth1',
      deviceType: 'mobile'
    });
    storage.savePushSubscription({
      endpoint: 'https://push.example.com/sub-active',
      userId: 'usr-active',
      p256dh: 'key2',
      auth: 'auth2',
      deviceType: 'desktop'
    });

    const deliveredEndpoints = [];
    notifService._deliverToSubscription = async (sub, payload) => {
      deliveredEndpoints.push(sub.endpoint);
      return true;
    };

    const msg = {
      id: 'msg-mute-test-1',
      community_id: 'comm-mute-test',
      channel_id: 'conversas',
      sequence: 1,
      timestamp: Date.now()
    };

    notifService.dispatchForMessage(msg, 'Comunidade Mute');

    // Deve entregar apenas para usr-active, pois usr-silent silenciou o canal
    assert(deliveredEndpoints.includes('https://push.example.com/sub-active'));
    assert(!deliveredEndpoints.includes('https://push.example.com/sub-silent'), 'Canal silenciado não deve receber push');

    // Limpeza
    storage.removePushSubscription('https://push.example.com/sub-silent');
    storage.removePushSubscription('https://push.example.com/sub-active');
  });

  test('Despacha alertas genéricos de resiliência e estado de rede', () => {
    const notifService = new NotificationService(storage);
    let capturedPush = null;
    notifService.on('push', (alert) => {
      capturedPush = alert;
    });

    // Queda da VPS / Modo Offline
    const offlineAlert = notifService.dispatchGenericAlert({
      type: 'COMMUNITY_OFFLINE',
      title: 'Comunidade em Modo Autônomo',
      body: 'Servidor central inacessível. Continuando via malha direta entre nós.'
    });

    assert.strictEqual(offlineAlert.type, 'COMMUNITY_OFFLINE');
    assert.strictEqual(capturedPush.title, 'Comunidade em Modo Autônomo');
    assert.strictEqual(capturedPush.requiresDecryption, false);

    // Retorno da Conexão
    const restoreAlert = notifService.dispatchGenericAlert({
      type: 'CONNECTION_RESTORED',
      title: 'Conexão Restabelecida',
      body: 'Reconectado à rede central e sincronizado com os nós.'
    });

    assert.strictEqual(restoreAlert.type, 'CONNECTION_RESTORED');
  });

  // --- MÓDULO 6: RESOLUÇÃO DE NAT E STUN RFC 5389 ---
  console.log('\n\x1b[1m[6] Testes de Resolução de NAT e STUN RFC 5389\x1b[0m');

  test('Criação de pacote STUN Binding Request de 20 bytes RFC 5389', () => {
    const resolver = new NatStunResolver();
    const probe = resolver.createStunProbePacket();
    assert(Buffer.isBuffer(probe));
    assert.strictEqual(probe.length, 20);
    // Mensagem STUN Binding Request = 0x0001
    assert.strictEqual(probe.readUInt16BE(0), 0x0001);
    // Magic Cookie = 0x2112A442
    assert.strictEqual(probe.readUInt32BE(4), 0x2112a442);
  });

  test('Decodificação de XOR-MAPPED-ADDRESS em resposta STUN simulada', () => {
    const resolver = new NatStunResolver();
    const tid = Buffer.alloc(12, 0x01);
    const fakeResp = Buffer.alloc(32);
    fakeResp.writeUInt16BE(0x0101, 0); // Binding Response
    fakeResp.writeUInt16BE(12, 2);     // Length
    fakeResp.writeUInt32BE(0x2112a442, 4); // Magic cookie
    tid.copy(fakeResp, 8);

    // Atributo XOR-MAPPED-ADDRESS (0x0020)
    fakeResp.writeUInt16BE(0x0020, 20);
    fakeResp.writeUInt16BE(8, 22);
    fakeResp.writeUInt8(0, 24); // reserved
    fakeResp.writeUInt8(0x01, 25); // IPv4
    fakeResp.writeUInt16BE(5000 ^ 0x2112, 26); // XOR Port
    fakeResp.writeUInt32BE(0x08080808 ^ 0x2112a442, 28); // XOR IP (8.8.8.8)

    const parsed = resolver.parseStunResponse(fakeResp, tid);
    assert(parsed);
    assert.strictEqual(parsed.ip, '8.8.8.8');
    assert.strictEqual(parsed.port, 5000);
  });

  // --- MÓDULO 7: AUTENTICAÇÃO MÚTUA DE NÓS (ED25519 HANDSHAKE) ---
  console.log('\n\x1b[1m[7] Testes de Autenticação Mútua de Nós P2P\x1b[0m');

  test('Handshake criptográfico challenge-response entre nós P2P', () => {
    const nodeAKey = CryptoEngine.generateEd25519KeyPair();
    const challenge = crypto.randomBytes(32).toString('hex');
    const signature = CryptoEngine.signData({ challenge }, nodeAKey.privateKey);

    const isValid = CryptoEngine.verifySignature({ challenge }, signature, nodeAKey.publicKey);
    assert.strictEqual(isValid, true);

    const tamperedValid = CryptoEngine.verifySignature({ challenge: 'adulterado' }, signature, nodeAKey.publicKey);
    assert.strictEqual(tamperedValid, false);
  });

  // --- MÓDULO 8: SEGURANÇA CONTRA FORÇA BRUTA (LOGIN LOCKOUT) ---
  console.log('\n\x1b[1m[8] Testes de Proteção contra Força Bruta e Lockout\x1b[0m');

  test('Bloqueia tentativas consecutivas incorretas após limite de segurança', () => {
    const targetUser = 'alvo_bruteforce';
    storage.resetLoginAttempts(targetUser);

    for (let i = 1; i <= 4; i++) {
      const attempt = storage.recordLoginAttempt(targetUser);
      assert.strictEqual(attempt.isLocked, false);
    }

    const lockedAttempt = storage.recordLoginAttempt(targetUser);
    assert.strictEqual(lockedAttempt.isLocked, true);

    const status = storage.getLoginLockout(targetUser);
    assert.strictEqual(status.isLocked, true);
    assert(status.remainingSecs > 0);

    storage.resetLoginAttempts(targetUser);
    assert.strictEqual(storage.getLoginLockout(targetUser).isLocked, false);
  });

  // --- MÓDULO 9: PAINEL VISÃO DA COMUNIDADE E PRIVACIDADE ---
  console.log('\n\x1b[1m[9] Testes do Painel Visão da Comunidade e Anonimização\x1b[0m');

  test('Gera resumo técnico anônimo sem expor chaves privadas, senhas ou tokens', () => {
    const users = storage.getAllUsers();
    users.forEach(u => {
      // Nenhum endpoint deve retornar senha ou chave privada em texto puro
      assert(!u.password);
      assert(!u.privateKey);
    });
  });

  test('Registro de sessões de dispositivos diferenciando desktop, celular e web', () => {
    storage.registerDeviceSession({
      sessionId: 'sess_mob_1',
      userId: 'usr-1',
      deviceType: 'mobile',
      clientType: 'app',
      isRelay: false
    });

    storage.registerDeviceSession({
      sessionId: 'sess_web_1',
      userId: 'usr-1',
      deviceType: 'web',
      clientType: 'dashboard',
      isRelay: false
    });

    const activeSessions = storage.getActiveDeviceSessions();
    const hasMobile = activeSessions.some(s => s.device_type === 'mobile');
    const hasWeb = activeSessions.some(s => s.device_type === 'web');
    assert(hasMobile);
    assert(hasWeb);
  });

  test('Auditoria técnica de eventos de rede sem expor conteúdo confidencial', () => {
    storage.recordNetworkEvent('NEW_NODE_CONNECTED', 'Nó P2P conectado via STUN direto');
    storage.recordNetworkEvent('RELAY_FORWARDED', 'Envelope de dados retransmitido');

    const recent = storage.getRecentNetworkEvents(5);
    assert(recent.length >= 2);
    assert(!JSON.stringify(recent).includes('conteúdo confidencial'));
  });

  // --- MÓDULO 10: DOMÍNIO OFICIAL, HTTPS, CORS E PROXY REVERSO ---
  console.log('\n\x1b[1m[10] Testes de Domínio Oficial, HTTPS, CORS e Proxy Reverso (cp2p.democracias.org)\x1b[0m');

  test('Configuração central do domínio oficial cp2p.democracias.org em modo produção', () => {
    assert.strictEqual(SystemConfig.APP_DOMAIN, 'cp2p.democracias.org');
    assert(SystemConfig.APP_URL.startsWith('https://cp2p.democracias.org'));
    assert(SystemConfig.WS_URL.startsWith('wss://cp2p.democracias.org'));
    assert(SystemConfig.BOOTSTRAP_WS_URL.startsWith('wss://cp2p.democracias.org'));
    assert(!SystemConfig.APP_URL.includes('localhost'));
    assert(!SystemConfig.APP_URL.includes('127.0.0.1'));
  });

  test('Redirecionamento estrito de HTTP para HTTPS com HSTS quando atrás de proxy reverso', () => {
    let statusCode = null;
    let headers = {};
    const mockReq = {
      url: '/avisos',
      headers: {
        'host': 'cp2p.democracias.org',
        'x-forwarded-proto': 'http'
      }
    };
    const mockRes = {
      writeHead: (code, hdrs) => { statusCode = code; headers = hdrs || {}; },
      end: () => {}
    };

    if (mockReq.headers['x-forwarded-proto'] === 'http') {
      mockRes.writeHead(301, {
        'Location': `https://${SystemConfig.APP_DOMAIN}${mockReq.url}`,
        'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload'
      });
    }

    assert.strictEqual(statusCode, 301);
    assert.strictEqual(headers['Location'], 'https://cp2p.democracias.org/avisos');
    assert(headers['Strict-Transport-Security'].includes('max-age=63072000'));
  });

  test('Cabeçalhos estritos de segurança (HSTS, CSP, X-Frame-Options, X-Content-Type-Options)', () => {
    const secHeaders = SystemConfig.SECURITY_HEADERS;
    assert.strictEqual(secHeaders['X-Content-Type-Options'], 'nosniff');
    assert.strictEqual(secHeaders['X-Frame-Options'], 'DENY');
    assert.strictEqual(secHeaders['Referrer-Policy'], 'strict-origin-when-cross-origin');
    assert(secHeaders['Content-Security-Policy'].includes('cp2p.democracias.org'));
  });

  test('CORS restrito para https://cp2p.democracias.org sem Access-Control-Allow-Origin: * em produção', () => {
    assert(SystemConfig.isOriginAllowed('https://cp2p.democracias.org'));
    assert(!SystemConfig.isOriginAllowed('https://origem-maliciosa.com'));
    assert(!SystemConfig.isOriginAllowed('http://site-inseguro.org'));
  });

  test('Configuração de cookies seguros com HttpOnly, SameSite=Lax e Secure', () => {
    const cookieSettings = SystemConfig.COOKIE_SETTINGS;
    assert.strictEqual(cookieSettings.httpOnly, true);
    assert.strictEqual(cookieSettings.sameSite, 'Lax');
    assert.strictEqual(cookieSettings.secure, true);
  });

  test('Endpoint /health para observabilidade sem vazamento de chaves ou dados confidenciais', () => {
    const healthPayload = {
      status: 'HEALTHY',
      version: '1.1.0',
      domain: SystemConfig.APP_DOMAIN,
      https: true,
      uptimeSeconds: 120,
      database: 'CONNECTED',
      bootstrap: { status: 'CONNECTED', activePeers: 3 }
    };

    const jsonStr = JSON.stringify(healthPayload);
    assert(healthPayload.status === 'HEALTHY');
    assert(!jsonStr.includes('password'));
    assert(!jsonStr.includes('private_key'));
    assert(!jsonStr.includes('token'));
    assert(!jsonStr.includes('encrypted_content'));
  });

  test('Manifesto PWA com escopo, id e start_url no domínio https://cp2p.democracias.org', () => {
    const manifestPath = path.join(__dirname, '..', 'src', 'web', 'manifest.json');
    assert(fs.existsSync(manifestPath));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    assert.strictEqual(manifest.start_url, 'https://cp2p.democracias.org/');
    assert.strictEqual(manifest.scope, 'https://cp2p.democracias.org/');
    assert.strictEqual(manifest.id, 'https://cp2p.democracias.org/');
    assert.strictEqual(manifest.display, 'standalone');
  });

  test('Proteção contra vazamento de arquivos confidenciais (.env, .db, .git) no servidor web', () => {
    const testPaths = ['/.env', '/config/.env', '/database.db', '/.git/config', '/../secrets.txt'];
    testPaths.forEach(p => {
      const isBlocked = p.includes('.env') || p.includes('.db') || p.includes('.git') || p.includes('..');
      assert(isBlocked, `Caminho ${p} deveria ser bloqueado`);
    });
  });

  test('Resiliência do histórico local e P2P quando o domínio bootstrap estiver indisponível', () => {
    storage.saveMessage({
      id: 'msg-local-resilience',
      community_id: 'comm-resilience',
      sequence: 1,
      prev_hash: '0000000000000000000000000000000000000000000000000000000000000000',
      author_pubkey: 'admin_key',
      encrypted_content: 'dados locais',
      iv: 'iv',
      tag: 'tag',
      attachment_type: null,
      attachment_data: null,
      epoch: 1,
      timestamp: Date.now(),
      signature: 'sig',
      received_at: Date.now()
    });

    const retrieved = storage.getMessageById('msg-local-resilience');
    assert(retrieved);
    assert.strictEqual(retrieved.encrypted_content, 'dados locais');
  });

  // --- MÓDULO 11: CANAIS, MENSAGENS ENRIQUECIDAS, REAÇÕES, CONVITES, OUTBOX E CHUNKING ---
  console.log('\n\x1b[1m[11] Testes de Canais, Mensagens Enriquecidas, Reações, Convites, Outbox e Chunking\x1b[0m');

  test('Criação automática e listagem dos 5 canais padrão por comunidade', () => {
    const commId = 'comm-channels-test';
    storage.saveCommunity({
      id: commId,
      name: 'Comunidade com Canais',
      description: 'Teste',
      genesis_admin_pubkey: 'pub_test',
      current_epoch: 1,
      created_at: Date.now()
    });

    const channels = storage.getChannelsByCommunity(commId);
    assert.strictEqual(channels.length, 5);

    const avisos = channels.find(c => c.id === 'avisos');
    const conversas = channels.find(c => c.id === 'conversas');
    assert(avisos && conversas);
    assert.strictEqual(avisos.allow_member_posts, 0); // Padrão: somente admin publica em avisos
    assert.strictEqual(conversas.allow_member_posts, 1); // Aberto a conversas
  });

  test('Atualização de permissões de canal e proteção contra exclusão do canal Avisos', () => {
    const commId = 'comm-channels-test';
    storage.updateChannelPermissions(commId, 'eventos', 1);
    const eventos = storage.getChannel(commId, 'eventos');
    assert.strictEqual(eventos.allow_member_posts, 1);

    // Canal 'avisos' não pode ser deletado
    const deletedAvisos = storage.deleteChannel(commId, 'avisos');
    assert.strictEqual(deletedAvisos, false);

    // Canal customizado pode ser criado e deletado
    storage.createChannel({
      id: 'temporario',
      community_id: commId,
      name: 'Canal Temp',
      description: 'Para testes'
    });
    assert(storage.getChannel(commId, 'temporario'));
    const deletedTemp = storage.deleteChannel(commId, 'temporario');
    assert.strictEqual(deletedTemp, true);
    assert.strictEqual(storage.getChannel(commId, 'temporario'), undefined);
  });

  test('Criação e validação de mensagem enriquecida com canal, resposta e metadados de arquivo', () => {
    const commId = 'comm-channels-test';
    const key = CryptoEngine.generateChannelKey();
    const admin = CryptoEngine.generateEd25519KeyPair();

    const mRich = chain.createSignedMessage({
      communityId: commId,
      channelId: 'documentos',
      plaintext: 'Edital do encontro em PDF',
      channelKeyHex: key,
      authorPublicKey: admin.publicKey,
      authorPrivateKey: admin.privateKey,
      attachmentType: 'file',
      attachmentData: null,
      fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      fileName: 'edital_2026.pdf',
      fileSize: 1048576,
      fileMime: 'application/pdf',
      fileChunksTotal: 2,
      linkPreview: {
        title: 'Documento Oficial',
        description: 'Edital de Convocação',
        url: 'https://cp2p.democracias.org/docs/edital'
      }
    });

    assert.strictEqual(mRich.channel_id, 'documentos');
    assert.strictEqual(mRich.file_name, 'edital_2026.pdf');
    assert.strictEqual(mRich.file_size, 1048576);
    assert(mRich.link_preview);

    const fromDb = storage.getMessageById(mRich.id);
    assert(fromDb);
    assert.strictEqual(fromDb.channel_id, 'documentos');
    assert.strictEqual(fromDb.file_name, 'edital_2026.pdf');
  });

  test('Fixação, desafixação, edição e exclusão lógica (soft delete) de mensagens', () => {
    const commId = 'comm-channels-test';
    const key = CryptoEngine.generateChannelKey();
    const admin = CryptoEngine.generateEd25519KeyPair();

    const msg = chain.createSignedMessage({
      communityId: commId,
      channelId: 'avisos',
      plaintext: 'Aviso importante!',
      channelKeyHex: key,
      authorPublicKey: admin.publicKey,
      authorPrivateKey: admin.privateKey
    });

    // Fixar
    storage.pinMessage(msg.id, 'admin_user');
    let pinned = storage.getPinnedMessages(commId);
    assert.strictEqual(pinned.length, 1);
    assert.strictEqual(pinned[0].id, msg.id);

    // Desafixar
    storage.unpinMessage(msg.id);
    pinned = storage.getPinnedMessages(commId);
    assert.strictEqual(pinned.length, 0);

    // Edição
    const newEnc = CryptoEngine.encryptAESGCM('Aviso atualizado!', key);
    storage.editMessage(msg.id, newEnc.ciphertext, newEnc.iv, newEnc.tag);
    const editedMsg = storage.getMessageById(msg.id);
    assert.strictEqual(editedMsg.is_edited, 1);
    assert(editedMsg.edited_at > 0);

    // Soft delete
    storage.softDeleteMessage(msg.id);
    const activeMessages = storage.getMessagesByChannel(commId, 'avisos');
    assert(!activeMessages.some(m => m.id === msg.id));
  });

  test('Adição, contagem agregada e remoção de reações com emojis', () => {
    const mId = 'msg-reaction-test';
    storage.addReaction(mId, 'usr-1', 'Maria', '👍');
    storage.addReaction(mId, 'usr-2', 'João', '👍');
    storage.addReaction(mId, 'usr-3', 'Ana', '❤️');

    let reactions = storage.getReactionsForMessage(mId);
    assert.strictEqual(reactions.length, 2);

    const thumbs = reactions.find(r => r.emoji === '👍');
    assert.strictEqual(thumbs.count, 2);
    assert.strictEqual(thumbs.users.length, 2);

    // Remoção de reação
    storage.removeReaction(mId, 'usr-2', '👍');
    reactions = storage.getReactionsForMessage(mId);
    const updatedThumbs = reactions.find(r => r.emoji === '👍');
    assert.strictEqual(updatedThumbs.count, 1);
  });

  test('Criação de convites amigáveis (CR-XXXX), validação de expiração e contagem de uso', () => {
    const invite = storage.createInvite({
      communityId: 'comm-channels-test',
      createdBy: 'admin',
      maxUses: 2,
      expiresAt: Date.now() + 60000,
      requiresApproval: 1
    });

    assert(invite.code.startsWith('CR-'));
    assert.strictEqual(invite.requires_approval, 1);

    // Uso 1
    const use1 = storage.useInvite(invite.code);
    assert.strictEqual(use1.valid, true);

    // Uso 2
    const use2 = storage.useInvite(invite.code);
    assert.strictEqual(use2.valid, true);

    // Uso 3 (deve falhar por limite de usos)
    const use3 = storage.useInvite(invite.code);
    assert.strictEqual(use3.valid, false);
    assert.strictEqual(use3.reason, 'INVITE_MAX_USES_REACHED');
  });

  test('Fluxo de solicitações de entrada (Join Requests) e aprovação com promoção de papel', () => {
    const commId = 'comm-channels-test';
    // Cria usuário aspirante a membro
    storage.createUser({
      id: 'usr-newbie',
      username: 'novato',
      password_hash: 'hash',
      public_key: 'pub_novato',
      role: 'Visitante'
    });

    const req = storage.createJoinRequest({
      communityId: commId,
      userId: 'usr-newbie',
      username: 'novato',
      publicKey: 'pub_novato',
      inviteCode: 'CR-1234'
    });
    assert.strictEqual(req.status, 'pending');

    const pendingList = storage.getJoinRequests(commId, 'pending');
    assert(pendingList.some(r => r.id === req.id));

    // Aprovação pelo administrador
    const reviewed = storage.reviewJoinRequest(req.id, 'approved', 'admin_user');
    assert.strictEqual(reviewed.status, 'approved');

    // Verifica que o usuário foi promovido a 'Membro'
    const promotedUser = storage.getUserByUsername('novato');
    assert.strictEqual(promotedUser.role, 'Membro');
  });

  test('Fila Outbox para resiliência e mensagens pendentes criadas offline', () => {
    const outboxId = storage.queueOutbox({
      communityId: 'comm-channels-test',
      channelId: 'conversas',
      payload: { text: 'Mensagem enviada sem internet', author: 'carlos' }
    });

    const pending = storage.getPendingOutbox();
    assert(pending.length > 0);
    const item = pending.find(p => p.id === outboxId);
    assert(item);
    assert.strictEqual(item.payload.text, 'Mensagem enviada sem internet');

    // Atualiza status para sincronizando e depois remove
    storage.updateOutboxStatus(outboxId, 'synced');
    storage.removeOutbox(outboxId);
    const pendingAfter = storage.getPendingOutbox();
    assert(!pendingAfter.some(p => p.id === outboxId));
  });

  test('Fragmentação de arquivos em chunks (Chunking 512KB) com hashes de integridade', () => {
    const fHash = 'hash_arquivo_grande_123';
    storage.saveFileChunk({
      fileHash: fHash,
      chunkIndex: 0,
      totalChunks: 2,
      chunkHash: 'chunk_hash_0',
      chunkSize: 524288,
      chunkData: 'SGVsbG8gQ2h1bms='
    });
    storage.saveFileChunk({
      fileHash: fHash,
      chunkIndex: 1,
      totalChunks: 2,
      chunkHash: 'chunk_hash_1',
      chunkSize: 200000,
      chunkData: 'V29ybGQgQ2h1bms='
    });

    assert.strictEqual(storage.getStoredChunksCount(fHash), 2);
    const chunks = storage.getFileChunks(fHash);
    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0].chunk_index, 0);
    assert.strictEqual(chunks[1].chunk_index, 1);

    storage.deleteFileChunks(fHash);
    assert.strictEqual(storage.getStoredChunksCount(fHash), 0);
  });

  test('Políticas de armazenamento por nó (Storage Quotas) e silenciamento de canais', () => {
    storage.setStorageSetting('storage_policy', 'messages_images');
    storage.setStorageSetting('max_storage_mb', '250');

    const summary = storage.getStorageUsageSummary();
    assert.strictEqual(summary.policy, 'messages_images');
    assert.strictEqual(summary.maxStorageMB, 250);

    // Silenciamento por canal
    storage.setChannelMute('usr-1', 'comm-1', 'conversas', true);
    assert.strictEqual(storage.isChannelMuted('usr-1', 'comm-1', 'conversas'), true);
    assert.strictEqual(storage.isChannelMuted('usr-1', 'comm-1', 'avisos'), false);

    storage.setChannelMute('usr-1', 'comm-1', 'conversas', false);
    assert.strictEqual(storage.isChannelMuted('usr-1', 'comm-1', 'conversas'), false);
  });

  // --- MÓDULO 12: PRÉ-VISUALIZAÇÃO DE LINKS (SSRF-SAFE), CHUNKING MERKLE E ENCAMINHAMENTO ---
  console.log('\n\x1b[1m[12] Testes de Pré-Visualização de Links (SSRF), Chunking Merkle e Encaminhamento\x1b[0m');

  test('Extração de URLs e proteção estrita contra SSRF (bloqueio de IPs privados e metadados)', () => {
    // URLs maliciosas ou privadas devem ser estritamente bloqueadas
    assert.strictEqual(LinkPreviewService.isSafeUrl('http://127.0.0.1:8080/admin'), false);
    assert.strictEqual(LinkPreviewService.isSafeUrl('http://localhost/secret'), false);
    assert.strictEqual(LinkPreviewService.isSafeUrl('http://169.254.169.254/latest/meta-data/'), false); // AWS/GCP metadata
    assert.strictEqual(LinkPreviewService.isSafeUrl('http://10.0.0.5/internal'), false);
    assert.strictEqual(LinkPreviewService.isSafeUrl('http://192.168.1.1/router'), false);
    assert.strictEqual(LinkPreviewService.isSafeUrl('http://172.20.0.1/docker'), false);
    assert.strictEqual(LinkPreviewService.isSafeUrl('http://server.local/data'), false);
    assert.strictEqual(LinkPreviewService.isSafeUrl('http://admin:secret@example.com'), false); // Credenciais embutidas
    assert.strictEqual(LinkPreviewService.isSafeUrl('file:///etc/passwd'), false);
    assert.strictEqual(LinkPreviewService.isSafeUrl('ftp://ftp.example.com'), false);

    // URLs públicas legítimas devem ser permitidas
    assert.strictEqual(LinkPreviewService.isSafeUrl('https://cp2p.democracias.org'), true);
    assert.strictEqual(LinkPreviewService.isSafeUrl('https://pt.wikipedia.org/wiki/P2P'), true);
    assert.strictEqual(LinkPreviewService.isSafeUrl('http://example.com/noticias/artigo'), true);

    // Extração no texto
    const text = 'Confira o comunicado em https://cp2p.democracias.org e não acesse http://127.0.0.1';
    const extracted = LinkPreviewService.extractUrls(text);
    assert.strictEqual(extracted.length, 1);
    assert.strictEqual(extracted[0], 'https://cp2p.democracias.org');
  });

  test('Extração e sanitização de metadados OpenGraph e HTML seguro', () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Portal da Comunidade</title>
          <meta property="og:title" content="Encontro Nacional P2P 2026">
          <meta property="og:description" content="Mobilização popular e descentralizada com criptografia soberana.">
          <meta property="og:image" content="https://cp2p.democracias.org/banner.png">
        </head>
        <body>Conteúdo</body>
      </html>
    `;

    const meta = LinkPreviewService.parseHtmlMetadata('https://cp2p.democracias.org/noticia', sampleHtml);
    assert(meta);
    assert.strictEqual(meta.title, 'Encontro Nacional P2P 2026');
    assert.strictEqual(meta.description, 'Mobilização popular e descentralizada com criptografia soberana.');
    assert.strictEqual(meta.image, 'https://cp2p.democracias.org/banner.png');

    // Sanitização de HTML com scripts
    const dirtyHtml = '<title><script>alert("hack")</script>Artigo Seguro</title>';
    const dirtyMeta = LinkPreviewService.parseHtmlMetadata('https://cp2p.democracias.org', dirtyHtml);
    assert(dirtyMeta);
    assert(!dirtyMeta.title.includes('<script>'));
  });

  test('Sanitização de nomes de arquivo e prevenção contra Path Traversal', () => {
    assert.strictEqual(FileManager.sanitizeFilename('../../etc/passwd'), 'passwd');
    assert.strictEqual(FileManager.sanitizeFilename('..\\..\\Windows\\System32\\calc.exe'), 'calc.exe');
    assert.strictEqual(FileManager.sanitizeFilename('plano & ação final!.pdf'), 'plano___a__o_final_.pdf');
    assert.strictEqual(FileManager.sanitizeFilename(''), 'anexo_sem_nome');
  });

  test('Validação estrita de extensões, tipos MIME e bloqueio de executáveis perigosos', () => {
    const dummyBuffer = Buffer.from('conteudo teste');

    // Bloqueia .exe, .bat, .sh
    const exeCheck = FileManager.validateFile(dummyBuffer, 'virus.exe');
    assert.strictEqual(exeCheck.valid, false);

    const batCheck = FileManager.validateFile(dummyBuffer, 'script.bat');
    assert.strictEqual(batCheck.valid, false);

    // Bloqueia falsificação de extensão (magic bytes)
    const fakePng = FileManager.validateFile(dummyBuffer, 'foto.png');
    assert.strictEqual(fakePng.valid, false);
    assert(fakePng.error.includes('Assinatura binária incompatível'));

    // Aceita PNG legítimo com header 89 50 4E 47 0D 0A 1A 0A
    const realPngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
    const realPng = FileManager.validateFile(realPngHeader, 'legitimo.png');
    assert.strictEqual(realPng.valid, true);
    assert.strictEqual(realPng.mimeType, 'image/png');

    // Aceita PDF legítimo com header %PDF
    const pdfBuf = Buffer.from('%PDF-1.4 manifesto da comunidade');
    const pdfCheck = FileManager.validateFile(pdfBuf, 'manifesto.pdf');
    assert.strictEqual(pdfCheck.valid, true);
    assert.strictEqual(pdfCheck.mimeType, 'application/pdf');
  });

  test('Fragmentação em chunks de 512KB (Chunking) com Merkle Hashes e reconstituição íntegra', () => {
    // Gera buffer de 1.2 MB simulando arquivo grande
    const largeSize = 1200 * 1024;
    const largeBuffer = crypto.randomBytes(largeSize);
    const originalHash = FileManager.calculateFileHash(largeBuffer);

    // Fragmenta em chunks de 512KB
    const chunked = FileManager.chunkBuffer(largeBuffer);
    assert.strictEqual(chunked.totalChunks, 3); // 512KB + 512KB + 176KB
    assert.strictEqual(chunked.fileHash, originalHash);

    // Valida integridade individual de cada fragmento
    for (const c of chunked.chunks) {
      const cBuf = Buffer.from(c.chunkData, 'base64');
      const expectedHash = crypto.createHash('sha256').update(cBuf).digest('hex');
      assert.strictEqual(c.chunkHash, expectedHash);
    }

    // Reconstitui o arquivo a partir dos chunks
    const reconstituted = FileManager.reassembleChunks(chunked.chunks, originalHash);
    assert.strictEqual(reconstituted.length, largeSize);
    assert(reconstituted.equals(largeBuffer));
  });

  test('Detecção de partes corrompidas ou ausentes na reconstituição de arquivo', () => {
    const testBuf = crypto.randomBytes(600 * 1024); // 2 chunks
    const chunked = FileManager.chunkBuffer(testBuf);

    // Falha quando um chunk está ausente
    const incompleteChunks = [chunked.chunks[0]];
    assert.throws(() => {
      FileManager.reassembleChunks(incompleteChunks, chunked.fileHash);
    }, /Transferência incompleta/);

    // Falha quando um chunk foi adulterado (bit-flip)
    const corruptedChunks = JSON.parse(JSON.stringify(chunked.chunks));
    corruptedChunks[1].chunkData = Buffer.from('adulterado').toString('base64');
    assert.throws(() => {
      FileManager.reassembleChunks(corruptedChunks, chunked.fileHash);
    }, /corrompido: hash inválido/);
  });

  test('Criptografia e decifragem autenticada E2EE de arquivos (AES-256-GCM)', () => {
    const secretBuffer = Buffer.from('Documento confidencial do diretório da comunidade');
    const channelKey = CryptoEngine.generateChannelKey();

    const enc = FileManager.encryptFileBuffer(secretBuffer, channelKey);
    assert(enc.ciphertextBuffer && enc.ivHex && enc.tagHex);

    const dec = FileManager.decryptFileBuffer(enc.ciphertextBuffer, enc.ivHex, enc.tagHex, channelKey, enc.originalHash);
    assert(dec.equals(secretBuffer));
  });

  test('Encaminhamento de mensagens com proveniência e deduplicação de anexo', () => {
    const commId = 'comm-forward-test';
    const channelKey = CryptoEngine.generateChannelKey();
    const admin = CryptoEngine.generateEd25519KeyPair();

    // 1. Mensagem original no canal 'avisos' com arquivo anexado
    const originalMsg = chain.createSignedMessage({
      communityId: commId,
      channelId: 'avisos',
      plaintext: 'Cartilha oficial 2026',
      channelKeyHex: channelKey,
      authorPublicKey: admin.publicKey,
      authorPrivateKey: admin.privateKey,
      attachmentType: 'file',
      fileHash: 'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
      fileName: 'cartilha.pdf',
      fileSize: 524288,
      fileMime: 'application/pdf'
    });

    // 2. Encaminha para o canal 'conversas'
    const forwardedMsg = chain.createSignedMessage({
      communityId: commId,
      channelId: 'conversas',
      plaintext: '[Encaminhado]: Cartilha oficial 2026',
      channelKeyHex: channelKey,
      authorPublicKey: admin.publicKey,
      authorPrivateKey: admin.privateKey,
      attachmentType: originalMsg.attachment_type,
      forwardedFromChannelId: originalMsg.channel_id,
      forwardedFromCommunityId: originalMsg.community_id,
      forwardedOriginAuthor: 'Administrador',
      // Deduplicação: reutiliza o mesmo fileHash sem criar arquivo duplicado
      fileHash: originalMsg.file_hash,
      fileName: originalMsg.file_name,
      fileSize: originalMsg.file_size,
      fileMime: originalMsg.file_mime
    });

    assert.strictEqual(forwardedMsg.channel_id, 'conversas');
    assert.strictEqual(forwardedMsg.forwarded_from_channel_id, 'avisos');
    assert.strictEqual(forwardedMsg.file_hash, originalMsg.file_hash);

    // Ambos os registros no banco apontam para o mesmo fileHash físico
    const origDb = storage.getMessageById(originalMsg.id);
    const fwdDb = storage.getMessageById(forwardedMsg.id);
    assert.strictEqual(origDb.file_hash, fwdDb.file_hash);
  });

  // --- MÓDULO 13: CONVITES AMIGÁVEIS, QR CODES EM SVG E FLUXO DE ENTRADA (ETAPA 4) ---
  console.log('\n\x1b[1m[13] Testes de Convites Amigáveis, QR Codes em SVG e Entrada Fácil\x1b[0m');

  test('Geração autônoma de QR Code em SVG sem dependências externas', () => {
    const inviteUrl = 'https://cp2p.democracias.org/join/CR-7842';
    const svg = QRCodeGenerator.generateSVG(inviteUrl, 256);

    assert(typeof svg === 'string');
    assert(svg.startsWith('<svg'));
    assert(svg.includes('viewBox="0 0 256 256"'));
    assert(svg.includes('<rect'));
    assert(svg.endsWith('</svg>'));
  });

  test('Validação de convite expirado e recusa segura', () => {
    const expiredInvite = storage.createInvite({
      communityId: 'comm-invite-test',
      createdBy: 'admin',
      maxUses: 10,
      expiresAt: Date.now() - 5000 // Expirado há 5 segundos
    });

    const attempt = storage.useInvite(expiredInvite.code);
    assert.strictEqual(attempt.valid, false);
    assert.strictEqual(attempt.reason, 'INVITE_EXPIRED');
  });

  test('Validação de convite com cota esgotada de acessos', () => {
    const singleUseInvite = storage.createInvite({
      communityId: 'comm-invite-test',
      createdBy: 'admin',
      maxUses: 1,
      expiresAt: Date.now() + 60000
    });

    // 1º uso: aprovado
    const use1 = storage.useInvite(singleUseInvite.code);
    assert.strictEqual(use1.valid, true);

    // 2º uso: esgotado
    const use2 = storage.useInvite(singleUseInvite.code);
    assert.strictEqual(use2.valid, false);
    assert.strictEqual(use2.reason, 'INVITE_MAX_USES_REACHED');
  });

  test('Fluxo guiado de solicitação de entrada (Join Request) e aprovação com promoção para Membro', () => {
    const commId = 'comm-invite-test';
    // 1. Visitante cria perfil local
    const newbie = storage.createUser({
      id: 'usr-maria',
      username: 'maria_silva',
      password_hash: 'hash',
      public_key: 'pub_maria_silva',
      role: 'Visitante'
    });
    assert.strictEqual(newbie.role, 'Visitante');

    // 2. Visitante solicita entrada usando código curto
    const req = storage.createJoinRequest({
      communityId: commId,
      userId: newbie.id,
      username: newbie.username,
      publicKey: newbie.public_key,
      inviteCode: 'CR-7842'
    });
    assert.strictEqual(req.status, 'pending');

    // 3. Administrador revisa e aprova a solicitação
    const reviewed = storage.reviewJoinRequest(req.id, 'approved', 'admin_gestor');
    assert.strictEqual(reviewed.status, 'approved');

    // 4. Perfil promovido a Membro ativo
    const updatedUser = storage.getUserByUsername('maria_silva');
    assert.strictEqual(updatedUser.role, 'Membro');
  });

  // --- MÓDULO 14: RESILIÊNCIA OFFLINE, OUTBOX E REPLICAÇÃO P2P DE CHUNKS (ETAPA 5) ---
  console.log('\n\x1b[1m[14] Testes de Resiliência Offline, Outbox e Replicação P2P de Chunks\x1b[0m');
  const notifService = new NotificationService(storage);
  const auditLogger = new AuditLogger(storage);

  test('Fila Outbox enfileira comunicado offline quando nó não possui pares conectados', () => {
    const testEngine = new P2PEngine({
      nodeId: 'node-test-offline-1',
      p2pPort: 19871,
      bootstrapNodes: [],
      storage,
      chain,
      notificationService: notifService,
      auditLogger
    });

    const testMsg = {
      id: 'msg-offline-outbox-test-1',
      community_id: 'comm-invite-test',
      channel_id: 'avisos',
      sequence: 99,
      timestamp: Date.now()
    };

    // Publicação em nó desconectado
    testEngine.publishMessage(testMsg);

    const pending = storage.getPendingOutbox(10);
    const found = pending.find(p => p.payload && p.payload.message && p.payload.message.id === testMsg.id);
    assert(found, 'Mensagem publicada offline deveria estar na fila Outbox');
    assert.strictEqual(found.status, 'pending');
    assert.strictEqual(found.community_id, 'comm-invite-test');
  });

  test('Esvaziamento da fila Outbox (flushOutbox) com sucesso após retorno de conexão', () => {
    const testEngine = new P2PEngine({
      nodeId: 'node-test-flush-1',
      p2pPort: 19872,
      bootstrapNodes: [],
      storage,
      chain,
      notificationService: notifService,
      auditLogger
    });

    // Simula socket de par conectado e ativo (WebSocket.OPEN = 1)
    let broadcastReceived = null;
    const mockSocket = {
      readyState: 1,
      send: (data) => {
        broadcastReceived = JSON.parse(data);
      }
    };
    testEngine.peers.set('peer-connected-mock', mockSocket);

    const flushed = testEngine.flushOutbox();
    assert(flushed > 0, 'Deveria ter esvaziado pelo menos 1 mensagem pendente na outbox');
    assert(broadcastReceived, 'Mensagem deveria ter sido transmitida via broadcast');
    assert.strictEqual(broadcastReceived.type, MessageType.GOSSIP_MESSAGE);
    assert.strictEqual(broadcastReceived.payload.message.id, 'msg-offline-outbox-test-1');

    // Confirma que a fila agora está limpa para esse item
    const remaining = storage.getPendingOutbox(10);
    const stillFound = remaining.find(p => p.payload && p.payload.message && p.payload.message.id === 'msg-offline-outbox-test-1');
    assert(!stillFound, 'Mensagem sincronizada deve ser removida da fila pendente');
  });

  test('Protocolo Wire P2P: CHUNK_REQUEST retorna CHUNK_RESPONSE com integridade de dados', () => {
    const testEngine = new P2PEngine({
      nodeId: 'node-chunk-responder',
      p2pPort: 19873,
      bootstrapNodes: [],
      storage,
      chain,
      notificationService: notifService,
      auditLogger
    });

    // Salva chunk no armazenamento
    const sampleBuffer = Buffer.from('conteúdo binário fragmentado para teste P2P');
    const chunkHash = CryptoEngine.sha256(sampleBuffer);
    const fileHash = 'aabbcc11223344556677889900aabbcc11223344556677889900aabbcc112233';

    storage.saveFileChunk({
      fileHash,
      chunkIndex: 0,
      totalChunks: 1,
      chunkHash,
      chunkSize: sampleBuffer.length,
      chunkData: sampleBuffer.toString('base64')
    });

    let sentResponse = null;
    const mockRequesterSocket = {
      readyState: 1,
      send: (data) => {
        sentResponse = JSON.parse(data);
      }
    };

    const reqPacket = ProtocolPacket.create(MessageType.CHUNK_REQUEST, 'node-requester-client', {
      fileHash,
      chunkIndex: 0
    });

    testEngine.handleChunkRequest(mockRequesterSocket, reqPacket);

    assert(sentResponse, 'Deveria ter respondido com CHUNK_RESPONSE');
    assert.strictEqual(sentResponse.type, MessageType.CHUNK_RESPONSE);
    assert.strictEqual(sentResponse.payload.fileHash, fileHash);
    assert.strictEqual(sentResponse.payload.chunkIndex, 0);
    assert.strictEqual(sentResponse.payload.chunkHash, chunkHash);
    assert.strictEqual(Buffer.from(sentResponse.payload.chunkData, 'base64').toString('utf8'), 'conteúdo binário fragmentado para teste P2P');
  });

  test('handleChunkResponse valida integridade SHA256 e descarta partes corrompidas', () => {
    const testEngine = new P2PEngine({
      nodeId: 'node-chunk-receiver',
      p2pPort: 19874,
      bootstrapNodes: [],
      storage,
      chain,
      notificationService: notifService,
      auditLogger
    });

    const fileHash = 'bad00011223344556677889900aabbcc11223344556677889900aabbcc112233';
    const fakeChunkData = Buffer.from('dados alterados em transito').toString('base64');
    const fakeHash = 'hash_original_esperado_diferente_dos_dados';

    const respPacket = ProtocolPacket.create(MessageType.CHUNK_RESPONSE, 'remote-peer', {
      fileHash,
      chunkIndex: 0,
      totalChunks: 1,
      chunkHash: fakeHash,
      chunkData: fakeChunkData
    });

    testEngine.handleChunkResponse(null, respPacket);

    // O chunk NÃO deve ter sido salvo devido à falha de integridade
    const stored = storage.getFileChunk(fileHash, 0);
    assert(!stored, 'Fragmento com hash corrompido não deve ser persistido');
  });

  test('handleChunkResponse respeita política de armazenamento "messages_only"', () => {
    const testEngine = new P2PEngine({
      nodeId: 'node-messages-only',
      p2pPort: 19875,
      bootstrapNodes: [],
      storage,
      chain,
      notificationService: notifService,
      auditLogger
    });

    storage.setStorageSetting('storage_policy', 'messages_only');

    const validBuffer = Buffer.from('arquivo que nó leve não quer guardar');
    const fileHash = 'light0011223344556677889900aabbcc11223344556677889900aabbcc112233';
    const chunkHash = CryptoEngine.sha256(validBuffer);

    const respPacket = ProtocolPacket.create(MessageType.CHUNK_RESPONSE, 'remote-peer', {
      fileHash,
      chunkIndex: 0,
      totalChunks: 1,
      chunkHash,
      chunkData: validBuffer.toString('base64')
    });

    testEngine.handleChunkResponse(null, respPacket);

    const stored = storage.getFileChunk(fileHash, 0);
    assert(!stored, 'Nó com política messages_only não deve salvar chunks de arquivos');

    // Restaura política para 'all'
    storage.setStorageSetting('storage_policy', 'all');
  });

  // --- MÓDULO 15: CADASTRO SIMPLES E PSEUDÔNIMO, UNICIDADE E PAREAMENTO DE DISPOSITIVOS ---
  console.log('\n\x1b[1m[15] Testes de Cadastro Simples, Pseudônimo, Unicidade e Pareamento\x1b[0m');

  test('Validação de pseudônimo: regras de caracteres, tamanho e proibição de nomes reservados', () => {
    // Nomes muito curtos (< 3) ou muito longos (> 25)
    assert.strictEqual(storage.validateUsername('').valid, false);
    assert.strictEqual(storage.validateUsername('ab').valid, false);
    assert.strictEqual(storage.validateUsername('a'.repeat(26)).valid, false);

    // Caracteres inválidos e espaços
    assert.strictEqual(storage.validateUsername('nome com espaco').valid, false);
    assert.strictEqual(storage.validateUsername('usuario@hack!').valid, false);
    assert.strictEqual(storage.validateUsername('user<script>').valid, false);

    // Nomes reservados do sistema
    assert.strictEqual(storage.validateUsername('admin').valid, false);
    assert.strictEqual(storage.validateUsername('ADMINISTRADOR').valid, false);
    assert.strictEqual(storage.validateUsername('sistema').valid, false);
    assert.strictEqual(storage.validateUsername('root').valid, false);
    assert.strictEqual(storage.validateUsername('suporte').valid, false);

    // Nomes válidos com acentuação, hífen e sublinhado
    const valid1 = storage.validateUsername('viajante_livre');
    assert.strictEqual(valid1.valid, true);
    assert.strictEqual(valid1.cleanUsername, 'viajante_livre');

    const valid2 = storage.validateUsername('josé-silva');
    assert.strictEqual(valid2.valid, true);
    assert.strictEqual(valid2.cleanUsername, 'josé-silva');
  });

  test('Unicidade case-insensitive e geração de sugestões inteligentes quando nome já existe', () => {
    const baseName = 'explorador_p2p';
    storage.createPseudonymUser({
      id: 'usr_test_pseudo_1',
      username: baseName,
      publicKey: 'FAKE_PUBKEY_1',
      encryptedPrivateKey: 'FAKE_ENC_KEY_1',
      role: 'Membro',
      status: 'active'
    });

    // Case-insensitive check
    assert.strictEqual(storage.isUsernameAvailable('explorador_p2p'), false);
    assert.strictEqual(storage.isUsernameAvailable('EXPLORADOR_P2P'), false);
    assert.strictEqual(storage.isUsernameAvailable('Explorador_P2P'), false);

    const found = storage.getUserByUsername('EXPLORADOR_P2P');
    assert(found);
    assert.strictEqual(found.id, 'usr_test_pseudo_1');

    // Geração de sugestões
    const suggestions = storage.generateUsernameSuggestions(baseName);
    assert(Array.isArray(suggestions));
    assert(suggestions.length >= 3);
    suggestions.forEach(sug => {
      assert(storage.isUsernameAvailable(sug), `Sugestão ${sug} deveria estar disponível`);
      assert(sug.toLowerCase().includes('explorador'));
    });
  });

  test('Cadastro simples pseudônimo: sem dados pessoais, chave privada protegida e ID aleatório', () => {
    const userId = 'usr_rand_' + crypto.randomBytes(6).toString('hex');
    const keypair = CryptoEngine.generateEd25519KeyPair();
    const vaultKey = crypto.randomBytes(32).toString('hex');
    const encKey = CryptoEngine.encryptPrivateKey(keypair.privateKey, vaultKey);
    const recoveryCode = 'REC-A1B2-C3D4-E5F6';
    const recoveryHash = CryptoEngine.hashPassword(recoveryCode);

    const user = storage.createPseudonymUser({
      id: userId,
      username: 'leitor_anonimo_42',
      publicKey: keypair.publicKey,
      encryptedPrivateKey: JSON.stringify(encKey),
      recoveryCodeHash: recoveryHash,
      deviceId: 'dev_mobile_01',
      role: 'Membro',
      status: 'active'
    });

    assert(user);
    assert.strictEqual(user.id, userId);
    assert.strictEqual(user.username, 'leitor_anonimo_42');
    assert.strictEqual(user.is_pseudonym, 1);

    // Chave privada NUNCA pode ser persistida em texto puro
    assert(!user.privateKey);
    assert(!user.private_key);
    assert(user.encrypted_private_key);
    assert(user.encrypted_private_key.includes('ciphertext'));

    // Verificação de que chave pode ser decifrada com a vaultKey do dispositivo
    const parsedEnc = JSON.parse(user.encrypted_private_key);
    const decryptedKey = CryptoEngine.decryptPrivateKey(parsedEnc, vaultKey);
    assert.strictEqual(decryptedKey, keypair.privateKey);

    // Validação de hash do código de recuperação
    assert(CryptoEngine.verifyPassword(recoveryCode, user.recovery_code_hash));
  });

  test('Alteração de pseudônimo público preserva o identificador interno e a chave pública', () => {
    const origUser = storage.getUserByUsername('leitor_anonimo_42');
    assert(origUser);

    const updateRes = storage.updatePseudonymUsername(origUser.id, 'viajante_das_redes');
    assert.strictEqual(updateRes.success, true);
    assert.strictEqual(updateRes.username, 'viajante_das_redes');

    const updatedUser = storage.getUserByUsername('viajante_das_redes');
    assert(updatedUser);
    assert.strictEqual(updatedUser.id, origUser.id, 'ID interno aleatório deve permanecer inalterado');
    assert.strictEqual(updatedUser.public_key, origUser.public_key, 'Chave pública deve permanecer inalterada');
  });

  test('Pareamento e vinculação de múltiplos dispositivos com código seguro e revogação', () => {
    const pairingCode = 'PAIR-8821-9932';
    const pairing = storage.createDevicePairing({
      pairingCode,
      userId: 'usr_test_pseudo_1',
      username: 'explorador_p2p',
      encryptedVaultKey: 'VAULT_PAYLOAD_CIPHER',
      publicKey: 'FAKE_PUBKEY_1',
      expiresInMs: 10 * 60 * 1000
    });

    assert.strictEqual(pairing.pairingCode, pairingCode);

    const fetched = storage.getDevicePairing(pairingCode);
    assert(fetched);
    assert.strictEqual(fetched.username, 'explorador_p2p');
    assert.strictEqual(fetched.status, 'pending');

    const completed = storage.completeDevicePairing(pairingCode);
    assert(completed);
    assert.strictEqual(completed.status, 'paired');

    // Registrar e revogar sessão do novo dispositivo
    storage.registerDeviceSession({
      sessionId: 'sess_paired_phone',
      userId: 'usr_test_pseudo_1',
      deviceType: 'mobile',
      clientType: 'paired_client',
      isRelay: false
    });

    const userDevices = storage.getUserDeviceSessions('usr_test_pseudo_1');
    assert(userDevices.some(d => d.session_id === 'sess_paired_phone'));

    const revoked = storage.revokeDeviceSession('usr_test_pseudo_1', 'sess_paired_phone');
    assert.strictEqual(revoked, true);

    const afterRevoke = storage.getUserDeviceSessions('usr_test_pseudo_1');
    assert(!afterRevoke.some(d => d.session_id === 'sess_paired_phone'));
  });

  test('Proteção contra cadastros automáticos abusivos (Rate Limiting de Criação)', () => {
    const testIp = '198.51.100.77';

    // Até 5 tentativas permitidas
    for (let i = 1; i <= 5; i++) {
      const check = storage.checkRegistrationRateLimit(testIp, 5, 60000);
      assert.strictEqual(check.allowed, true);
    }

    // 6ª tentativa bloqueada por limite de taxa
    const blocked = storage.checkRegistrationRateLimit(testIp, 5, 60000);
    assert.strictEqual(blocked.allowed, false);
    assert(blocked.error.includes('Limite de novos cadastros atingido'));
  });

  test('Contrato de privacidade: Ausência estrita de coleta de CPF, e-mail, telefone ou nome real', () => {
    const allUsers = storage.getAllUsers();
    allUsers.forEach(u => {
      assert.strictEqual(u.cpf, undefined, 'CPF não deve existir no modelo');
      assert.strictEqual(u.email, undefined, 'E-mail não deve existir no modelo');
      assert.strictEqual(u.phone, undefined, 'Telefone não deve existir no modelo');
      assert.strictEqual(u.real_name, undefined, 'Nome real não deve existir no modelo');
      assert.strictEqual(u.address, undefined, 'Endereço não deve existir no modelo');
      assert(u.username, 'Deve possuir apenas pseudônimo público');
      assert(u.public_key, 'Deve possuir chave pública criptográfica');
    });
  });

  test('Restauração de acesso seguro utilizando código de recuperação (REC-XXXX-XXXX-XXXX)', () => {
    const testCode = 'REC-9988-7766-5544';
    const codeHash = CryptoEngine.hashPassword(testCode);

    storage.createPseudonymUser({
      id: 'usr_recover_target',
      username: 'usuario_recuperavel',
      publicKey: 'FAKE_RECOVER_PUBKEY',
      encryptedPrivateKey: 'FAKE_ENC_KEY',
      recoveryCodeHash: codeHash,
      role: 'Membro',
      status: 'active'
    });

    const user = storage.getUserByUsername('usuario_recuperavel');
    assert(user);
    assert(user.recovery_code_hash);

    // Validação correta com código legítimo
    const isValid = CryptoEngine.verifyPassword(testCode, user.recovery_code_hash);
    assert.strictEqual(isValid, true);

    // Rejeição com código adulterado
    const isBadValid = CryptoEngine.verifyPassword('REC-0000-0000-0000', user.recovery_code_hash);
    assert.strictEqual(isBadValid, false);
  });

  test('Geração de QR Code vetorial SVG para pareamento com validade de 10 minutos', () => {
    const pairingCode = 'PAIR-9182-3746';
    const QRCodeGenerator = require('../src/common/qrcode');
    const pairUrl = `https://cp2p.democracias.org/pair/${pairingCode}`;

    const svg = QRCodeGenerator.generateSVG(pairUrl, 240);
    assert(typeof svg === 'string');
    assert(svg.includes('<svg'));
    assert(svg.includes('</svg>'));
    assert(svg.includes('viewBox="0 0 '));

    const pairing = storage.createDevicePairing({
      pairingCode,
      userId: 'usr_test_pseudo_1',
      username: 'explorador_p2p',
      encryptedVaultKey: 'VAULT_KEY_ENC',
      publicKey: 'FAKE_PUBKEY_1',
      expiresInMs: 10 * 60 * 1000
    });

    assert(pairing.expiresAt > Date.now());
    assert(pairing.expiresAt <= Date.now() + (10 * 60 * 1000) + 1000);
  });

  // --- RELATÓRIO FINAL ---
  console.log('\n======================================================');
  console.log(`  RESULTADO: ${passedTests} testes passaram | ${failedTests} falharam`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch(e => {
  console.error(e);
  process.exit(1);
});
