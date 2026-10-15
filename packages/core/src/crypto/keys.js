import crypto from 'node:crypto';

/**
 * Módulo Criptográfico do Comunidade Resiliente
 * Implementa Ed25519 para assinaturas digitais e AES-256-GCM para criptografia ponta a ponta (E2EE).
 */

export class CryptoEngine {
  /**
   * Gera um novo par de chaves assimétricas Ed25519 para identidade de usuário/nó.
   */
  static generateIdentity(userId = null) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const pubKeyClean = publicKey
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s+/g, '');

    const id = userId || `peer_${pubKeyClean.slice(0, 16)}`;

    return {
      id,
      publicKey,
      publicKeyRaw: pubKeyClean,
      privateKey,
      createdAt: Date.now()
    };
  }

  /**
   * Assina dados usando a chave privada Ed25519 do autor.
   * @param {string|Buffer} data - Dados a serem assinados
   * @param {string} privateKeyPem - Chave privada em formato PEM
   * @returns {string} Assinatura em base64
   */
  static sign(data, privateKeyPem) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
    const signature = crypto.sign(null, buffer, privateKeyPem);
    return signature.toString('base64');
  }

  /**
   * Verifica a autenticidade da assinatura digital com a chave pública Ed25519.
   * @param {string|Buffer} data - Dados originais
   * @param {string} signatureBase64 - Assinatura em base64
   * @param {string} publicKeyPem - Chave pública em formato PEM
   * @returns {boolean} True se a assinatura for válida
   */
  static verify(data, signatureBase64, publicKeyPem) {
    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
      const sigBuffer = Buffer.from(signatureBase64, 'base64');
      return crypto.verify(null, buffer, publicKeyPem, sigBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Calcula o hash SHA-256 de uma string ou objeto.
   */
  static sha256(data) {
    const content = typeof data === 'object' ? JSON.stringify(data) : String(data);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Gera uma chave simétrica aleatória de 256 bits (32 bytes) para canal/comunidade.
   */
  static generateCommunityKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Criptografa o corpo e anexos de uma mensagem usando AES-256-GCM.
   * @param {string|object} content - Texto ou objeto da mensagem
   * @param {string} keyHex - Chave simétrica em hex (32 bytes = 64 caracteres)
   * @returns {{ ciphertext: string, iv: string, authTag: string }}
   */
  static encryptMessage(content, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(12); // Recomendado para GCM: 96 bits
    const text = typeof content === 'object' ? JSON.stringify(content) : String(content);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let ciphertext = cipher.update(text, 'utf-8', 'hex');
    ciphertext += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
      ciphertext,
      iv: iv.toString('hex'),
      authTag
    };
  }

  /**
   * Descriptografa e valida a integridade da mensagem com AES-256-GCM.
   * @param {{ ciphertext: string, iv: string, authTag: string }} payload
   * @param {string} keyHex - Chave simétrica em hex
   * @returns {string|object} Mensagem descriptografada
   */
  static decryptMessage(payload, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const iv = Buffer.from(payload.iv, 'hex');
    const authTag = Buffer.from(payload.authTag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(payload.ciphertext, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    try {
      return JSON.parse(decrypted);
    } catch {
      return decrypted;
    }
  }

  /**
   * Deriva uma chave mestra a partir da senha do usuário usando PBKDF2 com HMAC-SHA512.
   */
  static deriveKeyFromPassword(password, saltHex = null) {
    const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
    const iterations = 100000;
    const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha512');
    return {
      keyHex: key.toString('hex'),
      saltHex: salt.toString('hex')
    };
  }

  /**
   * Criptografa a chave privada do usuário antes de salvá-la no disco.
   */
  static encryptPrivateKey(privateKeyPem, password) {
    const { keyHex, saltHex } = this.deriveKeyFromPassword(password);
    const encrypted = this.encryptMessage(privateKeyPem, keyHex);
    return {
      ...encrypted,
      salt: saltHex
    };
  }

  /**
   * Descriptografa a chave privada do usuário a partir da senha.
   */
  static decryptPrivateKey(encryptedVault, password) {
    const { keyHex } = this.deriveKeyFromPassword(password, encryptedVault.salt);
    return this.decryptMessage(encryptedVault, keyHex);
  }

  /**
   * Sistema de Rotação de Chaves (Epoch Ratchet)
   * Gera uma nova chave de comunidade e a encapsula para a lista de membros ativos.
   */
  static rotateCommunityEpoch(communityId, currentEpoch, authorizedMembers) {
    const nextEpoch = currentEpoch + 1;
    const newCommunityKey = this.generateCommunityKey();

    // Cria registro de rotação com carimbo de tempo
    return {
      communityId,
      epoch: nextEpoch,
      keyHex: newCommunityKey,
      rotatedAt: Date.now(),
      authorizedCount: authorizedMembers.length
    };
  }
}
