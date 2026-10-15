# Relatório Inicial de Evolução Arquitetural - Comunidade Resiliente

Data: 14 de Outubro de 2026
Objetivo: Transformar o protótipo “Comunidade Resiliente” em uma rede P2P funcional pela internet, com nós desktop persistentes, STUN/Relay real, segurança criptográfica estrita, resiliência a partições de rede, notificações Web Push e um Painel Visual de Monitoramento da Comunidade em tempo real.

---

## 1. Análise da Estrutura Atual e Consolidação

### Decisão Estrutural: Unificação sob `src/`
* **Diagnóstico:** O repositório continha duas estruturas paralelas:
  1. `src/`: A arquitetura principal, funcional, testada (16 testes unitários + testes de comunidades passando com sucesso), usando CommonJS, SQLite nativo em modo WAL (`node:sqlite`), WebSocket Mesh, CRDT Hash Chain, eleição e interface WhatsApp Desktop.
  2. `packages/`: Um protótipo anterior fragmentado em monorepo ESM, com persistência simulada em arquivos `.json` e quebrava ao rodar com `node --test` devido a divergências de módulos CommonJS/ESM.
* **Ação Executada:**
  * Eleição definitiva de `src/` como a estrutura canônica da aplicação.
  * Remoção segura da pasta duplicada e obsoleta `packages/`.
  * Atualização da pasta `tests/` para consumir diretamente os módulos canônicos de `src/`.

---

## 2. Mapa dos Arquivos Afetados

| Módulo / Arquivo | Tipo de Alteração | Finalidade |
| :--- | :--- | :--- |
| `src/core/storage.js` | Evolução | Versionamento de migrações SQLite, índices, tabela de identidades de nós, sessões com expiração, cache de peers para fallback offline. |
| `src/core/p2p_engine.js` | Evolução Crítica | Suporte a redes externas (WAN/Internet), STUN client para descoberta de IP reflexivo, autenticação mútua de nós (Ed25519 handshake com nonce), fallback de relay com envelopes criptografados, PEX persistente e Kademlia-style distance routing. |
| `src/server/vps_bootstrap.js` | Evolução | Suporte a múltiplos bootstraps, serviço de Relay transparente com rate-limiting e sinalização de descoberta P2P para nós atrás de NAT. |
| `src/core/consensus.js` | Evolução | Algoritmo Raft-lite com termos persistidos no SQLite, jitter aleatório de heartbeat, quorum de maioria estrito e proteção contra líderes múltiplos. |
| `src/core/crdt_chain.js` | Evolução | Hash canônico rigoroso, resolução determinística de conflitos em partições (split-brain), fila de blocos órfãos e sincronização por faixas de sequência. |
| `src/core/notification_service.js` | Evolução | Implementação real de Web Push (VAPID) com zero-knowledge push payload (sem vazar conteúdo em texto claro) e fila de retentativas offline. |
| `src/node/p2p_node.js` | Evolução | Endpoints seguros de autenticação com sessões temporizadas, proteção contra CSRF/força bruta, APIs do Painel de Monitoramento da Rede (`/api/network/*`) e telemetria WebSocket `/live/network`. |
| `src/web/index.html` | Evolução | Adição da tela/modal "Visão da Comunidade / Status da Rede" com diagrama de nós, cartões de telemetria, lista de participantes e linha do tempo de eventos. |
| `src/web/css/styles.css` | Evolução | Estilização do painel de monitoramento, nós P2P, badges de conexão (direto vs relay), estados (verde, azul, cinza, amarelo). |
| `src/web/js/app.js` | Evolução | Controlador em tempo real do painel visual, renderização do diagrama SVG/Canvas, métricas de dispositivos (desktop, celular, web) e reconexão automática. |
| `scripts/run_network_simulation.js` | Novo Script | Teste de rede real com 3+ processos separados, portas distintas, simulação de queda de VPS, partição de rede, relay e reconexão. |
| `tests/suite_full.test.js` | Novo Teste | Bateria completa automatizada validando todos os 18 requisitos técnicos obrigatórios. |
| `.env.example` | Novo Arquivo | Configurações de ambiente, múltiplos bootstraps, STUN/TURN e VAPID push. |
| `docker-compose.yml` & `Dockerfile*` | Atualização | Ambientes multi-nó e VPS com variáveis de rede externas e volumes persistentes. |
| `README.md` & `INSTALLATION.md` | Atualização | Documentação honesta e detalhada sobre o que foi implementado, limitações de NAT e operação. |

---

## 3. Próximas Etapas de Execução

1. **Remover com segurança `packages/` e unificar `tests/`**: Eliminar duplicidade e garantir integridade.
2. **Camada de Banco de Dados (`storage.js`)**: Migrações versionadas, tabelas `node_identities`, `sessions`, `network_events`, `push_subscriptions`.
3. **Rede P2P Real (`p2p_engine.js` & `vps_bootstrap.js`)**:
   - STUN client integrado para descoberta de IP reflexivo/público.
   - Handshake Ed25519 com desafio nonce e autenticação mútua de nós.
   - Mecanismo de Relay com encapsulamento opaco e controle de taxa.
   - Suporte a múltiplos nós de bootstrap via `.env`.
   - Fallback para cache de peers do SQLite quando nenhuma VPS responder.
4. **Segurança de Usuários e Governança**:
   - Sessões temporizadas, fim de credenciais padrão, proteção estrita de endpoints administrativos.
   - Comandos administrativos assinados com Ed25519.
5. **CRDT, Partições e Consenso**:
   - Resolução de split-brain sem escolha cega de cadeia mais longa.
   - Raft-lite com persistência de termo e quorum de maioria.
6. **Web Push VAPID Real**:
   - Emissão de notificações push reais sem vazamento de dados privados.
7. **Painel Visual "Visão da Comunidade"**:
   - Endpoints `/api/network/*`, WebSocket `/live/network` e visualização na interface desktop.
8. **Testes Automatizados & Teste de Rede Real**:
   - Execução de 3+ nós em processos independentes com kill switch de VPS e relay.
