# Comunidade Resiliente 🛡️📡

> **Sistema Descentralizado P2P de Comunidades e Canais de Mensagens Imune a Quedas de Servidor e Censura**

[![Node.js](https://img.shields.io/badge/Node.js-v22%2B-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![P2P: Mesh & WebRTC](https://img.shields.io/badge/P2P-Mesh%20%26%20WebSockets-orange.svg)]()
[![Security: E2EE Ed25519 + AES-256-GCM](https://img.shields.io/badge/Security-Ed25519%20%2B%20AES--256--GCM-red.svg)]()

O **Comunidade Resiliente** é uma plataforma inovadora de comunicação comunitária onde **apenas administradores autorizados possuem a capacidade de publicar comunicados oficiais**, e **todos os membros recebem as mensagens diretamente em seus computadores e celulares**.

O grande diferencial do sistema é sua **arquitetura de sobrevivência radical**: se a VPS ou o servidor central for bloqueado, apreendido ou desligado abruptamente, a rede não cai. Os computadores pessoais dos membros assumem a operação como nós P2P autônomos, elegem dinamicamente um novo líder e continuam sincronizando mensagens de forma direta e ininterrupta.

---

## 📑 Índice
1. [Principais Características](#-principais-características)
2. [Arquitetura do Sistema](#-arquitetura-do-sistema)
3. [Segurança e Criptografia](#-segurança-e-criptografia)
4. [Entregáveis Cumpridos](#-entregáveis-cumpridos)
5. [Início Rápido](#-início-rápido)
6. [Simulação de Queda da VPS](#-simulação-de-queda-da-vps)
7. [Execução em Cluster Local](#-execução-em-cluster-local)
8. [Docker Compose](#-docker-compose)
9. [Suíte de Testes Automatizados](#-suíte-de-testes-automatizados)
10. [Documentação Detalhada](#-documentação-detalhada)

---

## 🚀 Principais Características

- **Topologia Híbrida e Resiliente:** A VPS é apenas um ponto opcional de bootstrap inicial e sinalização STUN. A rede opera 100% de nó para nó.
- **Canal Oficial Unidirecional:** Apenas administradores com chave privada Ed25519 legítima conseguem assinar mensagens. Membros comuns e moderadores têm permissão estrita de leitura e retransmissão P2P.
- **Eleição Autônoma de Líder:** Algoritmo Bully/Raft-lite integrado. Na ausência de sinal da VPS, os nós online elegem o líder da malha em menos de 3 segundos.
- **Armazenamento Seguro em Disco:** Banco de dados SQLite persistente em cada computador pessoal (utilizando a nova API nativa de alto desempenho `node:sqlite`).
- **Criptografia Ponta a Ponta (E2EE):** Conteúdos e anexos são cifrados com AES-256-GCM. Provedores e intermediários de rede não conseguem ler o conteúdo.
- **Rotação de Chaves (Key Rotation):** Quando um membro é expulso, o sistema rotaciona a chave da comunidade gerando uma nova época criptográfica (*Forward Secrecy*).
- **Interface Web/PWA Moderna:** Tema escuro com telemetria em tempo real, indicador de nós online, alerta dinâmico de status da VPS e suporte a instalação como app no celular e desktop.
- **Push Notifications com Privacidade (Zero-Knowledge):** O corpo da mensagem confidencial nunca é enviado em texto claro por servidores de push abertos (Google FCM ou Apple APNs).

---

## 🏛️ Arquitetura do Sistema

```
                      +-----------------------------+
                      |      VPS Bootstrap /        |
                      |      Signaling Relay        |
                      |  (OPCIONAL / TEMPORÁRIO)    |
                      +--------------+--------------+
                                     |
               (Descoberta inicial e STUN/TURN fallback)
                                     |
          +--------------------------+--------------------------+
          |                                                     |
          v                                                     v
+-------------------+                                 +-------------------+
|   Nó Desktop A    |<============== P2P =============>|   Nó Desktop B    |
|   (Administrador) |       (WebRTC / Direct TCP/WS)   |   (Moderador)     |
| - SQLite Cifrado  |                                 | - SQLite Cifrado  |
| - Chave Ed25519   |                                 | - Validador DAG   |
+---------+---------+                                 +---------+---------+
          ^                                                     ^
          |                        P2P                          |
          +=====================================================+
                                   |
                                   v
                         +-------------------+
                         |   Nó Desktop C    |
                         |   (Membro)        |
                         | - SQLite Cifrado  |
                         | - Leitor Cifrado  |
                         +-------------------+
```

Para a especificação técnica detalhada, consulte [`docs/architecture.md`](docs/architecture.md).

---

## 🔒 Segurança e Criptografia

- **Assinaturas Digitais (Ed25519):** Cada bloco de mensagem possui um hash SHA-256 canônico assinado com a chave Ed25519 do autor.
- **Cadeia de Blocos Causal (Signed Hash Chain / Merkle-DAG):** Cada bloco aponta para o `prev_hash` anterior, impedindo que mensagens antigas sejam deletadas ou modificadas sem invalidar todo o histórico.
- **Anti-Replay e Anti-Duplicação:** Cache de nãoces e hashes SHA-256 com verificação de sequência monotônica.
- **Cofre Local (Local Key Vault):** Chaves privadas no disco do computador são cifradas com derivação de senha mestre PBKDF2 com salt aleatório e 100.000 iterações.
- **Auditoria Criptográfica Imutável:** Todos os eventos da rede (eleições, rotação de chaves, revogações, conexões) são gravados em uma cadeia imutável auditável.

---

## 📦 Entregáveis Cumpridos

| # | Entregável Requisitado | Status | Arquivo / Módulo de Referência |
| :--- | :--- | :---: | :--- |
| **1** | Arquitetura completa do sistema | ✅ Concluído | [`docs/architecture.md`](docs/architecture.md) |
| **2** | Código funcional de um MVP | ✅ Concluído | [`src/core/`](src/core/), [`src/node/`](src/node/) |
| **3** | Aplicação desktop como nó P2P | ✅ Concluído | [`src/desktop/desktop_runner.js`](src/desktop/desktop_runner.js) |
| **4** | Interface web/PWA para usuários | ✅ Concluído | [`src/web/index.html`](src/web/index.html), [`src/web/js/app.js`](src/web/js/app.js) |
| **5** | API de autenticação e administração | ✅ Concluído | Endpoints `/api/auth/*` e `/api/admin/*` em [`src/node/p2p_node.js`](src/node/p2p_node.js) |
| **6** | Sincronização de mensagens entre 3 nós | ✅ Concluído | Verificado na simulação e suíte de testes |
| **7** | Simulação de desligamento da VPS | ✅ Concluído | [`scripts/simulate_vps_kill.js`](scripts/simulate_vps_kill.js) |
| **8** | Recuperação automática com nós restantes | ✅ Concluído | Eleição de líder Bully/Raft em [`src/core/consensus.js`](src/core/consensus.js) |
| **9** | Documentação de instalação | ✅ Concluído | [`INSTALLATION.md`](INSTALLATION.md) |
| **10** | Docker Compose para ambiente local | ✅ Concluído | [`docker-compose.yml`](docker-compose.yml) e [`Dockerfile`](Dockerfile) |
| **11** | Testes automatizados (16/16 passando) | ✅ Concluído | [`scripts/run_tests.js`](scripts/run_tests.js) |
| **12** | Documento de limitações e segurança | ✅ Concluído | [`docs/security_and_limitations.md`](docs/security_and_limitations.md) |

---

## 💻 Instalador com 1 Clique (Para Usuários Leigos)

Para que qualquer pessoa instale e use o sistema sem precisar abrir terminal ou ter conhecimento técnico:

### 🪟 Windows:
- **Instalador Executável (.exe):** Execute o instalador [`dist/ComunidadeResiliente-Setup-v1.0.exe`](dist/ComunidadeResiliente-Setup-v1.0.exe) com assistente gráfico completo e ícone na Área de Trabalho.
- **Instalação via Script (.bat):** Ou dê um duplo-clique no arquivo `INSTALAR-WINDOWS.bat` na raiz do projeto.
- **Compilação de Novos Executáveis:** Para compilar o executável e o instalador novamente, execute `npm run build:exe`.
- O instalador configura a aplicação em `%LocalAppData%\ComunidadeResiliente`, cria o atalho **"Comunidade Resiliente"** na Área de Trabalho e no Menu Iniciar, e abre a interface no navegador automaticamente!
- Para desinstalar, basta clicar no atalho *"Desinstalar Comunidade Resiliente"* no Menu Iniciar.

### 🐧 Linux / 🍎 macOS:
- Execute `./install.sh` para instalar localmente e criar os atalhos de aplicativo.

---

## ⚡ Início Rápido (Desenvolvedores)

### Instalação das Dependências:
```bash
npm install
```

### Executar a Suíte de Testes Automatizados (16 testes unitários e de integração):
```bash
npm test
```

---

## 💥 Simulação de Queda da VPS

Para testar a sobrevivência P2P automatizada:
```bash
npm run simulate:kill
```
O script executa em sequência:
1. Inicia a VPS Bootstrap na porta `4001` e 3 nós P2P (Alice Admin, Bob Moderador, Carlos Membro).
2. Alice publica o Comunicado #1 enquanto a VPS está ativa.
3. **Desliga abruptamente a VPS central.**
4. Os 3 nós detectam a queda e elegem Alice como novo líder autônomo.
5. Alice publica o Comunicado #2 de emergência com a VPS **totalmente morta**.
6. Bob e Carlos recebem e decifram a mensagem 100% através da malha P2P direta.
7. Valida rejeição estrita de mensagens falsificadas de não-administradores.
8. Executa e valida a rotação de chaves comunitárias.

---

## 👥 Execução em Cluster Local

Para subir o cluster completo com interface gráfica em seu navegador:
```bash
npm run cluster
```
URLs disponíveis:
- **VPS Bootstrap:** `http://localhost:4001/status` (WS: `ws://127.0.0.1:4001`)
- **Nó 1 (Alice - Administradora):** `http://localhost:5001` *(possui permissão de publicação)*
- **Nó 2 (Bob - Moderador):** `http://localhost:5002` *(somente leitura / moderação)*
- **Nó 3 (Carlos - Membro):** `http://localhost:5003` *(somente leitura e relay)*

---

## 🐳 Docker Compose

Para rodar todo o ecossistema em contêineres Docker isolados:
```bash
docker compose up --build
```
Para encerrar a VPS simulando a queda via Docker:
```bash
docker compose stop vps-bootstrap
```
Os nós Alice, Bob e Carlos continuarão conectados na rede bridge Docker trocando mensagens normalmente.

---

## 📚 Documentação Detalhada

- 📘 [Manual do Usuário e Instalação](INSTALLATION.md)
- 📐 [Especificação Completa da Arquitetura](docs/architecture.md)
- 🛡️ [Segurança, Modelo de Ameaças e Limitações](docs/security_and_limitations.md)

---

## ⚖️ Licença
Distribuído sob a licença **MIT**. Veja `LICENSE` para mais detalhes.
