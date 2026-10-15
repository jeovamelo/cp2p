import test from 'node:test';
import assert from 'node:assert';
import { CryptoEngine } from '../../packages/core/src/crypto/keys.js';

test('CryptoEngine: Deve gerar par de chaves Ed25519 válido', () => {
  const identity = CryptoEngine.generateIdentity('alice');
  assert.ok(identity.id);
  assert.ok(identity.publicKey.includes('BEGIN PUBLIC KEY'));
  assert.ok(identity.privateKey.includes('BEGIN PRIVATE KEY'));
  assert.ok(identity.publicKeyRaw.length > 30);
});

test('CryptoEngine: Deve assinar e validar mensagem com Ed25519', () => {
  const alice = CryptoEngine.generateIdentity('alice');
  const bob = CryptoEngine.generateIdentity('bob');
  const messageData = 'Comunicado oficial da comunidade';

  const signature = CryptoEngine.sign(messageData, alice.privateKey);
  assert.ok(signature);

  // Verificação com a chave correta da Alice
  const isValid = CryptoEngine.verify(messageData, signature, alice.publicKey);
  assert.strictEqual(isValid, true);

  // Verificação com a chave do Bob deve FALHAR
  const isBobValid = CryptoEngine.verify(messageData, signature, bob.publicKey);
  assert.strictEqual(isBobValid, false);

  // Mensagem adulterada deve FALHAR
  const isTamperedValid = CryptoEngine.verify('Mensagem adulterada', signature, alice.publicKey);
  assert.strictEqual(isTamperedValid, false);
});

test('CryptoEngine: Deve criptografar e descriptografar com AES-256-GCM', () => {
  const key = CryptoEngine.generateCommunityKey();
  const secretContent = { text: 'Alerta seguro de emergência', priority: 'high' };

  const encrypted = CryptoEngine.encryptMessage(secretContent, key);
  assert.ok(encrypted.ciphertext);
  assert.ok(encrypted.iv);
  assert.ok(encrypted.authTag);

  const decrypted = CryptoEngine.decryptMessage(encrypted, key);
  assert.deepStrictEqual(decrypted, secretContent);
});

test('CryptoEngine: Deve falhar ao decifrar com chave errada ou tag corrompida', () => {
  const key1 = CryptoEngine.generateCommunityKey();
  const key2 = CryptoEngine.generateCommunityKey();
  const content = 'Dados confidenciais';

  const encrypted = CryptoEngine.encryptMessage(content, key1);

  // Tenta decifrar com chave errada
  assert.throws(() => {
    CryptoEngine.decryptMessage(encrypted, key2);
  });

  // Tenta decifrar com authTag corrompida
  const corrupted = { ...encrypted, authTag: '00112233445566778899aabbccddeeff' };
  assert.throws(() => {
    CryptoEngine.decryptMessage(corrupted, key1);
  });
});

test('CryptoEngine: Deve proteger chave privada com senha mestra do usuário', () => {
  const identity = CryptoEngine.generateIdentity('alice');
  const password = 'MinhaSenhaUltraSegura!#2026';

  const vault = CryptoEngine.encryptPrivateKey(identity.privateKey, password);
  assert.ok(vault.ciphertext);
  assert.ok(vault.salt);

  // Restaura com a senha correta
  const restoredKey = CryptoEngine.decryptPrivateKey(vault, password);
  assert.strictEqual(restoredKey, identity.privateKey);

  // Falha com a senha errada
  assert.throws(() => {
    CryptoEngine.decryptPrivateKey(vault, 'SenhaErrada123');
  });
});
