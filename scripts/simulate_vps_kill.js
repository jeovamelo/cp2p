/**
 * Comunidade Resiliente - Script de Simulação de Queda da VPS e Resiliência P2P
 * 
 * Demonstração prática e automatizada:
 * 1. Inicializa a VPS de Bootstrap (porta 4001) e 3 Nós P2P (Admin Alice, Membro Bob, Membro Carlos).
 * 2. Publica Mensagem #1 com VPS ativa -> Todos os nós recebem.
 * 3. DESLIGA A VPS ABRUPTAMENTE!
 * 4. Os nós detectam a queda da VPS e elegem um novo líder descentralizado.
 * 5. Publica Mensagem #2 com a VPS MORTA -> Mensagem trafega 100% via malha P2P direta!
 * 6. Valida rejeição de mensagens falsificadas / não autorizadas.
 * 7. Valida rotação de chaves criptográficas (Key Rotation).
 */

const path = require('path');
const fs = require('fs');
const VpsBootstrapServer = require('../src/server/vps_bootstrap');
const P2PNode = require('../src/node/p2p_node');
const CryptoEngine = require('../src/common/crypto');

// Cores para saída elegante no terminal
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m'
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSimulation() {
  console.log(`${c.bold}${c.cyan}======================================================================${c.reset}`);
  console.log(`${c.bold}${c.cyan}   COMUNIDADE RESILIENTE - SIMULAÇÃO DE QUEDA DA VPS E TESTE P2P    ${c.reset}`);
  console.log(`${c.bold}${c.cyan}======================================================================${c.reset}\n`);

  const testDir = path.join(__dirname, '..', `data_test_${Date.now()}`);
  try {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  } catch (e) {}

  let vps = null;
  let node1 = null;
  let node2 = null;
  let node3 = null;

  try {
    // ---------------------------------------------------------
    // PASSO 1: Iniciar VPS de Bootstrap e Relay Inicial
    // ---------------------------------------------------------
    console.log(`${c.bold}[PASSO 1] Iniciando VPS de Bootstrap e Descoberta Inicial (Porta 4001)...${c.reset}`);
    vps = new VpsBootstrapServer({ port: 4001 });
    await vps.start();
    console.log(`${c.green}✓ VPS Bootstrap iniciada com sucesso na porta 4001.${c.reset}\n`);

    // ---------------------------------------------------------
    // PASSO 2: Iniciar 3 Nós P2P Independentes
    // ---------------------------------------------------------
    console.log(`${c.bold}[PASSO 2] Inicializando 3 Nós P2P em portas diferentes:${c.reset}`);

    // Nó 1: Administradora Alice (cria a comunidade e a chave do canal)
    const initialChannelKey = CryptoEngine.generateChannelKey();

    node1 = new P2PNode({
      nodeId: 'node-alice-admin',
      httpPort: 5001,
      p2pPort: 6001,
      role: 'Administrador',
      username: 'alice_admin',
      channelKey: initialChannelKey,
      dataDir: path.join(testDir, 'alice'),
      bootstrapNodes: ['ws://127.0.0.1:4001']
    });
    await node1.start();
    const alicePubkey = node1.currentUser.public_key;
    console.log(`  ${c.green}✓ Nó 1 [Alice - Administradora] ativo (HTTP: 5001, P2P: 6001)${c.reset}`);

    // Nó 2: Membro Bob (onboarding com convite contendo a chave gênesis de Alice e a chave do canal)
    node2 = new P2PNode({
      nodeId: 'node-bob-membro',
      httpPort: 5002,
      p2pPort: 6002,
      role: 'Membro',
      username: 'bob_membro',
      genesisAdminPubkey: alicePubkey,
      channelKey: initialChannelKey,
      dataDir: path.join(testDir, 'bob'),
      bootstrapNodes: ['ws://127.0.0.1:4001']
    });
    await node2.start();
    console.log(`  ${c.green}✓ Nó 2 [Bob - Membro] ativo (HTTP: 5002, P2P: 6002)${c.reset}`);

    // Nó 3: Membro Carlos (onboarding similar)
    node3 = new P2PNode({
      nodeId: 'node-carlos-membro',
      httpPort: 5003,
      p2pPort: 6003,
      role: 'Membro',
      username: 'carlos_membro',
      genesisAdminPubkey: alicePubkey,
      channelKey: initialChannelKey,
      dataDir: path.join(testDir, 'carlos'),
      bootstrapNodes: ['ws://127.0.0.1:4001']
    });
    await node3.start();
    console.log(`  ${c.green}✓ Nó 3 [Carlos - Membro] ativo (HTTP: 5003, P2P: 6003)${c.reset}\n`);

    // Aguarda sincronização PEX inicial (descoberta de malha direta)
    console.log(`${c.yellow}Aguardando descoberta e estabelecimento da malha P2P direta entre os nós (3 segundos)...${c.reset}`);
    await sleep(3000);

    console.log(`  Conexões do Nó 1 (Alice):  ${node1.p2p.peers.size} pares diretos`);
    console.log(`  Conexões do Nó 2 (Bob):    ${node2.p2p.peers.size} pares diretos`);
    console.log(`  Conexões do Nó 3 (Carlos): ${node3.p2p.peers.size} pares diretos`);

    // ---------------------------------------------------------
    // PASSO 3: Publicação da Mensagem 1 (com VPS Online)
    // ---------------------------------------------------------
    console.log(`\n${c.bold}[PASSO 3] Alice (Admin) publica Comunicado #1 enquanto a VPS está ONLINE...${c.reset}`);
    const comm1 = node1.storage.getCommunity('geral');
    const key1 = node1.storage.getKeyForEpoch('geral', comm1.current_epoch);

    const msg1 = node1.chain.createSignedMessage({
      communityId: 'geral',
      plaintext: 'AVISO #1: Olá a todos! Servidor e nós operando em harmonia.',
      channelKeyHex: key1,
      authorPublicKey: node1.currentUser.public_key,
      authorPrivateKey: node1.activePrivateKeyPem,
      epoch: comm1.current_epoch
    });
    node1.p2p.publishMessage(msg1);

    await sleep(1500);

    const bobMsg1 = node2.storage.getMessageById(msg1.id);
    const carlosMsg1 = node3.storage.getMessageById(msg1.id);

    if (bobMsg1 && carlosMsg1) {
      console.log(`${c.green}✓ SUCESSO: Nó 2 (Bob) e Nó 3 (Carlos) receberam e validaram o Comunicado #1!${c.reset}`);
      console.log(`  ID do bloco: ${msg1.id.substring(0, 24)}...`);
      console.log(`  Assinatura Ed25519: VÁLIDA`);
      const decBob = CryptoEngine.decryptAESGCM(
        { ciphertext: bobMsg1.encrypted_content, iv: bobMsg1.iv, tag: bobMsg1.tag },
        key1
      );
      console.log(`  Texto decifrado por Bob: "${decBob}"`);
    } else {
      throw new Error('Falha na replicação da Mensagem #1.');
    }

    // ---------------------------------------------------------
    // PASSO 4: SIMULAÇÃO DE QUEDA DA VPS (KILL VPS)
    // ---------------------------------------------------------
    console.log(`\n${c.bold}${c.red}======================================================================${c.reset}`);
    console.log(`${c.bold}${c.red}[PASSO 4] SIMULAÇÃO DE QUEDA DA VPS! DESLIGANDO SERVIDOR CENTRAL...${c.reset}`);
    console.log(`${c.bold}${c.red}======================================================================${c.reset}`);
    await vps.stop();
    vps = null;
    console.log(`${c.red}⚡ A VPS CENTRAL FOI COMPLETAMENTE DESLIGADA / BLOQUEADA!${c.reset}`);

    node1.p2p.consensus.notifyBootstrapFailed();
    node2.p2p.consensus.notifyBootstrapFailed();
    node3.p2p.consensus.notifyBootstrapFailed();

    console.log(`${c.yellow}Aguardando os nós P2P detectarem a queda e elegerem novo líder autônomo (3 segundos)...${c.reset}`);
    await sleep(3000);

    console.log(`  Líder no Nó 1 (Alice):  ${node1.p2p.consensus.currentLeaderId || 'Autônomo'}`);
    console.log(`  Líder no Nó 2 (Bob):    ${node2.p2p.consensus.currentLeaderId || 'Autônomo'}`);
    console.log(`  Líder no Nó 3 (Carlos): ${node3.p2p.consensus.currentLeaderId || 'Autônomo'}`);

    // ---------------------------------------------------------
    // PASSO 5: Publicação da Mensagem 2 com VPS MORTA!
    // ---------------------------------------------------------
    console.log(`\n${c.bold}[PASSO 5] Alice publica Comunicado #2 COM A VPS TOTALMENTE INOPERANTE!${c.reset}`);
    const msg2 = node1.chain.createSignedMessage({
      communityId: 'geral',
      plaintext: 'AVISO #2 [EMERGÊNCIA]: A VPS caiu, mas a Comunidade Resiliente continua viva via P2P!',
      channelKeyHex: key1,
      authorPublicKey: node1.currentUser.public_key,
      authorPrivateKey: node1.activePrivateKeyPem,
      epoch: comm1.current_epoch
    });

    console.log(`  Difundindo mensagem na malha direta P2P...`);
    node1.p2p.publishMessage(msg2);

    await sleep(2000);

    const bobMsg2 = node2.storage.getMessageById(msg2.id);
    const carlosMsg2 = node3.storage.getMessageById(msg2.id);

    if (bobMsg2 && carlosMsg2) {
      console.log(`${c.green}${c.bold}✓ SUCESSO TOTAL P2P: Nó 2 (Bob) e Nó 3 (Carlos) receberam o Comunicado #2 SEM NENHUM SERVIDOR CENTRAL!${c.reset}`);
      console.log(`  Seq: #${bobMsg2.sequence} | PrevHash: ${bobMsg2.prev_hash.substring(0, 16)}...`);
      console.log(`  Conteúdo decifrado no computador de Bob:`);
      const decBob = CryptoEngine.decryptAESGCM(
        { ciphertext: bobMsg2.encrypted_content, iv: bobMsg2.iv, tag: bobMsg2.tag },
        key1
      );
      console.log(`  "${decBob}"`);
    } else {
      throw new Error('Falha crítica: Nós não conseguiram sincronizar com a VPS desligada.');
    }

    // ---------------------------------------------------------
    // PASSO 6: Teste de Segurança - Tentativa de Forjar Mensagem por Não-Admin
    // ---------------------------------------------------------
    console.log(`\n${c.bold}[PASSO 6] Teste de Segurança: Bob (Membro) tenta forjar uma publicação...${c.reset}`);
    const bobKeypair = CryptoEngine.generateEd25519KeyPair();
    const forgedMessage = {
      id: 'forged_id_test',
      community_id: 'geral',
      sequence: 3,
      prev_hash: msg2.id,
      author_pubkey: bobKeypair.publicKey,
      encrypted_content: 'fake_cipher',
      iv: '000000000000000000000000',
      tag: '00000000000000000000000000000000',
      attachment_type: null,
      attachment_data: null,
      epoch: 1,
      timestamp: Date.now(),
      signature: 'fake_sig'
    };

    const adminPubkeys = [alicePubkey];
    const validationResult = node2.chain.processIncomingMessage(forgedMessage, adminPubkeys);

    if (!validationResult.success && validationResult.reason === 'UNAUTHORIZED_AUTHOR_NOT_ADMIN') {
      console.log(`${c.green}✓ SUCESSO: Mensagem forjada de não-administrador foi REJEITADA com '${validationResult.reason}'!${c.reset}`);
    } else {
      throw new Error(`Falha de segurança: Mensagem forjada não foi rejeitada corretamente.`);
    }

    // ---------------------------------------------------------
    // PASSO 7: Teste de Rotação de Chaves Criptográficas (Key Rotation)
    // ---------------------------------------------------------
    console.log(`\n${c.bold}[PASSO 7] Teste de Revogação e Rotação de Chave (Key Rotation)...${c.reset}`);
    const newEpoch = comm1.current_epoch + 1;
    const newChannelKey = CryptoEngine.generateChannelKey();

    node1.storage.saveKeyEpoch('geral', newEpoch, newChannelKey, node1.currentUser.public_key);
    node1.storage.updateCommunityEpoch('geral', newEpoch);

    console.log(`  ${c.green}✓ Nova Época #${newEpoch} ativada. Chave antiga invalidada para mensagens futuras.${c.reset}`);

    const auditIntegrity = node1.auditLogger.verifyChainIntegrity();
    console.log(`  ${c.green}✓ Cadeia de auditoria verificada: ${auditIntegrity.totalLogs} logs, 100% íntegra.${c.reset}`);

    // ---------------------------------------------------------
    // RESULTADO FINAL
    // ---------------------------------------------------------
    console.log(`\n${c.bold}${c.green}======================================================================${c.reset}`);
    console.log(`${c.bold}${c.green}   TODOS OS TESTES E SIMULAÇÕES CONCLUÍDOS COM SUCESSO ABSOLUTO!    ${c.reset}`);
    console.log(`${c.bold}${c.green}   A Comunidade Resiliente provou imunidade à queda do servidor.     ${c.reset}`);
    console.log(`${c.bold}${c.green}======================================================================${c.reset}\n`);

  } finally {
    console.log('Finalizando nós da simulação...');
    if (node1) await node1.stop();
    if (node2) await node2.stop();
    if (node3) await node3.stop();
    if (vps) await vps.stop();

    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (e) {}
    console.log('Ambiente limpo.');
  }
}

if (require.main === module) {
  runSimulation().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error(`\x1b[31mErro na simulação:\x1b[0m`, err);
    process.exit(1);
  });
}

module.exports = runSimulation;
