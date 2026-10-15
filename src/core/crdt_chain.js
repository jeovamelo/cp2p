/**
 * Comunidade Resiliente - Cadeia de Mensagens Assinadas (Signed Hash Chain / Merkle-DAG)
 * Garante consistência eventual, ordenação causal, proteção contra adulteração e replay
 */

const CryptoEngine = require('../common/crypto');

class MessageChain {
  /**
   * @param {import('./storage')} storageManager 
   */
  constructor(storageManager) {
    this.storage = storageManager;
    // Buffer temporário para blocos fora de ordem aguardando antecessores
    this.orphanBuffer = new Map();
  }

  /**
   * Cria um novo bloco de mensagem assinado pelo Administrador
   * @param {object} params
   * @param {string} params.communityId
   * @param {string} params.plaintext - Conteúdo legível da mensagem
   * @param {string} params.channelKeyHex - Chave AES-256 do canal
   * @param {string} params.authorPublicKey - Chave pública Ed25519 do Admin
   * @param {string} params.authorPrivateKey - Chave privada Ed25519 do Admin
   * @param {number} [params.epoch=1] - Época da chave
   * @param {string} [params.attachmentType=null] - 'image' ou 'file'
   * @param {string} [params.attachmentData=null] - Base64 ou URL
   * @returns {object} Mensagem formatada, criptografada, encadeada e assinada
   */
  createSignedMessage({
    communityId,
    plaintext,
    channelKeyHex,
    authorPublicKey,
    authorPrivateKey,
    epoch = 1,
    attachmentType = null,
    attachmentData = null
  }) {
    // 1. Obtém a última mensagem da comunidade para encadeamento
    const latest = this.storage.getLatestMessage(communityId);
    const sequence = latest ? latest.sequence + 1 : 1;
    const prevHash = latest ? latest.id : '0000000000000000000000000000000000000000000000000000000000000000';

    // 2. Criptografa o conteúdo com a chave do canal (E2EE)
    const encrypted = CryptoEngine.encryptAESGCM(plaintext, channelKeyHex);

    const timestamp = Date.now();

    // 3. Monta o bloco para cálculo do Hash (ID único / Content-Addressing)
    const blockData = {
      community_id: communityId,
      sequence,
      prev_hash: prevHash,
      author_pubkey: authorPublicKey,
      encrypted_content: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      attachment_type: attachmentType,
      attachment_data: attachmentData,
      epoch,
      timestamp
    };

    const id = CryptoEngine.sha256(blockData);

    // 4. Assina o ID do bloco com a chave privada Ed25519 do Administrador
    const signature = CryptoEngine.signData(id, authorPrivateKey);

    const message = {
      ...blockData,
      id,
      signature,
      received_at: timestamp
    };

    // 5. Salva no banco local
    this.storage.saveMessage(message);

    return message;
  }

  /**
   * Valida e incorpora um bloco de mensagem recebido de um nó P2P
   * Regra Zero-Trust: Nunca confia no nó, apenas na assinatura e na integridade matemática
   * @param {object} message - Mensagem recebida via gossip/sync
   * @param {Set<string>|Array<string>} authorizedAdminPubKeys - Chaves públicas de Admins válidos
   * @returns {{ success: boolean, reason?: string, needsSync?: boolean }}
   */
  processIncomingMessage(message, authorizedAdminPubKeys) {
    // 1. Checagem de duplicação
    const existing = this.storage.getMessageById(message.id);
    if (existing) {
      return { success: true, reason: 'ALREADY_EXISTS' };
    }

    // 2. Validação se o autor é um Administrador autorizado
    const adminKeyList = Array.isArray(authorizedAdminPubKeys)
      ? authorizedAdminPubKeys
      : Array.from(authorizedAdminPubKeys || []);
    const cleanAuthor = message.author_pubkey ? message.author_pubkey.replace(/-----[^\n]+-----|\s+/g, '') : '';
    const isAuthorized = adminKeyList.some(key => {
      const cleanKey = key ? key.replace(/-----[^\n]+-----|\s+/g, '') : '';
      return cleanKey.length > 0 && cleanKey === cleanAuthor;
    });

    if (!isAuthorized) {
      console.warn(`[Cadeia] Mensagem rejeitada: Autor ${cleanAuthor.substring(0, 16)}... não é Admin autorizado (Admins conhecidos: ${adminKeyList.length})`);
      return { success: false, reason: 'UNAUTHORIZED_AUTHOR_NOT_ADMIN' };
    }

    // 3. Validação do ID do bloco (Proteção contra adulteração)
    const blockData = {
      community_id: message.community_id,
      sequence: message.sequence,
      prev_hash: message.prev_hash,
      author_pubkey: message.author_pubkey,
      encrypted_content: message.encrypted_content,
      iv: message.iv,
      tag: message.tag,
      attachment_type: message.attachment_type,
      attachment_data: message.attachment_data,
      epoch: message.epoch,
      timestamp: message.timestamp
    };

    const expectedId = CryptoEngine.sha256(blockData);
    if (expectedId !== message.id) {
      console.warn(`[Cadeia] Rejeitada: Hash adulterado. Esperado ${expectedId}, recebido ${message.id}`);
      return { success: false, reason: 'BLOCK_TAMPERED_INVALID_HASH' };
    }

    // 4. Validação da Assinatura Digital Ed25519
    const isSignatureValid = CryptoEngine.verifySignature(
      message.id,
      message.signature,
      message.author_pubkey
    );

    if (!isSignatureValid) {
      console.warn(`[Cadeia] Rejeitada: Assinatura Ed25519 inválida para mensagem ${message.id}`);
      return { success: false, reason: 'INVALID_SIGNATURE' };
    }

    // 5. Verificação da Cadeia e Sequência
    const latest = this.storage.getLatestMessage(message.community_id);
    const expectedSequence = latest ? latest.sequence + 1 : 1;

    if (message.sequence === expectedSequence) {
      // Se tiver mensagem anterior, o prev_hash deve bater
      if (latest && message.prev_hash !== latest.id) {
        return { success: false, reason: 'PREV_HASH_MISMATCH_FORK_ATTEMPT' };
      }

      // Bloco perfeitamente em ordem! Salva
      message.received_at = Date.now();
      this.storage.saveMessage(message);

      // Tenta processar órfãos que possam depender deste bloco
      this.drainOrphans(message.community_id, authorizedAdminPubKeys);

      return { success: true, reason: 'APPLIED' };
    } else if (message.sequence > expectedSequence) {
      // Mensagem futura! Pode ter ocorrido perda de pacotes. Guarda no buffer de órfãos e solicita sincronização
      this.orphanBuffer.set(message.id, message);
      return { success: true, reason: 'BUFFERED_ORPHAN', needsSync: true, expectedSequence };
    } else {
      // Mensagem com sequência já existente: possível partição de rede (split-brain)
      const existingAtSeq = this.storage.getMessageBySequence(message.community_id, message.sequence);
      if (existingAtSeq && existingAtSeq.id !== message.id) {
        // Regra determinística de desempate de partição:
        // 1. Mensagem criada com menor timestamp (mais antiga no tempo real)
        // 2. Desempate lexicográfico pelo hash SHA-256
        const incomingWins = (message.timestamp < existingAtSeq.timestamp) ||
          (message.timestamp === existingAtSeq.timestamp && message.id < existingAtSeq.id);

        if (incomingWins) {
          console.warn(`[Cadeia] Conflito de partição resolvido: Mensagem ${message.id} substitui ${existingAtSeq.id} na sequência #${message.sequence}`);
          // Remove a mensagem sobreposta antes de salvar o vencedor da reconciliação
          this.storage.deleteMessageById(existingAtSeq.id);
          this.storage.appendAuditLog('SPLIT_BRAIN_CONFLICT_RESOLVED', message.author_pubkey, {
            sequence: message.sequence,
            winnerId: message.id,
            supersededId: existingAtSeq.id
          });
          message.received_at = Date.now();
          this.storage.saveMessage(message);
          return { success: true, reason: 'PARTITION_RECONCILED' };
        } else {
          console.warn(`[Cadeia] Conflito de partição: Mensagem existente ${existingAtSeq.id} prevalece sobre ${message.id}`);
          this.storage.appendAuditLog('SPLIT_BRAIN_CONFLICT_REJECTED', message.author_pubkey, {
            sequence: message.sequence,
            retainedId: existingAtSeq.id,
            rejectedId: message.id
          });
          return { success: false, reason: 'PARTITION_CONFLICT_SUPERSEDED' };
        }
      }

      return { success: false, reason: 'OBSOLETE_OR_CONFLICTING_SEQUENCE' };
    }
  }

  /**
   * Processa mensagens do buffer de órfãos caso o antecessor tenha chegado
   */
  drainOrphans(communityId, authorizedAdminPubKeys) {
    let advanced = true;
    while (advanced) {
      advanced = false;
      const latest = this.storage.getLatestMessage(communityId);
      const expectedSequence = latest ? latest.sequence + 1 : 1;

      for (const [id, msg] of this.orphanBuffer.entries()) {
        if (msg.community_id === communityId && msg.sequence === expectedSequence) {
          if (!latest || msg.prev_hash === latest.id) {
            msg.received_at = Date.now();
            this.storage.saveMessage(msg);
            this.orphanBuffer.delete(id);
            advanced = true;
            break;
          }
        }
      }
    }
  }

  /**
   * Descriptografa uma mensagem para exibição na UI caso o nó possua a chave da época
   */
  decryptMessageContent(message, channelKeyHex) {
    try {
      const plaintext = CryptoEngine.decryptAESGCM(
        {
          ciphertext: message.encrypted_content,
          iv: message.iv,
          tag: message.tag
        },
        channelKeyHex
      );
      return {
        ...message,
        plaintext,
        isDecrypted: true
      };
    } catch (e) {
      return {
        ...message,
        plaintext: '[Mensagem Criptografada - Chave Indisponível ou Não Autorizado]',
        isDecrypted: false
      };
    }
  }
}

module.exports = MessageChain;
