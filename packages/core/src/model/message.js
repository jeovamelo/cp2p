import { CryptoEngine } from '../crypto/keys.js';

/**
 * Modelo de Mensagens em Log Imutável (Append-Only Hash-Chained DAG)
 * Garante autenticidade, integridade, ordem e proteção contra forjamento/replay.
 */

export class MessageModel {
  /**
   * Constrói e assina uma nova mensagem de canal comunitário.
   */
  static create({
    communityId,
    sequence,
    previousHash = '0000000000000000000000000000000000000000000000000000000000000000',
    content,
    authorPublicKey,
    authorPrivateKey,
    communityKeyHex,
    epoch = 1,
    attachments = []
  }) {
    if (!communityId) throw new Error('communityId é obrigatório');
    if (typeof sequence !== 'number') throw new Error('sequence deve ser numérico');
    if (!content && attachments.length === 0) throw new Error('Mensagem vazia');
    if (!authorPublicKey || !authorPrivateKey) throw new Error('Chaves do autor necessárias');
    if (!communityKeyHex) throw new Error('Chave comunitária de cifra é necessária');

    const timestamp = Date.now();
    const id = `msg_${communityId}_${sequence}_${CryptoEngine.sha256(timestamp + Math.random().toString()).slice(0, 12)}`;

    // Monta o payload interno (texto + anexos)
    const rawPayload = {
      text: content || '',
      attachments: attachments || [],
      createdAt: timestamp
    };

    // Criptografa o payload com AES-256-GCM
    const encryptedPayload = CryptoEngine.encryptMessage(rawPayload, communityKeyHex);

    // Calcula o Hash canônico da mensagem
    const hashData = `${sequence}:${previousHash}:${timestamp}:${epoch}:${encryptedPayload.ciphertext}:${authorPublicKey}`;
    const hash = CryptoEngine.sha256(hashData);

    // Assina o Hash com a chave privada Ed25519 do autor
    const signature = CryptoEngine.sign(hash, authorPrivateKey);

    return {
      id,
      communityId,
      sequence,
      previousHash,
      hash,
      timestamp,
      epoch,
      authorPublicKey,
      signature,
      payload: encryptedPayload,
      metadata: {
        hasAttachments: attachments.length > 0,
        attachmentCount: attachments.length
      }
    };
  }

  /**
   * Valida rigorosamente uma mensagem recebida na rede P2P.
   * @param {object} message - Objeto da mensagem recebida
   * @param {object} communityState - Estado da comunidade (adminPublicKey, currentEpoch)
   * @param {Set<string>|Array<string>} knownHashes - Hashes já processados para anti-replay
   * @returns {{ valid: boolean, error?: string }}
   */
  static validate(message, communityState, knownHashes = new Set()) {
    if (!message || typeof message !== 'object') {
      return { valid: false, error: 'Mensagem inválida ou malformada' };
    }

    const {
      id,
      communityId,
      sequence,
      previousHash,
      hash,
      timestamp,
      epoch,
      authorPublicKey,
      signature,
      payload
    } = message;

    if (!id || !communityId || sequence === undefined || !hash || !signature || !payload) {
      return { valid: false, error: 'Campos obrigatórios ausentes no envelope da mensagem' };
    }

    // 1. Anti-Replay e Anti-Duplicação
    const hashSet = knownHashes instanceof Set ? knownHashes : new Set(knownHashes);
    if (hashSet.has(hash) || hashSet.has(id)) {
      return { valid: false, error: 'Mensagem duplicada ou replay detectado' };
    }

    // 2. Verificação de Integridade do Hash
    const expectedHashData = `${sequence}:${previousHash}:${timestamp}:${epoch}:${payload.ciphertext}:${authorPublicKey}`;
    const calculatedHash = CryptoEngine.sha256(expectedHashData);
    if (calculatedHash !== hash) {
      return { valid: false, error: 'Hash da mensagem adulterado ou inválido' };
    }

    // 3. Verificação da Assinatura Digital Ed25519
    const isSignatureValid = CryptoEngine.verify(hash, signature, authorPublicKey);
    if (!isSignatureValid) {
      return { valid: false, error: 'Assinatura digital Ed25519 inválida' };
    }

    // 4. Verificação de Autorização (Somente Administradores podem publicar)
    if (communityState) {
      const adminKey = communityState.adminPublicKey;
      // Compara chaves normalizadas
      const cleanAuthor = authorPublicKey.replace(/\s+/g, '');
      const cleanAdmin = adminKey ? adminKey.replace(/\s+/g, '') : null;

      if (cleanAdmin && cleanAuthor !== cleanAdmin) {
        // Verifica se autor está listado como administrador nos papéis da comunidade
        const isAuthorizedAdmin = communityState.authorizedAdmins &&
          communityState.authorizedAdmins.some(k => k.replace(/\s+/g, '') === cleanAuthor);

        if (!isAuthorizedAdmin) {
          return { valid: false, error: 'Autor não possui permissão de Administrador para publicar' };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Decifra o conteúdo de uma mensagem validada.
   */
  static decryptContent(message, communityKeyHex) {
    if (!communityKeyHex) {
      throw new Error('Chave de comunidade ausente para decifração');
    }
    return CryptoEngine.decryptMessage(message.payload, communityKeyHex);
  }
}
