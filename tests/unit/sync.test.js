import test from 'node:test';
import assert from 'node:assert';
import { CryptoEngine } from '../../packages/core/src/crypto/keys.js';
import { MessageModel } from '../../packages/core/src/model/message.js';
import { CommunityModel, UserRoles } from '../../packages/core/src/model/community.js';

test('MessageModel: Deve criar e validar mensagem assinada pelo Administrador', () => {
  const admin = CryptoEngine.generateIdentity('admin_user');
  const communityKey = CryptoEngine.generateCommunityKey();

  const community = CommunityModel.create({
    id: 'comm_teste',
    name: 'Comunidade Teste',
    adminPublicKey: admin.publicKey
  });

  const msg = MessageModel.create({
    communityId: community.id,
    sequence: 1,
    content: 'Primeiro comunicado oficial',
    authorPublicKey: admin.publicKey,
    authorPrivateKey: admin.privateKey,
    communityKeyHex: communityKey
  });

  assert.strictEqual(msg.sequence, 1);
  assert.ok(msg.hash);
  assert.ok(msg.signature);

  // Validação
  const validation = MessageModel.validate(msg, community);
  assert.strictEqual(validation.valid, true);

  // Decifração
  const decrypted = MessageModel.decryptContent(msg, communityKey);
  assert.strictEqual(decrypted.text, 'Primeiro comunicado oficial');
});

test('MessageModel: Deve REJEITAR mensagem assinada por não-administrador', () => {
  const admin = CryptoEngine.generateIdentity('admin');
  const imposter = CryptoEngine.generateIdentity('imposter_member');
  const communityKey = CryptoEngine.generateCommunityKey();

  const community = CommunityModel.create({
    id: 'comm_teste',
    name: 'Comunidade Teste',
    adminPublicKey: admin.publicKey
  });

  // Membro comum tenta forjar envio de mensagem
  const forgedMsg = MessageModel.create({
    communityId: community.id,
    sequence: 1,
    content: 'Tentativa de spam ou golpe',
    authorPublicKey: imposter.publicKey,
    authorPrivateKey: imposter.privateKey,
    communityKeyHex: communityKey
  });

  const validation = MessageModel.validate(forgedMsg, community);
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.error.includes('não possui permissão de Administrador'));
});

test('MessageModel: Deve REJEITAR mensagem com hash ou ciphertext adulterado', () => {
  const admin = CryptoEngine.generateIdentity('admin');
  const communityKey = CryptoEngine.generateCommunityKey();

  const community = CommunityModel.create({
    id: 'comm_teste',
    name: 'Comunidade Teste',
    adminPublicKey: admin.publicKey
  });

  const msg = MessageModel.create({
    communityId: community.id,
    sequence: 1,
    content: 'Mensagem íntegra',
    authorPublicKey: admin.publicKey,
    authorPrivateKey: admin.privateKey,
    communityKeyHex: communityKey
  });

  // Adulteração do payload
  const tamperedMsg = {
    ...msg,
    payload: {
      ...msg.payload,
      ciphertext: msg.payload.ciphertext + 'aa'
    }
  };

  const validation = MessageModel.validate(tamperedMsg, community);
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.error.includes('adulterado'));
});

test('MessageModel: Deve detectar e barrar duplicação/replay', () => {
  const admin = CryptoEngine.generateIdentity('admin');
  const communityKey = CryptoEngine.generateCommunityKey();

  const community = CommunityModel.create({
    id: 'comm_teste',
    name: 'Comunidade Teste',
    adminPublicKey: admin.publicKey
  });

  const msg = MessageModel.create({
    communityId: community.id,
    sequence: 1,
    content: 'Mensagem única',
    authorPublicKey: admin.publicKey,
    authorPrivateKey: admin.privateKey,
    communityKeyHex: communityKey
  });

  const knownHashes = new Set([msg.hash]);
  const validation = MessageModel.validate(msg, community, knownHashes);
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.error.includes('duplicada'));
});

test('CommunityModel: Rotação de chaves ao revogar membro', () => {
  const admin = CryptoEngine.generateIdentity('admin');
  const memberBad = CryptoEngine.generateIdentity('bad_member');

  const community = CommunityModel.create({
    id: 'comm_segura',
    name: 'Comunidade Segura',
    adminPublicKey: admin.publicKey
  });

  CommunityModel.addMember(community, {
    publicKey: memberBad.publicKey,
    role: UserRoles.MEMBER,
    displayName: 'Membro Suspeito'
  });

  const initialEpoch = community.currentEpoch;
  const initialKey = CommunityModel.getEpochKey(community, initialEpoch);

  // Revoga o membro
  const result = CommunityModel.revokeMember(community, memberBad.publicKey);
  assert.strictEqual(result.newEpoch, initialEpoch + 1);
  assert.strictEqual(community.currentEpoch, initialEpoch + 1);

  const newKey = CommunityModel.getEpochKey(community, community.currentEpoch);
  assert.notStrictEqual(initialKey, newKey);
  assert.strictEqual(result.revokedMember.status, 'REVOKED');
});
