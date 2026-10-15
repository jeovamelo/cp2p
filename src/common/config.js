/**
 * Comunidade Resiliente - Gerenciador Central de Configurações
 * Domínio Oficial: https://cp2p.democracias.org
 * Suporta ambiente de produção e desenvolvimento local separado.
 */

function parseOrigins(raw) {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

class SystemConfig {
  constructor(env = process.env) {
    this.NODE_ENV = env.NODE_ENV || 'production';
    this.isProduction = this.NODE_ENV === 'production' || env.APP_DOMAIN === 'cp2p.democracias.org';

    // Domínio e URLs Oficiais Padrão: cp2p.democracias.org
    if (this.isProduction) {
      this.APP_DOMAIN = env.APP_DOMAIN || 'cp2p.democracias.org';
      this.APP_URL = env.APP_URL || `https://${this.APP_DOMAIN}`;
      this.PUBLIC_URL = env.PUBLIC_URL || this.APP_URL;
      this.API_URL = env.API_URL || `${this.APP_URL}/api`;
      this.WS_URL = env.WS_URL || `wss://${this.APP_DOMAIN}`;
      this.BOOTSTRAP_URL = env.BOOTSTRAP_URL || `https://${this.APP_DOMAIN}`;
      this.BOOTSTRAP_WS_URL = env.BOOTSTRAP_WS_URL || `wss://${this.APP_DOMAIN}`;
      this.PUBLIC_BOOTSTRAP_ADDRESS = env.PUBLIC_BOOTSTRAP_ADDRESS || this.BOOTSTRAP_WS_URL;
    } else {
      // Ambiente de Desenvolvimento Local explícito (quando NODE_ENV=development)
      this.APP_DOMAIN = env.APP_DOMAIN || 'localhost';
      this.HTTP_PORT = parseInt(env.HTTP_PORT || '5001', 10);
      this.APP_URL = env.APP_URL || `http://localhost:${this.HTTP_PORT}`;
      this.PUBLIC_URL = env.PUBLIC_URL || this.APP_URL;
      this.API_URL = env.API_URL || `${this.APP_URL}/api`;
      this.WS_URL = env.WS_URL || `ws://localhost:${this.HTTP_PORT}`;
      this.BOOTSTRAP_URL = env.BOOTSTRAP_URL || 'http://127.0.0.1:4001';
      this.BOOTSTRAP_WS_URL = env.BOOTSTRAP_WS_URL || 'ws://127.0.0.1:4001';
      this.PUBLIC_BOOTSTRAP_ADDRESS = env.PUBLIC_BOOTSTRAP_ADDRESS || this.BOOTSTRAP_WS_URL;
    }

    // Portas dos daemons locais
    this.HTTP_PORT = parseInt(env.HTTP_PORT || '5001', 10);
    this.P2P_PORT = parseInt(env.P2P_PORT || '6001', 10);
    this.VPS_PORT = parseInt(env.PORT || env.VPS_PORT || '4001', 10);

    // Bootstraps P2P
    const rawBootstraps = env.BOOTSTRAP_NODES || env.BOOTSTRAPS || '';
    if (rawBootstraps) {
      this.BOOTSTRAP_NODES = rawBootstraps.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      this.BOOTSTRAP_NODES = this.isProduction
        ? [this.BOOTSTRAP_WS_URL]
        : ['ws://127.0.0.1:4001'];
    }

    // CORS & Origens Permitidas
    const configuredOrigins = parseOrigins(env.CORS_ALLOWED_ORIGINS);
    if (this.isProduction) {
      this.ALLOWED_ORIGINS = new Set([
        `https://${this.APP_DOMAIN}`,
        this.APP_URL.toLowerCase(),
        ...configuredOrigins
      ]);
    } else {
      this.ALLOWED_ORIGINS = new Set([
        `http://localhost:${this.HTTP_PORT}`,
        `http://127.0.0.1:${this.HTTP_PORT}`,
        `http://localhost:5001`,
        `http://localhost:5002`,
        `http://localhost:5003`,
        `https://${this.APP_DOMAIN}`,
        ...configuredOrigins
      ]);
    }

    // Políticas de Segurança e Cookies
    this.COOKIE_SETTINGS = {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'Lax',
      domain: this.isProduction ? `.${this.APP_DOMAIN}` : undefined
    };

    // Cabeçalhos de Segurança Padrão
    this.SECURITY_HEADERS = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'Content-Security-Policy': this.generateCSP()
    };

    if (this.isProduction) {
      this.SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
    }
  }

  generateCSP() {
    const wsHost = this.isProduction ? `wss://${this.APP_DOMAIN}` : 'ws: wss:';
    const appHost = this.isProduction ? `https://${this.APP_DOMAIN}` : '';
    return [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'`,
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data: blob: https:`,
      `font-src 'self' data:`,
      `connect-src 'self' ${appHost} ${wsHost} https:`,
      `object-src 'none'`,
      `base-uri 'self'`,
      `frame-ancestors 'none'`,
      `form-action 'self'`
    ].filter(Boolean).join('; ');
  }

  isOriginAllowed(origin) {
    if (!origin) return true; // Requisições locais/same-origin sem header Origin
    const norm = origin.trim().toLowerCase();
    return this.ALLOWED_ORIGINS.has(norm);
  }

  getFrontendConfig() {
    return {
      domain: this.APP_DOMAIN,
      appUrl: this.APP_URL,
      apiUrl: this.API_URL,
      wsUrl: this.WS_URL,
      isProduction: this.isProduction,
      version: '1.1.0'
    };
  }
}

const defaultInstance = new SystemConfig();
defaultInstance.SystemConfig = SystemConfig;

module.exports = defaultInstance;
