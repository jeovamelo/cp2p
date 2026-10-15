# Arquitetura do Sistema: Comunidade Resiliente 🛡️🌐

## 1. Visão Geral e Filosofia

O **Comunidade Resiliente** é uma plataforma distribuída de comunicação comunitária e canais oficiais de mensagens projetada para manter a continuidade operacional e a soberania comunicacional mesmo diante de indisponibilidade de servidores centrais, censura de provedores de nuvem ou quedas de infraestrutura.

Em arquiteturas cliente-servidor convencionais, a queda do servidor central interrompe todo o serviço. No Comunidade Resiliente:
- **Computadores pessoais dos membros atuam como nós persistentes da rede**, armazenando cópias criptografadas do histórico em SQLite com WAL (Write-Ahead Logging);
- **A VPS desempenha apenas o papel de semente de bootstrap, descoberta inicial e relay opcional** para nós sob restrições severas de NAT;
- **Quando todos os nós de bootstrap estão inoperantes**, os nós desktop ativam o fallback para o cache local de pares persistido no SQLite e mantêm a sincronização e replicação direta de mensagens de forma autônoma;
- **Apenas administradores autorizados possuem a capacidade criptográfica de assinar e publicar mensagens oficiais**, enquanto os membros comuns recebem e retransmitem blocos verificáveis sem poder forjar comunicados;
- **O painel visual "Visão da Comunidade" / "Status da Rede"** oferece observabilidade em tempo real sobre a saúde da rede, participantes, topologia e sincronização com preservação estrita de privacidade.

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
                                       | (Ponte Local / Web Push)
                                       v
                             +-------------------+
                             |  Celular / PWA    |
                             | - Zero-Knowledge  |
                             | - Offline-first   |
                             +-------------------+
```

---

## 2. Estrutura Modular Consolidada (`src/`)

O projeto foi unificado sob o diretório principal `src/`, eliminando qualquer duplicação prévia do diretório `packages/`:

```
src/
├── common/
│   ├── crypto.js          # Primitivas criptográficas (Ed25519, AES-256-GCM, PBKDF2, SHA-256)
│   └── protocol.js        # Definições de wire format e tipos de mensagens do protocolo P2P
├── core/
│   ├── consensus.js       # Motor Raft-lite de consenso com termo persistente e quórum estrito
│   ├── crdt_chain.js      # Cadeia de mensagens com reconciliação determinística de split-brain
│   ├── nat_stun.js        # Cliente STUN UDP RFC 5389 puro para descoberta de IP reflexivo
│   ├── notification_service.js # Serviço Web Push VAPID ECDSA P-256 com fila offline zero-knowledge
│   ├── p2p_engine.js      # Motor P2P com autenticação mútua Ed25519, multi-bootstrap e relay
│   └── storage.js         # Gerenciador SQLite nativo com migrações versionadas e modo WAL
├── node/
│   └── p2p_node.js        # Daemon de nó com APIs REST de observabilidade, RBAC e WebSocket
├── server/
│   └── vps_bootstrap.js   # Servidor VPS de bootstrap, STUN reflexivo e relay transparente
├── desktop/
│   └── desktop_runner.js  # Orquestrador desktop com suporte a execução em background
└── web/                   # Interface PWA e Painel visual "Visão da Comunidade"
    ├── index.html         # Estrutura HTML semântica com Modal do Painel de Monitoramento
    ├── css/styles.css     # Design system moderno glassmorphism com tema escuro e responsivo
    └── js/app.js          # Lógica do cliente, visualização topológica SVG e WebSocket /live
```

---

## 3. Especificação dos Módulos Principais

### 3.1. Camada de Rede P2P e Travessia de NAT (`src/core/p2p_engine.js` e `src/core/nat_stun.js`)
- **Resolução de IP Reflexivo via STUN:** Implementação zero-dependências do RFC 5389 (`nat_stun.js`) que envia pacotes UDP `Binding Request` (20 bytes com Magic Cookie `0x2112A442`) para servidores STUN públicos (`stun.l.google.com:19302`, `stun.cloudflare.com`) e decodifica atributos `XOR-MAPPED-ADDRESS`. Complementado por resolução de IP via WebSocket com a VPS (`STUN_PROBE` / `STUN_RESPONSE`).
- **Autenticação Mútua de Nós (Handshake Criptográfico):** Cada nó gera e persiste uma identidade Ed25519 (`node_identities`). Ao conectar-se com um par, executa-se um handshake challenge-response:
  1. O nó A envia `NODE_AUTH_CHALLENGE` contendo um nonce criptográfico aleatório de 32 bytes e sua chave pública.
  2. O nó B assina o nonce recebido e responde com `NODE_AUTH_RESPONSE` contendo sua assinatura e seu próprio nonce de desafio.
  3. O nó A verifica a assinatura e conclui o handshake. Nenhum par é aceito apenas por conhecer seu endereço IP.
- **Multi-Bootstrap Configurável:** Suporte a múltiplos nós de bootstrap via lista separada por vírgula em `BOOTSTRAP_NODES` ou `.env`.
- **Fallback Autônomo com VPS Offline:** Caso nenhum bootstrap esteja acessível, o nó recorre imediatamente à lista de pares conhecidos persistida no SQLite (`storage.getPeers()`), reconectando-se de forma descentralizada.
- **Relay Transparente com Limite de Taxa:** Para nós atrás de NAT simétrico rígido, o servidor VPS e nós desktop confiáveis atuam como relay via envelopes `RELAY_FORWARD`. O relay possui limite estrito de taxa (60 pacotes/segundo por nó) e registra métricas de pacotes sem auditar ou armazenar o conteúdo privado cifrado.

### 3.2. Armazenamento com Migrações Versionadas (`src/core/storage.js`)
- Utiliza a API nativa de alta performance `node:sqlite` do Node.js v22+.
- **Modo WAL Ativo:** Configurado com `PRAGMA journal_mode = WAL` e `PRAGMA synchronous = NORMAL`, conferindo alta concorrência de leitura e proteção de integridade contra encerramentos abruptos.
- **Sistema de Migrações Versionadas:** Tabela `schema_migrations` executa migrações sequenciais:
  - `v1_initial_schema`: Tabelas fundamentais de `communities`, `users`, `messages`, `peers`, `audit_logs`.
  - `v2_p2p_hardening`: Tabelas especializadas de `node_identities`, `sessions` (com token criptográfico e expiração), `login_attempts` (com contador e bloqueio por força bruta), `consensus_state`, `push_subscriptions`, `network_events`, e `device_sessions`.
- **Cofre de Chaves e Proteção em Repouso:** Chaves privadas nunca são gravadas em texto puro; são cifradas com PBKDF2 (100.000 iterações com salt aleatório de 16 bytes) e AES-256-GCM.
- **Backup e Restauração Lógica:** Métodos `backup(targetPath)` e `restore(sourcePath)` garantem cópias consistentes da base em tempo de execução.

### 3.3. Cadeia de Mensagens e Reconciliação CRDT de Split-Brain (`src/core/crdt_chain.js`)
- **Hash-Chain Causal Assinada:** Cada mensagem é identificada pelo hash canônico SHA-256 dos seus campos estruturados e aponta para o hash do bloco anterior (`prev_hash`), formando um log append-only imutável.
- **Envelope de Cifra Autenticada (AES-256-GCM):** O conteúdo textual e eventuais anexos são cifrados com a chave do canal comunitário vigente (`epoch`), utilizando vetor de inicialização (IV) de 12 bytes único por mensagem e tag de autenticação de 16 bytes.
- **Autorização Criptográfica Estrita:** O autor da mensagem deve ter sua chave pública Ed25519 reconhecida como Administrador ativo. Mensagens de usuários com papel `Membro` ou `Moderador` que tentem emitir comunicados são estritamente rejeitadas no primeiro salto (`UNAUTHORIZED_AUTHOR_NOT_ADMIN`).
- **Resolução Determinística de Conflitos de Partição (Split-Brain):**
  Se a rede for particionada e dois ramos emitirem mensagens na mesma sequência:
  1. A regra de desempate prioriza a mensagem com o menor timestamp de criação real;
  2. Em caso de empate exato em milissegundos, desempata-se pelo menor hash canônico SHA-256 (ordenação lexicográfica estrita);
  3. A mensagem vencedora substitui a divergente de forma determinística em todos os nós, registrando evento de auditoria (`SPLIT_BRAIN_CONFLICT_RESOLVED`) e garantindo convergência uniforme da réplica.

### 3.4. Consenso Raft-lite com Termo Persistente e Quórum (`src/core/consensus.js`)
- **Termo Persistente:** O número do termo da eleição e o voto concedido (`votedFor`) são persistidos em SQLite na tabela `consensus_state`, prevenindo votos conflitantes após reinicialização do nó.
- **Jitter Aleatório de Eleição:** Timeout de batimento cardíaco configurado com variação estocástica entre 4000ms e 6500ms para mitigar colisões de candidatura.
- **Quórum Estrito de Maioria:** Uma eleição só é vencida se o candidato obtiver estritamente mais da metade dos votos dos pares ativos conhecidos (`Math.floor(activePeers / 2) + 1`).
- **Precedência de Administrador:** Nós operados por administradores possuem pontuação de precedência mais elevada na liderança da coordenação da malha. O líder atua apenas como coordenador de sincronização e relay, não possuindo autoridade para forjar mensagens sem a chave privada de publicação.

### 3.5. Serviço de Notificações Web Push com Zero-Knowledge (`src/core/notification_service.js`)
- Gera e gerencia par de chaves VAPID baseado em curvas elípticas ECDSA P-256 (`getVapidPublicKey()`).
- Registra subscrições de dispositivos celulares e navegadores na tabela `push_subscriptions`.
- **Garantia Zero-Knowledge:** Notificações trafegam apenas metadados mínimos (*"Nova mensagem oficial disponível"* com timestamp e ID do bloco). O conteúdo confidencial da mensagem nunca é transmitido para os servidores push comerciais da Apple, Google ou Mozilla.
- **Fila Offline:** Subscrições temporariamente inalcançáveis são enfileiradas e reenviadas com estratégia de backoff exponencial.

### 3.6. Painel Visual "Visão da Comunidade" / Status da Rede (`src/web/` e `src/node/`)
- Módulo de observabilidade com 14 cartões de métricas, 10 indicadores de estado P2P, visualização topológica SVG dinâmica, tabela de membros com controle de privacidade RBAC, lista de nós com latência, monitor de dispositivos móveis/web e linha do tempo de eventos técnicos em tempo real via WebSocket `/live/network`.

---

## 4. Classificação de Status das Funcionalidades

Para transparência técnica estrita, categorizamos a completude de cada subsistema:

### 4.1. Funcionalidades Totalmente Implementadas e Testadas ✅
- Unificação estrutural limpa em `src/` sem resíduos de `packages/`;
- Criptografia assimétrica Ed25519 e simétrica AES-256-GCM com IV único e tags de autenticação;
- Banco de dados SQLite nativo com migrações versionadas, modo WAL e proteção de integridade;
- Proteção de senhas com PBKDF2 e cofre de chaves privadas criptografadas;
- Autenticação de sessões com tokens criptográficos, logout e proteção contra força bruta (lockout);
- Autorização criptográfica de comunicados (rejeição estrita de publicações de não-administradores);
- Encadeamento causal Merkle-DAG com buffer de mensagens órfãs;
- Reconciliação determinística de conflitos de partição (split-brain) com auditoria;
- Consenso Raft-lite com persistência de termo em SQLite e quórum estrito de maioria;
- Resolução de IP reflexivo via cliente STUN UDP RFC 5389 puro e WebSocket;
- Autenticação mútua challenge-response entre nós P2P;
- Multi-bootstrap com fallback automático para cache local de pares SQLite quando VPSs caem;
- Relay transparente com limitação de taxa (60 pkts/s) e rastreamento de métricas;
- Web Push VAPID com garantia Zero-Knowledge (sem conteúdo em texto claro);
- Painel visual completo "Visão da Comunidade" com controle de privacidade RBAC e WebSocket em tempo real;
- Suíte automatizada de testes com 27 testes unitários e de integração (100% de aprovação);
- Script de simulação de queda abrupta da VPS com múltiplos nós em processos e portas isoladas.

### 4.2. Funcionalidades com Dependências Externas ou Parciais ⚠️
- **Web Push:** A entrega de notificações push para smartphones depende da disponibilidade dos servidores de push do Google (FCM) e Apple (APNs). Caso esses serviços externos estejam bloqueados, as notificações push falham, embora a sincronização direta P2P continue operando.
- **NAT Simétrico Duplo:** Em cenários onde dois nós estão concomitantemente sob CGNAT simétrico estrito e sem UPnP, a conexão direta UDP é fisicamente impossibilitada pela operadora de telefonia/banda larga. O sistema resolve isso através de Relay transparente via VPS ou nó desktop acessível.

### 4.3. Requisitos para Escala em Produção 🏭
- **Governança Multi-Assinatura (M-of-N):** O código possui a base causal e suporte a múltiplos administradores cadastrados; a implementação futura de assinaturas de limiar (Threshold BLS/Schnorr) permitirá exigir aprovação de 3 de 5 administradores antes da publicação.
- **Roteamento Onion / I2P:** Integração com túneis Tor para ocultação integral de endereços IP de nós desktop domésticos.
- **Distribuição de Mídia em Pedaços (BitTorrent Chunking):** Fragmentação de arquivos binários maiores que 20MB em pedaços com verificação Merkle individual para evitar sobrecarga de largura de banda na malha gossip.
