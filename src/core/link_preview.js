/**
 * Comunidade Resiliente - Módulo de Pré-Visualização Segura de Links (OpenGraph / Metadata)
 * Proteção estrita contra SSRF (Server-Side Request Forgery), injeção de URLs e vazamento de dados.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

class LinkPreviewService {
  /**
   * Extrai URLs http/https válidas de um texto
   * @param {string} text 
   * @returns {string[]}
   */
  static extractUrls(text) {
    if (!text || typeof text !== 'string') return [];
    const urlRegex = /(https?:\/\/[^\s<>'"]+)/gi;
    const matches = text.match(urlRegex) || [];
    return Array.from(new Set(matches)).filter(u => this.isSafeUrl(u));
  }

  /**
   * Validação estrita de segurança contra SSRF e acessos indevidos
   * @param {string} rawUrl 
   * @returns {boolean}
   */
  static isSafeUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }

      // Não permite credenciais embutidas na URL (ex: user:pass@host)
      if (parsed.username || parsed.password) {
        return false;
      }

      const host = parsed.hostname.toLowerCase();

      // Bloqueia loopback e nomes locais
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
        return false;
      }

      // Bloqueia domínios internos e intranet
      if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.corp')) {
        return false;
      }

      // Se for formato de IPv4, checa faixas privadas e link-local
      const ipv4Parts = host.split('.').map(p => parseInt(p, 10));
      if (ipv4Parts.length === 4 && ipv4Parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
        const [a, b] = ipv4Parts;
        if (a === 127) return false; // Loopback
        if (a === 10) return false;  // Classe A privada
        if (a === 172 && b >= 16 && b <= 31) return false; // Classe B privada
        if (a === 192 && b === 168) return false; // Classe C privada
        if (a === 169 && b === 254) return false; // Link-local / Cloud Metadata (169.254.169.254)
        if (a === 100 && b >= 64 && b <= 127) return false; // Carrier-grade NAT
        if (a === 0) return false;
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Sanitiza strings extraídas de páginas HTML (remove tags, limita tamanho)
   * @param {string} str 
   * @param {number} maxLen 
   * @returns {string}
   */
  static sanitizeString(str, maxLen = 160) {
    if (!str || typeof str !== 'string') return '';
    let clean = str.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                   .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/\s+/g, ' ')
                   .trim();
    if (clean.length > maxLen) {
      clean = clean.substring(0, maxLen - 3) + '...';
    }
    return clean;
  }

  /**
   * Busca metadados de uma URL com proteção de timeout, redirecionamento e tamanho
   * @param {string} targetUrl 
   * @param {number} [timeoutMs=3000]
   * @param {number} [maxBytes=65536]
   * @param {number} [maxRedirects=2]
   * @returns {Promise<{ url: string, title?: string, description?: string, image?: string } | null>}
   */
  static async fetchLinkPreview(targetUrl, timeoutMs = 3000, maxBytes = 65536, maxRedirects = 2) {
    if (!this.isSafeUrl(targetUrl)) {
      return null;
    }

    return new Promise((resolve) => {
      let isDone = false;
      const finish = (result) => {
        if (!isDone) {
          isDone = true;
          resolve(result);
        }
      };

      try {
        const parsed = new URL(targetUrl);
        const client = parsed.protocol === 'https:' ? https : http;

        const req = client.get(
          targetUrl,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; ComunidadeResiliente/2.0; +https://cp2p.democracias.org)',
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
            },
            timeout: timeoutMs
          },
          (res) => {
            // Suporte seguro a redirecionamento (máx 2 vezes com validação)
            if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location && maxRedirects > 0) {
              const redirectUrl = new URL(res.headers.location, targetUrl).href;
              res.resume();
              if (this.isSafeUrl(redirectUrl)) {
                return this.fetchLinkPreview(redirectUrl, timeoutMs, maxBytes, maxRedirects - 1)
                  .then(finish)
                  .catch(() => finish(null));
              } else {
                return finish(null);
              }
            }

            if (res.statusCode !== 200) {
              res.resume();
              return finish(null);
            }

            const contentType = res.headers['content-type'] || '';
            if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
              res.resume();
              return finish(null);
            }

            let receivedBytes = 0;
            let body = '';

            res.setEncoding('utf8');
            res.on('data', (chunk) => {
              body += chunk;
              receivedBytes += Buffer.byteLength(chunk, 'utf8');
              if (receivedBytes >= maxBytes) {
                res.destroy();
                finish(this.parseHtmlMetadata(targetUrl, body));
              }
            });

            res.on('end', () => {
              finish(this.parseHtmlMetadata(targetUrl, body));
            });

            res.on('error', () => finish(null));
          }
        );

        req.on('timeout', () => {
          req.destroy();
          finish(null);
        });

        req.on('error', () => finish(null));
      } catch (err) {
        finish(null);
      }
    });
  }

  /**
   * Extrai tags OpenGraph e meta padrão do HTML
   * @param {string} url 
   * @param {string} html 
   * @returns {{ url: string, title?: string, description?: string, image?: string } | null}
   */
  static parseHtmlMetadata(url, html) {
    if (!html) return null;

    let title = '';
    let description = '';
    let image = '';

    // 1. OpenGraph title ou <title>
    const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (ogTitleMatch) {
      title = ogTitleMatch[1];
    } else {
      const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (titleTag) title = titleTag[1];
    }

    // 2. OpenGraph description ou <meta name="description">
    const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    if (ogDescMatch) {
      description = ogDescMatch[1];
    } else {
      const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
      if (metaDesc) description = metaDesc[1];
    }

    // 3. OpenGraph image
    const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogImageMatch) {
      try {
        const rawImg = ogImageMatch[1];
        const resolved = new URL(rawImg, url).href;
        if (this.isSafeUrl(resolved)) {
          image = resolved;
        }
      } catch (e) {}
    }

    title = this.sanitizeString(title, 120);
    description = this.sanitizeString(description, 200);

    if (!title && !description) {
      return null;
    }

    return {
      url,
      title: title || new URL(url).hostname,
      description: description || null,
      image: image || null
    };
  }
}

module.exports = LinkPreviewService;
