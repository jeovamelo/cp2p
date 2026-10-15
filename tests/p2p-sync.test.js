import test from 'node:test';
import assert from 'node:assert';
import { VpsBootstrapServer } from '../packages/vps/src/server.js';
import { DesktopNodeDaemon } from '../packages/desktop-node/src/daemon.js';
import { UserRoles } from '../packages/core/src/model/community.js';

test('Sincronização P2P: 3 Nós sincronizam mensagens assinadas com sucesso', async (t) => {
  // 1. Inicia VPS
  const vps = new VpsBootstrapServer(5099);
  await vps.start();

  // 2. Inicia 3 nós com bancos em memória/temporários
  const nodeAlice = new DesktopNodeDaemon({
    name: 'Nó Alice (Admin)',
    port: 5101,
    p2pPort: 6101,
    dataPath: ':memory:',
    bootstrapUrl: 'ws://localhost:5099',
    role: UserRoles.ADMIN
  });

  const nodeBob = new DesktopNodeDaemon({
    name: 'Nó Bob (Moderador)',
    port: 5102,
    p2pPort: 6102,
    dataPath: ':memory:',
    bootstrapUrl: 'ws://localhost:5099',
    role: UserRoles.MODERATOR
  });

  const nodeCarlos = new DesktopNodeDaemon({
    name: 'Nó Carlos (Membro)',
    port: 5103,
    p2pPort: 6103,
    dataPath: ':memory:',
    bootstrapUrl: 'ws://localhost:5099',
    role: UserRoles.MEMBER
  });

  await nodeAlice.start();
  await nodeBob.start();
  await nodeCarlos.start();

  // Aguarda 1 segundo para handshakes e conexões P2P estabelecerem
  await new Promise(r => setTimeout(r, 1200));

  // Promessas para captura de mensagens recebidas
  const bobReceivedPromise = new Promise(resolve => {
    const original = nodeBob.mesh.onMessageReceived;
    nodeBob.mesh.onMessageReceived = (msg, meta) => {
      original(msg, meta);
      resolve(msg);
    };
  });

  const carlosReceivedPromise = new Promise(resolve => {
    const original = nodeCarlos.mesh.onMessageReceived;
    nodeCarlos.mesh.onMessageReceived = (msg, meta) => {
      original(msg, meta);
      resolve(msg);
    };
  });

  // Alice (Admin) publica mensagem assinada
  const comm = nodeAlice.db.getCommunity('comm_principal');
  const publishReq = await fetch('http://localhost:5101/api/communities/comm_principal/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'Aviso urgente de teste de sincronização P2P'
    })
  });

  assert.strictEqual(publishReq.status, 201);
  const sentMsg = await publishReq.json();
  assert.strictEqual(sentMsg.content, 'Aviso urgente de teste de sincronização P2P');

  // Aguarda Bob e Carlos receberem via malha
  const bobMsg = await bobReceivedPromise;
  const carlosMsg = await carlosReceivedPromise;

  assert.strictEqual(bobMsg.hash, sentMsg.hash);
  assert.strictEqual(carlosMsg.hash, sentMsg.hash);

  // Carlos (não-admin) tenta publicar e DEVE SER REJEITADO
  const imposterReq = await fetch('http://localhost:5103/api/communities/comm_principal/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Tentativa de publicação não autorizada' })
  });

  assert.strictEqual(imposterReq.status, 403);
  const imposterRes = await imposterReq.json();
  assert.ok(imposterRes.error.includes('Acesso negado'));

  // Encerra recursos
  nodeAlice.stop();
  nodeBob.stop();
  nodeCarlos.stop();
  vps.stop();
});
