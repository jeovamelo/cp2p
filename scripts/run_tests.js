/**
 * Comunidade Resiliente - Suíte de Testes Automatizados Unitários e de Integração
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const CryptoEngine = require('../src/common/crypto');
const StorageManager = require('../src/core/storage');
const MessageChain = require('../src/core/crdt_chain');
const ConsensusEngine = require('../src/core/consensus');
const NotificationService = require('../src/core/notification_service');
const AuditLogger = require('../src/core/audit_logger');

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

  // --- MÓDULO 2: STORAGE SQLITE ---
  console.log('\n\x1b[1m[2] Testes do Módulo de Armazenamento SQLite\x1b[0m');
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

  // --- MÓDULO 3: CADEIA DE MENSAGENS ASSINADAS (CRDT / HASH CHAIN) ---
  console.log('\n\x1b[1m[3] Testes da Cadeia de Mensagens Assinadas e Permissões\x1b[0m');
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
    assert.strictEqual(m2.prev_hash, m1.id); // Encadeamento SHA-256 perfeito!
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

  // --- MÓDULO 4: CONSENSO E ELEIÇÃO DE LÍDER ---
  console.log('\n\x1b[1m[4] Testes de Consenso e Eleição Autônoma\x1b[0m');
  test('Cálculo de prioridade: Administrador possui maior precedência na eleição', () => {
    const adminConsensus = new ConsensusEngine({ nodeId: 'node-admin', role: 'Administrador', broadcast: () => {} });
    const memberConsensus = new ConsensusEngine({ nodeId: 'node-member', role: 'Membro', broadcast: () => {} });
    assert(adminConsensus.getPriority(1) > memberConsensus.getPriority(1));
  });

  test('Eleição dinâmica elege novo líder quando a VPS cai', () => {
    let broadcastedPacket = null;
    const nodeConsensus = new ConsensusEngine({
      nodeId: 'node-leader-candidate',
      role: 'Administrador',
      broadcast: (pkt) => { broadcastedPacket = pkt; },
      electionTimeout: 50
    });

    nodeConsensus.recordPeerSeen('node-peer-1', 'Membro');
    nodeConsensus.notifyBootstrapFailed();
    nodeConsensus.startElection(5);

    assert(nodeConsensus.isLeader);
    assert.strictEqual(nodeConsensus.currentLeaderId, 'node-leader-candidate');
    nodeConsensus.stop();
  });

  // --- MÓDULO 5: NOTIFICAÇÕES E PRIVACIDADE ---
  console.log('\n\x1b[1m[5] Testes de Notificações e Proteção de Privacidade\x1b[0m');
  test('Gera notificação sem expor conteúdo confidencial em texto claro no push aberto', () => {
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

  // Relatório Final
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
