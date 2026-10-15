# Comunidade Resiliente 🛡️📡

> **Sistema P2P Descentralizado de Comunidades e Canais Oficiais com Resiliência a Quedas de Servidor**
> **Domínio Oficial em Produção:** [https://cp2p.democracias.org](https://cp2p.democracias.org)

[![Node.js](https://img.shields.io/badge/Node.js-v22.5%2B-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![P2P: Mesh & WebSockets](https://img.shields.io/badge/P2P-Mesh%20%26%20RFC%205389%20STUN-orange.svg)]()
[![Security: Ed25519 + AES-256-GCM](https://img.shields.io/badge/Security-Ed25519%20%2B%20AES--256--GCM-red.svg)]()
[![Tests: 75/75 Passing](https://img.shields.io/badge/Tests-75%2F75%20Passed-brightgreen.svg)]()
[![Domain: cp2p.democracias.org](https://img.shields.io/badge/Domain-cp2p.democracias.org-blue.svg)](https://cp2p.democracias.org)

O **Comunidade Resiliente** é uma plataforma inovadora de comunicação comunitária onde **apenas administradores autorizados possuem a capacidade criptográfica de assinar e publicar comunicados oficiais**, e **todos os membros recebem as mensagens diretamente em seus computadores e celulares**.

O grande diferencial do sistema é sua **arquitetura de sobrevivência radical**: se a VPS ou o servidor central for bloqueado, apreendido ou desligado abruptamente, a rede não cai. Os computadores pessoais dos membros assumem a operação como nós P2P autônomos, recuperam a lista de pares conhecida no banco local SQLite, elegem dinamicamente um novo líder e continuam sincronizando mensagens de forma direta e ininterrupta.

---

## 📑 Índice
1. [Principais Características](#-principais-características)
2. [Painel Visual "Visão da Comunidade"](#-painel-visual-visão-da-comunidade)
3. [Arquitetura do Sistema](#-arquitetura-do-sistema)
4. [Segurança e Criptografia](#-segurança-e-criptografia)
5. [Início Rápido com 1 Clique](#-início-rápido-com-1-clique-usuários-leigos)
6. [Simulação de Queda da VPS](#-simulação-de-queda-da-vps)
7. [Execução em Cluster Local](#-execução-em-cluster-local)
8. [Docker Compose com Multi-Bootstrap](#-docker-compose-com-multi-bootstrap)
9. [Suíte de Testes Automatizados](#-suíte-de-testes-automatizados)
10. [Documentação Detalhada](#-documentação-detalhada)

---

## 🚀 Principais Características

- **Topologia Híbrida e Resiliente:** A VPS atua apenas como ponto de bootstrap inicial e relay transparente opcional. A rede opera com conexões diretas P2P entre computadores pessoais.
- **Canal Oficial Unidirecional:** Apenas administradores com chave privada Ed25519 legítima conseguem assinar mensagens. Membros comuns e moderadores têm permissão estrita de leitura e retransmissão P2P.
- **Resolução de NAT STUN RFC 5389:** Cliente puro em JavaScript de descoberta de IP reflexivo (UDP) para travessia de roteadores domésticos.
- **Multi-Bootstrap e Fallback Autônomo:** Suporte a múltiplos servidores de semente configuráveis via `.env` (`BOOTSTRAP_NODES`). Se todas as VPSs caírem, os nós recorrem automaticamente à tabela de pares salva no SQLite local.
- **Eleição Autônoma de Líder (Raft-lite):** Algoritmo de consenso com persistência de termo no SQLite, voto único, variação estocástica (jitter) de 4000 a 6500ms e quórum estrito da maioria (`Math.floor(n/2) + 1`).
- **Reconciliação CRDT de Split-Brain:** Resolução determinística de divergências de sequência caso a rede se divida, garantindo convergência idêntica em todos os nós sem perda de integridade.
- **Armazenamento Seguro SQLite com WAL:** Banco de dados persistente em cada máquina pessoal utilizando `node:sqlite` nativo com migrações versionadas e cofre de chaves cifrado com PBKDF2 e salt aleatório.
- **Criptografia Autenticada (AES-256-GCM):** Conteúdos e anexos cifrados com chave comunitária por época. Provedores e intermediários enxergam apenas ciphertext ilegível.
- **Web Push VAPID Zero-Knowledge:** Notificações para navegadores e celulares sem enviar o conteúdo confidencial da mensagem por provedores de nuvem abertos.
- **Painel Visual "Visão da Comunidade":** Monitoramento em tempo real do estado da rede, participantes, topologia interativa e métricas técnicas sem expor dados privados.

---

## 📊 Painel Visual "Visão da Comunidade"

A aplicação conta com um painel integrado de observabilidade da rede, acessível no cabeçalho pelo botão **"🌐 Visão da Rede"**:

- **14 Cartões de Métricas:** Nós online, nós conhecidos, celulares, páginas web, membros, administradores, moderadores, mensagens sincronizadas, estado da VPS, estado P2P, líder atual, última sincronização e conexões diretas vs relay;
- **10 Indicadores de Estado:** Diagnóstico em tempo real de STUN, Relay, Consenso, Quórum, Sincronização e Erros;
- **Mapa da Rede Interativo (SVG):** Topologia visual com código de cores (Verde: Direto, Azul: Relay, Cinza: Offline, Vermelho: Erro);
- **Lista de Participantes com Privacidade RBAC:** Membros comuns visualizam apenas dados agregados e seu próprio perfil; administradores visualizam informações operacionais completas;
- **Diferenciação Estrita de Entidades:** Não confunde Usuário, Dispositivo, Sessão e Nó P2P;
- **Atualização em Tempo Real:** Conexão contínua via WebSocket `/live/network` atualizando métricas e linha do tempo de eventos técnicos.

Para a especificação completa de privacidade e cálculo dos indicadores, consulte [`docs/network_dashboard.md`](docs/network_dashboard.md).

---

## 🏛️ Arquitetura do Sistema

```
                      +----------------------------------------+
                      |   VPS Bootstrap 1 & 2 (Multi-Seed)     |
                      |   - STUN Reflexivo (RFC 5389 / WS)     |
                      |   - Relay Transparente (Rate-Limited)  |
                      |   (OPCIONAL / DISPENSÁVEL APÓS PEERING)|
                      +-------------------+--------------------+
                                          |
                        [Descoberta Inicial & STUN / Relay]
                                          |
              +---------------------------+---------------------------+
              |                                                       |
              v                                                       v
    +-------------------+                                   +-------------------+
    |   Nó Desktop A    |<============= P2P Mesh ===========>|   Nó Desktop B    |
    |   (Administrador) |     (Direct TCP / WebSocket Mesh) |   (Moderador)     |
    | - SQLite WAL      |                                   | - SQLite WAL      |
    | - Chave Ed25519   |                                   | - Validador CRDT  |
    | - Painel Visão    |                                   | - Painel Visão    |
    +---------+---------+                                   +---------+---------+
              ^                                                       ^
              |                        P2P                            |
              +=======================================================+
                                       |
                                       v
                             +-------------------+
                             |   Nó Desktop C    |
                             |   (Membro Comum)  |
                             | - SQLite WAL      |
                             | - Replicador Mesh |
                             +---------+---------+
```

Para a especificação técnica detalhada, consulte [`docs/architecture.md`](docs/architecture.md).

---

## 🔒 Segurança e Criptografia

- **Assinaturas Digitais (Ed25519):** Cada bloco possui hash SHA-256 canônico assinado com a chave do autor.
- **Cadeia de Blocos Causal (Signed Hash-Chain / Merkle-DAG):** Cada bloco aponta para `prev_hash`, impedindo exclusão ou modificação retroativa.
- **Autenticação Mútua de Nós:** Handshake challenge-response com nonces aleatórios assinados.
- **Proteção contra Força Bruta:** Bloqueio temporário (15 minutos) após 5 tentativas de senha incorretas.
- **Sessões Criptográficas:** Tokens aleatórios seguros de 32 bytes gerados via CSPRNG com expiração e endpoint de logout.
- **Cofre Local Criptografado:** Chaves privadas protegidas por derivação PBKDF2 com salt aleatório e 100.000 iterações.
- **Auditoria Criptográfica:** Todos os eventos da rede (eleições, rotação de chaves, revogações, conexões) são gravados em cadeia auditável imutável.

---

## 💻 Início Rápido com 1 Clique (Usuários Leigos)

### 🪟 No Windows:
- Dê um **duplo-clique no arquivo `INSTALAR-WINDOWS.bat`** na raiz da pasta.
- O instalador configura a aplicação em `%LocalAppData%\ComunidadeResiliente`, cria os atalhos na Área de Trabalho e Menu Iniciar, e abre o navegador automaticamente!

### 🐧 No Linux / 🍎 macOS:
- Execute `./install.sh` no terminal para criar os inicializadores no sistema.

---

## ⚡ Início Rápido (Desenvolvedores)

```bash
# Instalar dependências
npm install

# Copiar arquivo de variáveis de ambiente
cp .env.example .env

# Executar suíte de testes automatizados (27 testes)
npm test
```

---

## 💥 Simulação de Queda da VPS

Para testar a sobrevivência P2P automatizada com múltiplos processos e portas isoladas:
```bash
npm run simulate:kill
```
O script executa em sequência:
1. Inicia a VPS Bootstrap na porta `4901` e 3 nós P2P (Alice Admin, Bob Moderador, Carlos Membro);
2. Alice publica o Comunicado #1 enquanto a VPS está ativa;
3. **A VPS central é abruptamente encerrada e desligada;**
4. Os 3 nós detectam a queda e recuperam a lista de pares pelo cache local SQLite;
5. Elegem autonomamente o líder do termo Raft-lite;
6. Alice publica o Comunicado #2 de emergência com a VPS **completamente desligada**;
7. Bob e Carlos recebem e decifram a mensagem 100% através da malha direta P2P;
8. Valida rejeição estrita de mensagens forjadas de não-administradores e rotação de chaves.

---

## 👥 Execução em Cluster Local

Para subir o cluster completo com interface gráfica em seu navegador:
```bash
npm run cluster
```
URLs disponíveis:
- **VPS Bootstrap:** `http://localhost:4001/status` (WS: `ws://127.0.0.1:4001`)
- **Nó 1 (Alice - Administradora):** `http://localhost:5001` *(publicação autorizada)*
- **Nó 2 (Bob - Moderador):** `http://localhost:5002` *(somente leitura e moderação)*
- **Nó 3 (Carlos - Membro):** `http://localhost:5003` *(somente leitura e replicação)*

---

## 🐳 Docker Compose com Multi-Bootstrap

Para subir o ambiente completo em contêineres Docker isolados com alta disponibilidade:
```bash
docker compose up --build
```
O ecossistema inicializa duas instâncias redundantes de bootstrap (`vps-bootstrap-1` na 4001 e `vps-bootstrap-2` na 4002) e 3 nós desktop com volumes persistentes.

Para simular a queda de todas as VPSs via Docker:
```bash
docker compose stop vps-bootstrap-1 vps-bootstrap-2
```
Os nós continuarão trocando mensagens através da rede P2P sem qualquer interrupção.

---

## 🧪 Suíte de Testes Automatizados

A suíte cobre 15 módulos com 75 testes unitários e de integração (100% aprovados):
- **Módulo 1:** Primitivas criptográficas (Ed25519, AES-256-GCM, PBKDF2 e cofre local);
- **Módulo 2:** Armazenamento SQLite com migrações versionadas, modo WAL e sessões;
- **Módulo 3:** Cadeia causal de mensagens, rejeição de não-admins e reconciliação CRDT de split-brain;
- **Módulo 4:** Consenso Raft-lite com termo persistente e quórum estrito de maioria;
- **Módulo 5:** Notificações Web Push com garantia Zero-Knowledge, tipos de notificação e silenciamento de canais;
- **Módulo 6:** Resolução de NAT e cliente STUN RFC 5389;
- **Módulo 7:** Autenticação mútua challenge-response entre nós P2P;
- **Módulo 8:** Proteção contra força bruta e bloqueio de conta (lockout);
- **Módulo 9:** Painel "Visão da Comunidade", anonimização e eventos técnicos;
- **Módulo 10:** Domínio oficial (`cp2p.democracias.org`), redirecionamento HTTPS, CORS restrito, cookies seguros e proxy reverso;
- **Módulo 11:** Canais múltiplos (`#avisos`, `#eventos`, `#documentos`, `#conversas`, `#suporte`), mensagens enriquecidas, reações, fixação e soft delete;
- **Módulo 12:** Pré-visualização segura de links (SSRF-Safe), fragmentação Merkle (512KB Chunks) e encaminhamento com proveniência;
- **Módulo 13:** Convites amigáveis (`CR-XXXX`), geração autônoma de QR Codes vetoriais em SVG e solicitações de entrada (Join Requests);
- **Módulo 14:** Resiliência offline, fila Outbox pendente com sincronização automática (`flushOutbox`) e protocolo P2P wire de chunks (`CHUNK_REQUEST`/`CHUNK_RESPONSE`);
- **Módulo 15:** Cadastro simples e pseudônimo (sem dados pessoais, sem senha obrigatória), unicidade case-insensitive com sugestões inteligentes, chave privada protegida localmente, código de recuperação (`REC-XXXX`), pareamento seguro de novos dispositivos (`PAIR-XXXX` e QR Code) e rate limiting anti-abuso.

Para rodar a suíte completa:
```bash
npm test
```

Para rodar a simulação real de queda da VPS:
```bash
npm run simulate
```

---

## 📚 Documentação Detalhada

- 📖 **[Manual Completo de Uso e Administração](docs/MANUAL_DO_USUARIO_E_ADMINISTRADOR.md)** *(Guia para usuários leigos, canais, anexos, offline, QR codes e administração)*
- 📘 [Manual de Instalação e Operação](INSTALLATION.md)
- 🚀 [Guia de Implantação em Produção (cp2p.democracias.org)](docs/production_deployment.md)
- 📊 [Documentação do Painel "Visão da Comunidade"](docs/network_dashboard.md)
- 📐 [Especificação Completa da Arquitetura](docs/architecture.md)
- 🛡️ [Segurança, Modelo de Ameaças e Limitações](docs/security_and_limitations.md)

---

## ⚖️ Licença
Distribuído sob a licença **MIT**. Veja `LICENSE` para mais detalhes.
