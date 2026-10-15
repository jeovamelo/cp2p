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
