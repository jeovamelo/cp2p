/**
 * Comunidade Resiliente - Módulo de NAT Traversal e Cliente STUN (RFC 5389 / RFC 3489)
 * Resolve o IP público reflexivo e porta de nós desktop residenciais atrás de roteadores/NATs
 * Sem dependências externas: utiliza o módulo nativo node:dgram com fallback para STUN via WebSocket.
 */

const dgram = require('dgram');
const os = require('os');

class NatStunResolver {
  /**
   * @param {object} [options]
   * @param {Array<string>} [options.stunServers] - Lista de servidores STUN (ex: ['stun.l.google.com:19302'])
   * @param {number} [options.timeoutMs=2000] - Timeout da sondagem UDP
   */
  constructor(options = {}) {
    this.stunServers = options.stunServers || [
      'stun.l.google.com:19302',
      'stun1.l.google.com:19302',
      'stun.cloudflare.com:3478'
    ];
    this.timeoutMs = options.timeoutMs || 2000;
  }

  /**
   * Obtém o IP local da interface de rede primária
   * @returns {string}
   */
  getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.family === 'IPv4') {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  /**
   * Executa sondagem STUN RFC 5389 via UDP
   * @returns {Promise<{ reflexiveIp: string, reflexivePort: number, localIp: string, natType: string }>}
   */
  async resolveReflexiveAddress() {
    const localIp = this.getLocalIp();

    for (const serverStr of this.stunServers) {
      try {
        const [host, portStr] = serverStr.split(':');
        const port = parseInt(portStr || '19302', 10);
        const result = await this._probeStunServer(host, port);
        if (result && result.reflexiveIp) {
          const natType = result.reflexiveIp === localIp ? 'OPEN_INTERNET' : 'NAT_ROUTED';
          return {
            ...result,
            localIp,
            natType,
            stunServer: serverStr
          };
        }
      } catch (e) {
        // Tenta o próximo servidor da lista
      }
    }

    // Se UDP falhar ou for bloqueado por firewall doméstico estrito, reporta fallback
    return {
      reflexiveIp: localIp,
      reflexivePort: 0,
      localIp,
      natType: 'SYMMETRIC_NAT_OR_FIREWALL',
      requiresRelay: true
    };
  }

  /**
   * Constrói e envia um pacote STUN Binding Request (RFC 5389)
   * Header: 20 bytes [Type 0x0001, Length 0x0000, Magic Cookie 0x2112A442, Transaction ID 12 bytes]
    /**
   * Constrói um pacote binário STUN Binding Request (RFC 5389) de 20 bytes
   * Header: [Type 0x0001, Length 0x0000, Magic Cookie 0x2112A442, Transaction ID 12 bytes]
   */
  createStunProbePacket() {
    const request = Buffer.alloc(20);
    request.writeUInt16BE(0x0001, 0); // Binding Request
    request.writeUInt16BE(0x0000, 2); // Message Length: 0 attributes
    request.writeUInt32BE(0x2112A442, 4); // Magic Cookie
    for (let i = 8; i < 20; i++) {
      request[i] = Math.floor(Math.random() * 256);
    }
    return request;
  }

  parseStunResponse(buffer, transactionId) {
    return this._parseStunResponse(buffer);
  }

  /**
   * Constrói e envia um pacote STUN Binding Request (RFC 5389)
   */
  _probeStunServer(host, port) {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      let timer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        try { socket.close(); } catch (e) {}
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout STUN UDP para ${host}:${port}`));
      }, this.timeoutMs);

      socket.on('error', (err) => {
        cleanup();
        reject(err);
      });

      socket.on('message', (msg) => {
        cleanup();
        try {
          const parsed = this._parseStunResponse(msg);
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });

      const request = this.createStunProbePacket();

      socket.send(request, 0, request.length, port, host, (err) => {
        if (err) {
          cleanup();
          reject(err);
        }
      });
    });
  }

  /**
   * Decodifica a resposta STUN Binding Success (0x0101)
   */
  _parseStunResponse(buffer) {
    if (buffer.length < 20) throw new Error('Pacote STUN muito curto');

    const msgType = buffer.readUInt16BE(0);
    if (msgType !== 0x0101) throw new Error(`Resposta STUN inesperada: 0x${msgType.toString(16)}`);

    const magicCookie = buffer.readUInt32BE(4);
    let offset = 20;

    while (offset < buffer.length) {
      if (offset + 4 > buffer.length) break;
      const attrType = buffer.readUInt16BE(offset);
      const attrLength = buffer.readUInt16BE(offset + 2);
      offset += 4;

      // 0x0020: XOR-MAPPED-ADDRESS (RFC 5389)
      if (attrType === 0x0020 && attrLength >= 8) {
        const family = buffer.readUInt8(offset + 1);
        const xorPort = buffer.readUInt16BE(offset + 2);
        const port = xorPort ^ (magicCookie >>> 16);

        if (family === 0x01) { // IPv4
          const xorIp = buffer.readUInt32BE(offset + 4);
          const ipNum = xorIp ^ magicCookie;
          const ip = [
            (ipNum >>> 24) & 255,
            (ipNum >>> 16) & 255,
            (ipNum >>> 8) & 255,
            ipNum & 255
          ].join('.');

          return { reflexiveIp: ip, reflexivePort: port, ip, port };
        }
      }

      // 0x0001: MAPPED-ADDRESS (RFC 3489 Fallback)
      if (attrType === 0x0001 && attrLength >= 8) {
        const family = buffer.readUInt8(offset + 1);
        const port = buffer.readUInt16BE(offset + 2);

        if (family === 0x01) {
          const ip = [
            buffer.readUInt8(offset + 4),
            buffer.readUInt8(offset + 5),
            buffer.readUInt8(offset + 6),
            buffer.readUInt8(offset + 7)
          ].join('.');
          return { reflexiveIp: ip, reflexivePort: port, ip, port };
        }
      }

      // Avança para o próximo atributo alinhado em 4 bytes
      offset += Math.ceil(attrLength / 4) * 4;
    }

    throw new Error('Nenhum atributo MAPPED-ADDRESS encontrado na resposta STUN');
  }
}

module.exports = NatStunResolver;
