/**
 * Comunidade Resiliente - Desktop Runner (Windows, macOS, Linux)
 * Inicializa o nó P2P no computador pessoal do usuário e abre a interface local.
 */

const { exec } = require('child_process');
const os = require('os');
const path = require('path');
const P2PNode = require('../node/p2p_node');

async function main() {
  console.log('====================================================');
  console.log('  COMUNIDADE RESILIENTE - NÓ P2P DESKTOP');
  console.log('  Plataforma Autônoma e Resiliente de Mensagens');
  console.log('====================================================');

  const httpPort = parseInt(process.env.HTTP_PORT || '5001', 10);
  const p2pPort = parseInt(process.env.P2P_PORT || '6001', 10);
  const role = process.env.ROLE || 'Membro';
  const username = process.env.USERNAME || (role === 'Administrador' ? 'admin_principal' : `usuario_${os.hostname().toLowerCase().replace(/[^a-z0-9]/g, '')}`);
  const dataDir = process.env.DATA_DIR || path.join(os.homedir(), '.comunidade-resiliente', 'data');
  const bootstraps = process.env.BOOTSTRAPS ? process.env.BOOTSTRAPS.split(',') : ['ws://127.0.0.1:4001'];

  console.log(`[Desktop] Sistema Operacional: ${os.type()} ${os.arch()}`);
  console.log(`[Desktop] Diretório de Dados: ${dataDir}`);
  console.log(`[Desktop] Papel Inicial: ${role}`);
  console.log(`[Desktop] Conectando a bootstraps: ${bootstraps.join(', ')}`);

  const node = new P2PNode({
    nodeId: `desktop-${os.hostname()}-${p2pPort}`,
    httpPort,
    p2pPort,
    dataDir,
    role,
    username,
    bootstrapNodes: bootstraps
  });

  await node.start();

  const url = `http://localhost:${httpPort}`;
  console.log(`\n✓ Nó P2P iniciado com sucesso!`);
  console.log(`✓ Interface Web/PWA disponível em: ${url}`);
  console.log(`✓ Malha P2P escutando na porta: ${p2pPort}`);

  // Abre automaticamente em modo aplicativo desktop dedicado (WhatsApp Desktop style)
  if (process.env.AUTO_OPEN !== 'false') {
    if (process.platform === 'win32') {
      exec(`start msedge --app="${url}" --window-size=1240,840`, (err) => {
        if (err) {
          exec(`start chrome --app="${url}" --window-size=1240,840`, (err2) => {
            if (err2) {
              exec(`start ${url}`);
            }
          });
        }
      });
    } else if (process.platform === 'darwin') {
      exec(`open -na "Google Chrome" --args --app="${url}"`, (err) => {
        if (err) exec(`open "${url}"`);
      });
    } else {
      exec(`google-chrome --app="${url}"`, (err) => {
        if (err) exec(`xdg-open "${url}"`);
      });
    }
  }

  process.on('SIGINT', async () => {
    console.log('\nFinalizando nó desktop...');
    await node.stop();
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch(err => {
    console.error('Erro fatal ao iniciar desktop runner:', err);
    process.exit(1);
  });
}

module.exports = main;
