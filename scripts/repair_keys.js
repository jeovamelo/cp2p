const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const CryptoEngine = require('../src/common/crypto');

const dbPath = path.join(os.homedir(), '.comunidade-resiliente', 'data', 'comunidade.db');
console.log('Connecting to database:', dbPath);
const db = new DatabaseSync(dbPath);

// 1. Obter ou criar chave persistente do cofre do dispositivo
let vaultSetting = db.prepare("SELECT value FROM node_storage_settings WHERE key = 'device_vault_key'").get();
let deviceVaultKey;
if (!vaultSetting) {
  deviceVaultKey = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT OR REPLACE INTO node_storage_settings (key, value) VALUES ('device_vault_key', ?)").run(deviceVaultKey);
  console.log('Criada nova chave do cofre do dispositivo em node_storage_settings.');
} else {
  deviceVaultKey = vaultSetting.value;
  console.log('Chave do cofre do dispositivo carregada.');
}

// 2. Reparar e regenerar identidade segura para o Administrador 'numero1'
const numero1 = db.prepare("SELECT * FROM users WHERE username = 'numero1'").get();
if (numero1) {
  const kp = CryptoEngine.generateEd25519KeyPair();
  const encPrivKey = CryptoEngine.encryptPrivateKey(kp.privateKey, deviceVaultKey);
  
  db.prepare(`
    UPDATE users 
    SET public_key = ?, 
        encrypted_private_key = ?, 
        role = 'Administrador', 
        status = 'active'
    WHERE username = 'numero1'
  `).run(kp.publicKey, JSON.stringify(encPrivKey));

  console.log('Usuário numero1 atualizado com novo par Ed25519 desbloqueável pelo cofre!');

  // Atualiza comunidades para que numero1 seja o genesis admin oficial
  db.prepare("UPDATE communities SET genesis_admin_pubkey = ?").run(kp.publicKey);
  console.log('Genesis admin atualizado nas comunidades.');

  // Assegura que a sessão ativa de numero1 está válida e renovada
  db.prepare(`
    UPDATE sessions 
    SET expires_at = ?, last_active = ? 
    WHERE user_id = ?
  `).run(Date.now() + (30 * 24 * 3600 * 1000), Date.now(), numero1.id);
  console.log('Sessão de autenticação de numero1 renovada para 30 dias.');
}

// 3. Reparar usuário 'jeova' se existir
const jeova = db.prepare("SELECT * FROM users WHERE username = 'jeova'").get();
if (jeova) {
  const kpJeova = CryptoEngine.generateEd25519KeyPair();
  const encPrivJeova = CryptoEngine.encryptPrivateKey(kpJeova.privateKey, deviceVaultKey);
  db.prepare(`
    UPDATE users 
    SET public_key = ?, 
        encrypted_private_key = ?, 
        status = 'active'
    WHERE username = 'jeova'
  `).run(kpJeova.publicKey, JSON.stringify(encPrivJeova));
  console.log('Usuário jeova atualizado com chave protegida pelo cofre.');
}

console.log('✓ Reparo de chaves concluído com sucesso!');
