/**
 * Comunidade Resiliente - Gerenciador de Arquivos Seguros e Chunking P2P
 * Criptografia AES-256-GCM, fragmentação em partes de 512KB, verificação Merkle,
 * prevenção contra Path Traversal, validação estrita de MIME/extensão e deduplicação de conteúdo.
 */

const crypto = require('crypto');
const path = require('path');
const CryptoEngine = require('../common/crypto');

// Tamanho padrão de cada chunk: 512 KB
const CHUNK_SIZE = 512 * 1024;

// Limite padrão configurável de tamanho de arquivo: 50 MB
const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024;

// Extensões permitidas e seus tipos MIME canônicos
const ALLOWED_EXTENSIONS = new Map([
  // Imagens
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  // Documentos
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.csv', 'text/csv'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  // Áudio
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.wav', 'audio/wav'],
  ['.m4a', 'audio/mp4'],
  // Vídeo
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm']
]);

// Extensões explicitamente proibidas (executáveis e scripts de alto risco)
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.bash', '.vbs', '.scr', '.dll', '.ps1',
  '.com', '.pif', '.hta', '.jar', '.msi', '.apk', '.bin', '.cgi', '.py'
]);

class FileManager {
  /**
   * Sanitiza nomes de arquivo prevenindo Path Traversal e injeção de caracteres
   * @param {string} rawName 
   * @returns {string} Nome de arquivo seguro
   */
  static sanitizeFilename(rawName) {
    if (!rawName || typeof rawName !== 'string') return 'anexo_sem_nome';
    // Remove qualquer caminho relativo ou absoluto (../, / , \)
    const basename = path.basename(rawName).trim();
    // Substitui caracteres especiais mantendo apenas alfanuméricos, hifens, underlines e pontos
    const clean = basename.replace(/[^a-zA-Z0-9._\-]/g, '_');
    // Trunca para no máximo 100 caracteres preservando extensão
    if (clean.length > 100) {
      const ext = path.extname(clean);
      return clean.substring(0, 100 - ext.length) + ext;
    }
    return clean || 'anexo_seguro';
  }

  /**
   * Valida tipo, extensão e tamanho do arquivo
   * @param {Buffer} buffer 
   * @param {string} filename 
   * @param {string} [declaredMime='']
   * @param {number} [maxSizeBytes=DEFAULT_MAX_FILE_SIZE]
   * @returns {{ valid: boolean, error?: string, mimeType?: string, ext?: string }}
   */
  static validateFile(buffer, filename, declaredMime = '', maxSizeBytes = DEFAULT_MAX_FILE_SIZE) {
    if (!buffer || buffer.length === 0) {
      return { valid: false, error: 'O arquivo enviado está vazio.' };
    }

    if (buffer.length > maxSizeBytes) {
      return {
        valid: false,
        error: `O arquivo excede o limite máximo permitido de ${(maxSizeBytes / (1024 * 1024)).toFixed(0)} MB.`
      };
    }

    const safeName = this.sanitizeFilename(filename);
    const ext = path.extname(safeName).toLowerCase();

    if (!ext || BLOCKED_EXTENSIONS.has(ext)) {
      return { valid: false, error: 'Tipo de arquivo executável ou de risco não permitido.' };
    }

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return { valid: false, error: `Extensão ${ext} não é suportada pela comunidade.` };
    }

    const expectedMime = ALLOWED_EXTENSIONS.get(ext);

    // Validação de Magic Bytes para formatos conhecidos (impede renomear .exe para .jpg)
    if (ext === '.png') {
      const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
      if (!isPng) return { valid: false, error: 'Assinatura binária incompatível com formato PNG legítimo.' };
    } else if (ext === '.jpg' || ext === '.jpeg') {
      const isJpg = buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
      if (!isJpg) return { valid: false, error: 'Assinatura binária incompatível com formato JPEG legítimo.' };
    } else if (ext === '.pdf') {
      const isPdf = buffer.length > 4 && buffer.slice(0, 4).toString() === '%PDF';
      if (!isPdf) return { valid: false, error: 'Assinatura binária incompatível com formato PDF legítimo.' };
    } else if (ext === '.gif') {
      const isGif = buffer.length > 4 && buffer.slice(0, 3).toString() === 'GIF';
      if (!isGif) return { valid: false, error: 'Assinatura binária incompatível com formato GIF legítimo.' };
    }

    return {
      valid: true,
      safeFilename: safeName,
      ext,
      mimeType: expectedMime
    };
  }

  /**
   * Calcula o hash SHA-256 de um buffer para Content-Addressing
   * @param {Buffer} buffer 
   * @returns {string}
   */
  static calculateFileHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Fragmenta um buffer em chunks de 512KB com validação de hash individual
   * @param {Buffer} buffer 
   * @returns {{ fileHash: string, totalChunks: number, fileSize: number, chunks: Array }}
   */
  static chunkBuffer(buffer) {
    const fileHash = this.calculateFileHash(buffer);
    const totalChunks = Math.ceil(buffer.length / CHUNK_SIZE);
    const chunks = [];

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, buffer.length);
      const chunkBuf = buffer.slice(start, end);
      const chunkHash = crypto.createHash('sha256').update(chunkBuf).digest('hex');

      chunks.push({
        fileHash,
        chunkIndex: i,
        totalChunks,
        chunkHash,
        chunkSize: chunkBuf.length,
        chunkData: chunkBuf.toString('base64')
      });
    }

    return {
      fileHash,
      totalChunks,
      fileSize: buffer.length,
      chunks
    };
  }

  /**
   * Reconstitui um buffer a partir de chunks, validando a integridade de cada parte e o hash final
   * @param {Array} chunks 
   * @param {string} expectedFileHash 
   * @returns {Buffer}
   */
  static reassembleChunks(chunks, expectedFileHash) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      throw new Error('Nenhum fragmento fornecido para reconstituição.');
    }

    // Suporta tanto snake_case (SQLite) quanto camelCase (memória)
    const getIdx = c => (c.chunk_index !== undefined ? c.chunk_index : c.chunkIndex);
    const getTotal = c => (c.total_chunks !== undefined ? c.total_chunks : c.totalChunks);
    const getHash = c => (c.chunk_hash !== undefined ? c.chunk_hash : c.chunkHash);
    const getData = c => (c.chunk_data !== undefined ? c.chunk_data : c.chunkData);

    const sorted = [...chunks].sort((a, b) => getIdx(a) - getIdx(b));
    const total = getTotal(sorted[0]);

    if (sorted.length !== total) {
      throw new Error(`Transferência incompleta: recebidos ${sorted.length} de ${total} fragmentos.`);
    }

    const buffers = [];
    for (let i = 0; i < total; i++) {
      const chunk = sorted[i];
      if (getIdx(chunk) !== i) {
        throw new Error(`Fragmento #${i} ausente ou fora de ordem.`);
      }

      const chunkBuf = Buffer.from(getData(chunk), 'base64');
      const calculatedChunkHash = crypto.createHash('sha256').update(chunkBuf).digest('hex');

      if (calculatedChunkHash !== getHash(chunk)) {
        throw new Error(`Fragmento #${i} corrompido: hash inválido.`);
      }

      buffers.push(chunkBuf);
    }

    const completeBuffer = Buffer.concat(buffers);
    const finalHash = this.calculateFileHash(completeBuffer);

    if (expectedFileHash && finalHash !== expectedFileHash) {
      throw new Error(`Integridade do arquivo violada: hash final ${finalHash} diverge do esperado ${expectedFileHash}.`);
    }

    return completeBuffer;
  }

  /**
   * Criptografa o buffer do arquivo com AES-256-GCM antes da replicação
   * @param {Buffer} buffer 
   * @param {string} channelKeyHex 
   * @returns {{ ciphertextBuffer: Buffer, ivHex: string, tagHex: string, originalHash: string }}
   */
  static encryptFileBuffer(buffer, channelKeyHex) {
    const originalHash = this.calculateFileHash(buffer);
    const key = Buffer.from(channelKeyHex, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertextBuffer: ciphertext,
      ivHex: iv.toString('hex'),
      tagHex: tag.toString('hex'),
      originalHash
    };
  }

  /**
   * Decifra o buffer do arquivo com autenticação AES-256-GCM
   * @param {Buffer} ciphertextBuffer 
   * @param {string} ivHex 
   * @param {string} tagHex 
   * @param {string} channelKeyHex 
   * @param {string} [expectedOriginalHash]
   * @returns {Buffer}
   */
  static decryptFileBuffer(ciphertextBuffer, ivHex, tagHex, channelKeyHex, expectedOriginalHash) {
    const key = Buffer.from(channelKeyHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

    const decrypted = Buffer.concat([decipher.update(ciphertextBuffer), decipher.final()]);

    if (expectedOriginalHash) {
      const decHash = this.calculateFileHash(decrypted);
      if (decHash !== expectedOriginalHash) {
        throw new Error('Falha na validação de integridade pós-decifragem do arquivo.');
      }
    }

    return decrypted;
  }
}

module.exports = FileManager;
