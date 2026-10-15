/**
 * Comunidade Resiliente - Protocolo de Comunicação P2P Wire Protocol
 * Define os tipos de mensagens e estruturas de pacotes trocados entre nós
 */

const MessageType = {
  // Descoberta e Handshake
  HELLO: 'HELLO',                         // Apresentação inicial do nó
  HELLO_ACK: 'HELLO_ACK',                 // Resposta com estado do nó
  PEER_EXCHANGE: 'PEER_EXCHANGE',         // Compartilhamento descentralizado de nós conhecidos (PEX)
  HEARTBEAT: 'HEARTBEAT',                 // Verificação de vivacidade periódica

  // Sincronização e Replicação
  GOSSIP_MESSAGE: 'GOSSIP_MESSAGE',       // Difusão epidêmica de novo comunicado
  SYNC_REQUEST: 'SYNC_REQUEST',           // Solicitação de blocos de mensagens ausentes
  SYNC_RESPONSE: 'SYNC_RESPONSE',         // Envio dos blocos faltantes
  
  // Consenso e Eleição de Líder (quando a VPS cai)
  ELECTION_CALL: 'ELECTION_CALL',         // Início de processo de eleição
  ELECTION_VOTE: 'ELECTION_VOTE',         // Voto de um nó
  ELECTION_DECLARE: 'ELECTION_DECLARE',   // Anúncio do novo líder eleito

  // Administração e Governança
  ADMIN_ACTION: 'ADMIN_ACTION',           // Ação administrativa assinada (revogação, rotação de chave)
  KEY_ROTATION: 'KEY_ROTATION',           // Notificação de nova época de chave criptográfica
  
  // Relay / Fallback
  RELAY_FORWARD: 'RELAY_FORWARD',         // Encapsulamento de mensagem via nó intermediário

  // NAT Traversal & Descoberta de IP Reflexivo (STUN)
  STUN_PROBE: 'STUN_PROBE',               // Sondagem de IP reflexivo/público e tipo de NAT
  STUN_RESPONSE: 'STUN_RESPONSE',         // Resposta com endereço externo e porta descoberta

  // Autenticação Mútua de Nós (Ed25519)
  NODE_AUTH_CHALLENGE: 'NODE_AUTH_CHALLENGE', // Desafio criptográfico com nonce para autenticação de nó
  NODE_AUTH_RESPONSE: 'NODE_AUTH_RESPONSE'    // Resposta assinada com a chave privada do nó
};

class ProtocolPacket {
  /**
   * Cria um pacote formatado do protocolo
   * @param {string} type - Tipo de mensagem (MessageType)
   * @param {string} senderNodeId - ID do nó emissor
   * @param {object} payload - Dados específicos do tipo
   * @returns {object} Objeto pronto para serialização JSON
   */
  static create(type, senderNodeId, payload = {}) {
    return {
      protocol: 'comunidade-resiliente/1.0',
      type,
      senderNodeId,
      timestamp: Date.now(),
      nonce: Math.random().toString(36).substring(2, 15),
      payload
    };
  }

  /**
   * Valida se um objeto recebido segue a estrutura do protocolo
   * @param {object} packet 
   * @returns {boolean}
   */
  static isValid(packet) {
    return (
      packet &&
      packet.protocol === 'comunidade-resiliente/1.0' &&
      typeof packet.type === 'string' &&
      typeof packet.senderNodeId === 'string' &&
      typeof packet.timestamp === 'number' &&
      typeof packet.payload === 'object'
    );
  }
}

module.exports = {
  MessageType,
  ProtocolPacket
};
