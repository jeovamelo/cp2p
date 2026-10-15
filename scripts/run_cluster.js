/**
 * Comunidade Resiliente - Cluster Local de Demonstração
 * Executa localmente:
 * - 1 VPS Bootstrap (Porta 4001)
 * - 1 Nó Admin (Alice, HTTP: 5001, P2P: 6001)
 * - 1 Nó Moderador (Bob, HTTP: 5002, P2P: 6002)
 * - 1 Nó Membro (Carlos, HTTP: 5003, P2P: 6003)
 */

const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const VpsBootstrapServer = require('../src/server/vps_bootstrap');
const P2PNode = require('../src/node/p2p_node');
const CryptoEngine = require('../src/common/crypto');

async function main() {
  console.log('================================================================');
  console.log('  INICIANDO CLUSTER LOCAL DA COMUNIDADE RESILIENTE');
  console.log('================================================================\n');

  const baseDir = path.join(os.homedir(), '.comunidade-resiliente-cluster');

  // 1. VPS Bootstrap
  const vps = new VpsBootstrapServer({ port: 4001 });
  await vps.start();

  // Chave simétrica do canal e chave genesis do admin
  const channelKey = CryptoEngine.generateChannelKey();

  // 2. Nó Alice (Admin)
  const nodeAlice = new P2PNode({
    nodeId: 'alice-admin',
    httpPort: 5001,
    p2pPort: 6001,
    role: 'Administrador',
    username: 'alice_admin',
    channelKey,
    dataDir: path.join(baseDir, 'alice'),
    bootstrapNodes: ['ws://127.0.0.1:4001']
  });
  await nodeAlice.start();

  const alicePubkey = nodeAlice.currentUser.public_key;

  // 3. Nó Bob (Moderador)
  const nodeBob = new P2PNode({
    nodeId: 'bob-moderador',
    httpPort: 5002,
    p2pPort: 6002,
    role: 'Moderador',
    username: 'bob_moderador',
    genesisAdminPubkey: alicePubkey,
    channelKey,
    dataDir: path.join(baseDir, 'bob'),
    bootstrapNodes: ['ws://127.0.0.1:4001']
  });
  await nodeBob.start();

  // 4. Nó Carlos (Membro)
  const nodeCarlos = new P2PNode({
    nodeId: 'carlos-membro',
    httpPort: 5003,
    p2pPort: 6003,
    role: 'Membro',
    username: 'carlos_membro',
    genesisAdminPubkey: alicePubkey,
    channelKey,
    dataDir: path.join(baseDir, 'carlos'),
    bootstrapNodes: ['ws://127.0.0.1:4001']
  });
  await nodeCarlos.start();

  console.log('\n----------------------------------------------------------------');
  console.log('✓ CLUSTER LOCAL 100% OPERACIONAL:');
  console.log('  • VPS Bootstrap:     ws://127.0.0.1:4001 (Status: http://localhost:4001/status)');
  console.log('  • Nó Alice (Admin):  http://localhost:5001 [Pode publicar comunicados assinados]');
  console.log('  • Nó Bob (Mod):      http://localhost:5002 [Gestão de usuários / somente leitura]');
  console.log('  • Nó Carlos (Membro):http://localhost:5003 [Leitura de comunicados e retransmissão P2P]');
  console.log('----------------------------------------------------------------');
  console.log('Pressione CTRL+C para encerrar todos os nós do cluster.\n');

  if (process.env.AUTO_OPEN !== 'false') {
    const cmd = process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
    exec(`${cmd} http://localhost:5001`);
  }

  process.on('SIGINT', async () => {
    console.log('\nEncerrando cluster...');
    await nodeAlice.stop();
    await nodeBob.stop();
    await nodeCarlos.stop();
    await vps.stop();
    console.log('Todos os nós foram finalizados com sucesso.');
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch(err => {
    console.error('Erro ao executar cluster:', err);
    process.exit(1);
  });
}

module.exports = main;
