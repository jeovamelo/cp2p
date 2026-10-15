# Manual de Instalação e Operação: Comunidade Resiliente 🛠️📖

> **Guia Completo para Usuários, Operadores de Nós e Desenvolvedores**

Bem-vindo ao **Comunidade Resiliente**, uma plataforma descentralizada P2P de comunicação comunitária desenhada para manter a conectividade e a integridade de canais de mensagens mesmo diante da indisponibilidade ou bloqueio de servidores centrais e VPSs.

---

## 1. Requisitos de Sistema

- **Sistema Operacional:** Windows 10/11, macOS 12+ (Intel ou Apple Silicon) ou Linux (Ubuntu 20.04+, Debian 11+, Fedora, Arch).
- **Ambiente de Execução:** Node.js v22.5.0 ou superior (inclui motor nativo `node:sqlite`).
- **Navegador Web:** Google Chrome, Brave, Microsoft Edge, Firefox ou Safari (com suporte a PWA e WebSockets).
- **Opcional:** Docker Engine v24+ e Docker Compose v2.20+ (para implantação conteinerizada).

---

## 2. Instalação em 1 Clique (Para Usuários Finais / Sem Terminal)

Para disponibilizar o nó desktop a membros da comunidade sem exigir familiaridade com linha de comando:

### 🪟 No Windows:
1. Extraia os arquivos da comunidade em uma pasta do seu computador.
2. Dê um **duplo-clique no arquivo `INSTALAR-WINDOWS.bat`** na raiz da pasta.
3. O script configura o ambiente automaticamente:
   - Instala a aplicação em `%LocalAppData%\ComunidadeResiliente`;
   - Cria o atalho executável **"Comunidade Resiliente"** na **Área de Trabalho**;
   - Registra o atalho no **Menu Iniciar** do Windows;
   - Cria o script de desinstalação automática;
   - Inicializa o nó em segundo plano e abre a interface no seu navegador padrão.

### 🐧 No Linux ou 🍎 macOS:
Abra o terminal na pasta do projeto e execute:
```bash
chmod +x install.sh
./install.sh
```
O atalho `.desktop` ou inicializador do sistema será registrado no seu menu de aplicativos.

---

## 3. Configuração de Variáveis de Ambiente (`.env`)

Copie o arquivo de exemplo para criar seu arquivo de configuração local:
```bash
cp .env.example .env
```

### Principais Parâmetros Configuráveis:
| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Ambiente de execução (`development` ou `production`) |
| `HTTP_PORT` | `5001` | Porta do servidor web local / dashboard |
| `P2P_PORT` | `6001` | Porta TCP/WebSocket para conexões diretas entre nós |
| `BOOTSTRAP_NODES` | `ws://127.0.0.1:4001,ws://127.0.0.1:4002` | Lista de servidores de bootstrap separados por vírgula |
| `STUN_SERVERS` | `stun.l.google.com:19302,stun.cloudflare.com:3478` | Servidores STUN UDP RFC 5389 para IP reflexivo |
| `DB_PATH` | `./data/community.db` | Caminho do arquivo SQLite com modo WAL |
| `ROLE` | `Membro` | Papel do usuário local (`Administrador`, `Moderador`, `Membro`) |
| `RELAY_ENABLED` | `true` | Ativa encaminhamento transparente como nó relay |
| `RELAY_RATE_LIMIT` | `60` | Limite máximo de pacotes por segundo encaminhados |

---

## 4. Modos de Execução para Desenvolvedores e Administradores

### 4.1. Instalação das Dependências:
```bash
npm install
```

### 4.2. Executar a Suíte de Testes Automatizados (27 Testes):
```bash
npm test
```
Verifica a integridade criptográfica (Ed25519, AES-GCM, PBKDF2), migrações SQLite, reconciliação CRDT de split-brain, consenso Raft-lite, Web Push VAPID e privacidade do painel visual.

---

### 4.3. Simulação Automatizada de Queda da VPS:
```bash
npm run simulate:kill
```
Demonstra a resiliência em tempo real:
1. Inicia uma VPS de bootstrap e 3 nós em portas isoladas (Alice Admin, Bob Moderador, Carlos Membro);
2. Alice publica o Comunicado #1 enquanto a VPS está ativa;
3. **A VPS central é abruptamente encerrada e desligada;**
4. Os 3 nós detectam a queda e recuperam a lista de pares pelo cache local SQLite;
5. Elegem autonomamente a nova liderança do termo Raft-lite;
6. Alice publica o Comunicado #2 de emergência com a VPS **completamente desligada**;
7. Todos os nós recebem e decifram a mensagem via malha direta P2P;
8. Valida a rejeição estrita de mensagens forjadas por não-administradores e rotação de chave.

---

### 4.4. Execução em Cluster Local de Demonstração:
```bash
npm run cluster
```
Inicia o ambiente completo com interface gráfica:
- **VPS Bootstrap 1:** `http://localhost:4001/status` (WS: `ws://127.0.0.1:4001`)
- **Nó Alice (Administradora):** `http://localhost:5001` *(publicação autorizada)*
- **Nó Bob (Moderador):** `http://localhost:5002` *(somente leitura e moderação)*
- **Nó Carlos (Membro):** `http://localhost:5003` *(somente leitura e replicação)*

---

### 4.5. Execução Conteinerizada via Docker Compose (Multi-Bootstrap):
```bash
docker compose up --build
```
O arquivo [`docker-compose.yml`](docker-compose.yml) inicializa:
- Duas instâncias de VPS Bootstrap redundantes (`vps-bootstrap-1` na 4001 e `vps-bootstrap-2` na 4002);
- 3 nós desktop com volumes de dados persistentes (`alice_data`, `bob_data`, `carlos_data`), healthchecks e limites de recursos (0.5 CPU, 256MB RAM).

Para simular a queda total dos servidores na nuvem:
```bash
docker compose stop vps-bootstrap-1 vps-bootstrap-2
```
Os nós continuarão trocando mensagens através da rede bridge P2P sem qualquer interrupção.

---

### 4.6. Implantação em Produção no Domínio Oficial (https://cp2p.democracias.org):
Para colocar a rede no ar no domínio oficial com TLS automático via Caddy e portas 80/443:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
Para o passo a passo completo de DNS, liberação de firewall e verificação, consulte o [Guia de Implantação em Produção](docs/production_deployment.md).

---

## 5. Como Abrir e Operar o Painel "Visão da Comunidade"

1. Acesse qualquer nó ativo no seu navegador (ex: `http://localhost:5001` ou `https://cp2p.democracias.org`).
2. No cabeçalho da aplicação, clique no botão **"🌐 Visão da Rede"** (`#btn-open-network-dashboard`).
3. O painel interativo exibirá:
   - **Visão Geral:** 14 cartões de indicadores com contagem de nós, celulares, membros e status de consenso;
   - **Mapa da Rede:** Gráfico topológico vetorial SVG com código de cores (Verde: Direto, Azul: Relay, Cinza: Offline);
   - **Tabela de Membros:** Lista com papéis e status, respeitando as permissões do usuário logado;
   - **Nós P2P:** Lista de computadores participantes, protocolo, latência e método de conexão;
   - **Dispositivos:** Sessões ativas de Desktop, Celular e Web;
   - **Linha do Tempo:** Registro de eventos técnicos em tempo real via WebSocket `/live/network`.

Para mais detalhes sobre as regras de anonimização e cálculo dos indicadores, consulte [`docs/network_dashboard.md`](docs/network_dashboard.md).
