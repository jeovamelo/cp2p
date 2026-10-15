/**
 * Comunidade Resiliente - Módulo Criptográfico de Alta Segurança
 * Criptografia Ponta-a-Ponta (E2EE), Assinaturas Digitais Ed25519 e Chaveamento AES-256-GCM
 */

const crypto = require('crypto');

class CryptoEngine {
  /**
   * Gera um par de chaves assimétricas Ed25519 para assinatura digital
   * Utilizado para administradores assinarem publicações e membros autenticarem
   */
  static generateEd25519KeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    return { publicKey, privateKey };
  }

  /**
   * Assina digitalmente uma mensagem ou payload usando a chave privada Ed25519 do Administrador
   * @param {string|object} data - Dados a serem assinados
   * @param {string} privateKeyPem - Chave privada Ed25519 em formato PEM
   * @returns {string} Assinatura em formato hexadecimal
   */
  static signData(data, privateKeyPem) {
    const content = typeof data === 'string' ? data : JSON.stringify(data);
    const signature = crypto.sign(null, Buffer.from(content, 'utf8'), privateKeyPem);
    return signature.toString('hex');
  }

  /**
   * Verifica a assinatura digital Ed25519 de uma mensagem recebida
   * @param {string|object} data - Dados originais
   * @param {string} signatureHex - Assinatura em hexadecimal
   * @param {string} publicKeyPem - Chave pública Ed25519 do autor
   * @returns {boolean} Verdadeiro se a assinatura for válida e autêntica
   */
  static verifySignature(data, signatureHex, publicKeyPem) {
    try {
      const content = typeof data === 'string' ? data : JSON.stringify(data);
      const signature = Buffer.from(signatureHex, 'hex');
      return crypto.verify(null, Buffer.from(content, 'utf8'), publicKeyPem, signature);
    } catch (err) {
      return false;
    }
  }

  /**
   * Gera uma chave simétrica de 256 bits para o canal/comunidade (AES-256-GCM)
   * @returns {string} Chave em formato hexadecimal (32 bytes = 64 caracteres hex)
   */
  static generateChannelKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Criptografa dados usando AES-256-GCM (Criptografia Autenticada com Proteção contra Adulteração)
   * @param {string|object} plaintext - Texto ou objeto a ser criptografado
   * @param {string} keyHex - Chave de 32 bytes em formato hex
   * @returns {object} { ciphertext, iv, tag } em hexadecimal
   */
  static encryptAESGCM(plaintext, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(12); // IV padrão de 96 bits para GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    const text = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext);
    let ciphertext = cipher.update(text, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    return {
      ciphertext,
      iv: iv.toString('hex'),
      tag
    };
  }

  /**
   * Decifra dados criptografados com AES-256-GCM
   * Lança erro se a tag de autenticação for inválida (dados adulterados)
   * @param {object} encryptedObj - { ciphertext, iv, tag }
   * @param {string} keyHex - Chave em formato hex
   * @returns {string} Texto em claro original
   */
  static decryptAESGCM(encryptedObj, keyHex) {
    const { ciphertext, iv, tag } = encryptedObj;
    const key = Buffer.from(keyHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Calcula o hash criptográfico SHA-256 de um conteúdo ou objeto
   * Utilizado para Content-Addressing e Hash Chaining de mensagens
   * @param {any} data 
   * @returns {string} Hash SHA-256 em hexadecimal
   */
  static sha256(data) {
    const content = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Gera um hash seguro para armazenamento de senha usando PBKDF2 com salt aleatório
   * @param {string} password - Senha fornecida pelo usuário
   * @returns {string} Salt e Hash concatenados
   */
  static hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const iterations = 100000;
    const keylen = 64;
    const digest = 'sha512';
    const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
    return `${salt}:${iterations}:${hash}`;
  }

  /**
   * Valida uma senha comparando com o hash salvo
   * @param {string} password - Senha digitada
   * @param {string} storedHash - Formato salt:iterations:hash
   * @returns {boolean} Verdadeiro se coincidir
   */
  static verifyPassword(password, storedHash) {
    try {
      const [salt, iterations, originalHash] = storedHash.split(':');
      const hash = crypto.pbkdf2Sync(password, salt, parseInt(iterations, 10), 64, 'sha512').toString('hex');
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
    } catch (e) {
      return false;
    }
  }

  /**
   * Criptografa a chave privada do usuário localmente usando uma derivação da senha (Key Encryption Key)
   */
  static encryptPrivateKey(privateKeyPem, password) {
    const salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let ciphertext = cipher.update(privateKeyPem, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    return {
      ciphertext,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag
    };
  }

  /**
   * Descriptografa a chave privada do usuário usando a senha
   */
  static decryptPrivateKey(encryptedKeyObj, password) {
    const { ciphertext, salt, iv, tag } = encryptedKeyObj;
    const key = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

module.exports = CryptoEngine;
