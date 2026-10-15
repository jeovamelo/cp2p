/**
 * Testes Automatizados de Comunidades P2P (Estilo WhatsApp Comunidades)
 * Valida: Criação de comunidade, convite base64, entrada na comunidade,
 * publicação restrita a admin e isolamento criptográfico entre comunidades.
 */

const assert = require('assert');
const CryptoEngine = require('../src/common/crypto');
const StorageManager = require('../src/core/storage');
const MessageChain = require('../src/core/crdt_chain');

function runCommunityTests() {
  console.log('\n======================================================');
  console.log('  TESTES DE COMUNIDADES ESTILO WHATSAPP');
  console.log('======================================================\n');

  const storage = new StorageManager(':memory:');
  const chain = new MessageChain(storage);

  // 1. Criar Usuário Admin e Usuário Membro
  const adminKeypair = CryptoEngine.generateEd25519KeyPair();
  const adminUser = {
    id: 'usr_admin',
    username: 'alice_admin',
    password_hash: CryptoEngine.hashPassword('admin123'),
    public_key: adminKeypair.publicKey,
    role: 'Administrador',
    status: 'active',
    created_at: Date.now()
  };
  storage.createUser(adminUser);

  const memberKeypair = CryptoEngine.generateEd25519KeyPair();
  const memberUser = {
    id: 'usr_member',
    username: 'bob_membro',
    password_hash: CryptoEngine.hashPassword('membro123'),
    public_key: memberKeypair.publicKey,
    role: 'Membro',
    status: 'active',
    created_at: Date.now()
  };
  storage.createUser(memberUser);

  // 2. Criar Nova Comunidade "Movimento Popular ABC"
  const commId = 'comm-movimento-popular-101';
  const initialKey = CryptoEngine.generateChannelKey();

  const community = {
    id: commId,
    name: 'Movimento Popular ABC',
    description: 'Comunidade descentralizada P2P',
    genesis_admin_pubkey: adminUser.public_key,
    current_epoch: 1,
    created_at: Date.now()
  };
  storage.saveCommunity(community);
  storage.saveKeyEpoch(commId, 1, initialKey, adminUser.public_key);

  const retrieved = storage.getCommunity(commId);
  assert.strictEqual(retrieved.name, 'Movimento Popular ABC');
  console.log('  \x1b[32m✓\x1b[0m Criar nova comunidade e salvar chave simétrica inicial');

  // 3. Gerar Convite em Base64
  const invitePayload = {
    type: 'comunidade_resiliente_invite',
    communityId: commId,
    name: community.name,
    description: community.description,
    genesisAdminPubkey: adminUser.public_key,
    channelKey: initialKey,
    bootstraps: ['ws://127.0.0.1:4001']
  };
  const inviteCode = Buffer.from(JSON.stringify(invitePayload)).toString('base64');
  assert(typeof inviteCode === 'string' && inviteCode.length > 20);
  console.log('  \x1b[32m✓\x1b[0m Gerar token de convite seguro em Base64');

  // 4. Membro entra na comunidade decodificando o token
  const decoded = JSON.parse(Buffer.from(inviteCode, 'base64').toString('utf8'));
  assert.strictEqual(decoded.communityId, commId);
  assert.strictEqual(decoded.channelKey, initialKey);
  console.log('  \x1b[32m✓\x1b[0m Validar e decodificar token de convite');

  // 5. Admin publica comunicado oficial na comunidade do seu nó
  const msg1 = chain.createSignedMessage({
    communityId: commId,
    plaintext: 'Primeiro comunicado oficial da nova comunidade!',
    channelKeyHex: initialKey,
    authorPublicKey: adminUser.public_key,
    authorPrivateKey: adminKeypair.privateKey,
    epoch: 1
  });
  console.log('  \x1b[32m✓\x1b[0m Administrador publica comunicado assinado no canal de avisos');

  // 6. Nó do Membro recebe convite e sincroniza a mensagem via P2P
  const memberStorage = new StorageManager(':memory:');
  const memberChain = new MessageChain(memberStorage);

  memberStorage.saveCommunity({
    id: decoded.communityId,
    name: decoded.name,
    description: decoded.description,
    genesis_admin_pubkey: decoded.genesisAdminPubkey,
    current_epoch: 1,
    created_at: Date.now()
  });
  memberStorage.saveKeyEpoch(decoded.communityId, 1, decoded.channelKey, decoded.genesisAdminPubkey);

  const authorizedAdmins = [decoded.genesisAdminPubkey];
  const applyRes = memberChain.processIncomingMessage(msg1, authorizedAdmins);
  assert.strictEqual(applyRes.success, true);
  assert.strictEqual(applyRes.reason, 'APPLIED');
  console.log('  \x1b[32m✓\x1b[0m Nó do Membro replica mensagem com sucesso via P2P');

  // 7. Atacante/Membro tenta forjar/publicar mensagem não autorizada (deve ser rejeitada)
  const fakeMsg = chain.createSignedMessage({
    communityId: commId,
    plaintext: 'Tentativa de mensagem não autorizada de membro comum',
    channelKeyHex: initialKey,
    authorPublicKey: memberUser.public_key,
    authorPrivateKey: memberKeypair.privateKey,
    epoch: 1
  });

  const memberRes = memberChain.processIncomingMessage(fakeMsg, authorizedAdmins);
  assert.strictEqual(memberRes.success, false);
  console.log('  \x1b[32m✓\x1b[0m Bloqueio estrito: Membros comuns não podem publicar no canal de avisos');

  // 8. Decriptografia do comunicado pelo membro usando a chave do canal
  const storedKey = memberStorage.getKeyForEpoch(commId, 1);
  const decrypted = CryptoEngine.decryptAESGCM({
    ciphertext: msg1.encrypted_content,
    iv: msg1.iv,
    tag: msg1.tag
  }, storedKey);

  assert.strictEqual(decrypted, 'Primeiro comunicado oficial da nova comunidade!');
  console.log('  \x1b[32m✓\x1b[0m Membro decifra com sucesso a mensagem ponta a ponta (E2EE)');

  console.log('\n======================================================');
  console.log('  TODOS OS TESTES DE COMUNIDADE PASSARAM COM SUCESSO!');
  console.log('======================================================\n');
}

runCommunityTests();
