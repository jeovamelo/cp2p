/**
 * Comunidade Resiliente - Gerador Autônomo de QR Code em SVG/Canvas
 * Implementação pura em JavaScript sem dependências externas.
 * Gera matrizes 2D para compartilhamento amigável de convites (ex: https://cp2p.democracias.org/join/CR-XXXX)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QRCodeGenerator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // Tabelas de Galois Field GF(256) para Reed-Solomon
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    EXP[i + 255] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }

  function gfMul(a, b) {
    return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
  }

  function rsGenPoly(n) {
    let poly = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= gfMul(poly[j], EXP[i]);
        next[j + 1] ^= poly[j];
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecCount) {
    const gen = rsGenPoly(ecCount);
    const res = new Uint8Array(data.length + ecCount);
    res.set(data);
    for (let i = 0; i < data.length; i++) {
      const coef = res[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j++) {
          res[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return res.subarray(data.length);
  }

  class QRCode {
    /**
     * @param {string} text - Texto ou URL a ser codificada
     * @param {string} [ecLevel='M'] - 'L', 'M', 'Q', 'H'
     */
    constructor(text, ecLevel = 'M') {
      this.text = text;
      this.ecLevel = ecLevel;
      // Capacidade básica para Version 4 (33x33) - suporta URLs de até ~78 caracteres em nível M
      this.version = 4;
      this.size = 17 + this.version * 4; // 33
      this.modules = Array.from({ length: this.size }, () => new Int8Array(this.size).fill(-1));
      this.buildMatrix();
    }

    buildMatrix() {
      // 1. Finder patterns (3 cantos)
      this.addFinderPattern(0, 0);
      this.addFinderPattern(this.size - 7, 0);
      this.addFinderPattern(0, this.size - 7);

      // 2. Timing patterns
      for (let i = 8; i < this.size - 8; i++) {
        const val = (i % 2 === 0) ? 1 : 0;
        this.setModule(6, i, val);
        this.setModule(i, 6, val);
      }

      // 3. Alignment pattern (para versão 4: (24, 24))
      this.addAlignmentPattern(24, 24);

      // 4. Dark module
      this.setModule(8, 4 * this.version + 9, 1);

      // 5. Reserva de formato
      for (let i = 0; i < 9; i++) {
        if (this.modules[8][i] === -1) this.modules[8][i] = 0;
        if (this.modules[i][8] === -1) this.modules[i][8] = 0;
      }
      for (let i = this.size - 8; i < this.size; i++) {
        if (this.modules[8][i] === -1) this.modules[8][i] = 0;
        if (this.modules[i][8] === -1) this.modules[i][8] = 0;
      }

      // 6. Codificação dos dados em formato Byte (8-bit)
      const dataBytes = new TextEncoder().encode(this.text);
      const dataCapacity = 64; // Bytes de dados para versão 4-M
      const ecCapacity = 36;   // Bytes de correção Reed-Solomon

      const stream = [];
      // Modo Byte: 0100
      stream.push(0, 1, 0, 0);
      // Contador de comprimento (8 bits para versão 1-9)
      for (let i = 7; i >= 0; i--) {
        stream.push((dataBytes.length >> i) & 1);
      }
      // Dados
      for (let b of dataBytes) {
        for (let i = 7; i >= 0; i--) {
          stream.push((b >> i) & 1);
        }
      }
      // Terminador
      while (stream.length % 8 !== 0) stream.push(0);
      const rawBytes = [];
      for (let i = 0; i < stream.length; i += 8) {
        let val = 0;
        for (let j = 0; j < 8; j++) val = (val << 1) | stream[i + j];
        rawBytes.push(val);
      }
      // Padding
      const padBytes = [0xec, 0x11];
      let pIdx = 0;
      while (rawBytes.length < dataCapacity) {
        rawBytes.push(padBytes[pIdx % 2]);
        pIdx++;
      }

      const ecBytes = rsEncode(new Uint8Array(rawBytes), ecCapacity);
      const fullCode = [...rawBytes, ...ecBytes];

      // 7. Colocação de dados na matriz com zigue-zague
      let bitIdx = 0;
      const totalBits = fullCode.length * 8;
      let dir = -1; // subindo
      let row = this.size - 1;

      for (let col = this.size - 1; col > 0; col -= 2) {
        if (col === 6) col--; // Pula timing vertical
        for (let r = 0; r < this.size; r++) {
          const actualRow = dir === -1 ? (row - r) : r;
          for (let c = 0; c < 2; c++) {
            const actualCol = col - c;
            if (this.modules[actualRow][actualCol] === -1) {
              let bit = 0;
              if (bitIdx < totalBits) {
                const byte = fullCode[Math.floor(bitIdx / 8)];
                bit = (byte >> (7 - (bitIdx % 8))) & 1;
                bitIdx++;
              }
              // Aplicação de máscara 0: (row + col) % 2 === 0
              if ((actualRow + actualCol) % 2 === 0) {
                bit ^= 1;
              }
              this.modules[actualRow][actualCol] = bit;
            }
          }
        }
        dir = -dir;
      }
    }

    addFinderPattern(x, y) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const px = x + c;
          const py = y + r;
          if (px >= 0 && px < this.size && py >= 0 && py < this.size) {
            if (
              (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
              (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
              (r >= 2 && r <= 4 && c >= 2 && c <= 4)
            ) {
              this.setModule(px, py, 1);
            } else {
              this.setModule(px, py, 0);
            }
          }
        }
      }
    }

    addAlignmentPattern(x, y) {
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const val = (Math.max(Math.abs(r), Math.abs(c)) !== 1) ? 1 : 0;
          this.setModule(x + c, y + r, val);
        }
      }
    }

    setModule(x, y, val) {
      if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
        this.modules[y][x] = val;
      }
    }

    /**
     * Gera string SVG do código QR
     * @param {number} [pixelSize=256]
     * @param {string} [fgColor='#111827']
     * @param {string} [bgColor='#ffffff']
     * @returns {string} SVG válido
     */
    toSVG(pixelSize = 256, fgColor = '#111827', bgColor = '#ffffff') {
      const margin = 4;
      const totalUnits = this.size + margin * 2;
      const scale = pixelSize / totalUnits;

      let rects = '';
      for (let y = 0; y < this.size; y++) {
        for (let x = 0; x < this.size; x++) {
          if (this.modules[y][x] === 1) {
            const rx = (x + margin) * scale;
            const ry = (y + margin) * scale;
            rects += `<rect x="${rx.toFixed(2)}" y="${ry.toFixed(2)}" width="${scale.toFixed(2)}" height="${scale.toFixed(2)}" fill="${fgColor}" />`;
          }
        }
      }

      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pixelSize} ${pixelSize}" width="${pixelSize}" height="${pixelSize}">
  <rect width="100%" height="100%" fill="${bgColor}" />
  ${rects}
</svg>`;
    }
  }

  return {
    generateSVG: (text, size = 256, fg = '#111827', bg = '#ffffff') => {
      const qr = new QRCode(text);
      return qr.toSVG(size, fg, bg);
    },
    QRCode
  };
}));
