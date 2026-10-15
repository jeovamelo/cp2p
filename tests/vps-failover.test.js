import test from 'node:test';
import assert from 'node:assert';
import { VpsBootstrapServer } from '../packages/vps/src/server.js';
import { DesktopNodeDaemon } from '../packages/desktop-node/src/daemon.js';
import { UserRoles } from '../packages/core/src/model/community.js';

test('Tolerância a Falhas: A malha P2P continua sincronizando após o desligamento da VPS', async () => {
  // 1. Inicia a VPS Bootstrap
  const vps = new VpsBootstrapServer(5098);
  await vps.start();

  // 2. Inicia 3 nós P2P
  const nodeAlice = new DesktopNodeDaemon({
    name: 'Nó Alice (Admin)',
    port: 5111,
    p2pPort: 6111,
    dataPath: ':memory:',
    bootstrapUrl: 'ws://localhost:5098',
    role: UserRoles.ADMIN
  });

  const nodeBob = new DesktopNodeDaemon({
    name: 'Nó Bob (Moderador)',
    port: 5112,
    p2pPort: 6112,
    dataPath: ':memory:',
    bootstrapUrl: 'ws://localhost:5098',
    role: UserRoles.MODERATOR
  });

  const nodeCarlos = new DesktopNodeDaemon({
    name: 'Nó Carlos (Membro)',
    port: 5113,
    p2pPort: 6113,
    dataPath: ':memory:',
    bootstrapUrl: 'ws://localhost:5098',
    role: UserRoles.MEMBER
  });

  await nodeAlice.start();
  await nodeBob.start();
  await nodeCarlos.start();

  // Garante conexões diretas entre os nós (PEX / malha direta)
  nodeBob.mesh.connectToAddress('ws://localhost:6111', false);
  nodeCarlos.mesh.connectToAddress('ws://localhost:6112', false);
  nodeCarlos.mesh.connectToAddress('ws://localhost:6111', false);

  // Aguarda 1.5s para conexões estabilizarem
  await new Promise(r => setTimeout(r, 1500));

  // 3. Envia Mensagem #1 com VPS ATIVA
  const res1 = await fetch('http://localhost:5111/api/communities/comm_principal/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Mensagem 1: Com VPS Online' })
  });
  assert.strictEqual(res1.status, 201);

  await new Promise(r => setTimeout(r, 600));

  // 4. DESLIGA A VPS PRINCIPAL COMPLETAMENTE! (SIMULA QUEDA/CENSURA/FALHA DE ENERGIA)
  console.log('\n🔴 [TESTE] DESLIGANDO A VPS BOOTSTRAP AGORA...');
  vps.stop();

  // Aguarda 1s para os nós detectarem a queda
  await new Promise(r => setTimeout(r, 1200));

  // Prepara escutas para a nova mensagem nos nós Bob e Carlos
  const bobReceivedPromise = new Promise(resolve => {
    const orig = nodeBob.mesh.onMessageReceived;
    nodeBob.mesh.onMessageReceived = (msg, meta) => {
      orig(msg, meta);
      resolve(msg);
    };
  });

  const carlosReceivedPromise = new Promise(resolve => {
    const orig = nodeCarlos.mesh.onMessageReceived;
    nodeCarlos.mesh.onMessageReceived = (msg, meta) => {
      orig(msg, meta);
      resolve(msg);
    };
  });

  // 5. Alice publica Mensagem #2 com a VPS 100% DESLIGADA
  console.log('📢 [TESTE] Publicando nova mensagem na malha pura P2P (Sem VPS)...');
  const res2 = await fetch('http://localhost:5111/api/communities/comm_principal/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Mensagem 2: Sobreviveu ao desligamento da VPS!' })
  });

  assert.strictEqual(res2.status, 201);
  const msg2 = await res2.json();

  // 6. Confirma que Bob e Carlos receberam a mensagem diretamente via P2P
  const bobMsg2 = await bobReceivedPromise;
  const carlosMsg2 = await carlosReceivedPromise;

  assert.strictEqual(bobMsg2.hash, msg2.hash);
  assert.strictEqual(carlosMsg2.hash, msg2.hash);

  // Confirma que os bancos de dados locais dos nós possuem as duas mensagens
  const bobMessages = nodeBob.db.getMessagesByCommunity('comm_principal');
  assert.strictEqual(bobMessages.length, 2);

  const carlosMessages = nodeCarlos.db.getMessagesByCommunity('comm_principal');
  assert.strictEqual(carlosMessages.length, 2);

  console.log('✅ [TESTE SUCESSO] A malha P2P continuou operando autonomamente e entregou todas as mensagens!');

  nodeAlice.stop();
  nodeBob.stop();
  nodeCarlos.stop();
});
