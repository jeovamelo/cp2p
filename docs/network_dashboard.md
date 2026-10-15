# Painel Visual "Visão da Comunidade" / Status da Rede 📊🌐

> **Guia Técnico e de Privacidade do Painel de Monitoramento da Comunidade Resiliente**

O painel **"Visão da Comunidade"** (também denominado **"Status da Rede"**) é a central de observabilidade integrada à aplicação Desktop e Web da Comunidade Resiliente. Ele fornece visibilidade operacional completa da malha P2P, participantes e estado de sincronização em tempo real, **sem nunca expor dados privados, senhas, chaves criptográficas ou conteúdo de mensagens confidenciais**.

---

## 🧭 Como Abrir o Painel na Aplicação Desktop e Web

1. **Pelo Cabeçalho da Aplicação:**
   - No canto superior direito da tela de mensagens, clique no botão **"🌐 Visão da Rede"** (`#btn-open-network-dashboard`).
2. **Atalho Rápido:**
   - O painel abre um modal responsivo em tela cheia com visual moderno *glassmorphism* e abas de navegação:
     - 📊 **Visão Geral** (14 cartões de métricas + 10 indicadores de estado P2P)
     - 🗺️ **Mapa da Rede** (Topologia visual SVG interativa com nós e conexões)
     - 👥 **Membros** (Tabela filtrável e pesquisável com controle de privacidade por papel)
     - 💻 **Nós P2P** (Lista de nós desktop, método de conexão direto vs relay e latência)
     - 📱 **Dispositivos Móveis & Web** (Estatísticas de sessões ativas e Web Push)
     - 📜 **Linha do Tempo** (Eventos operacionais resumidos em tempo real)

---

## 🗂️ Diferença entre Usuário, Dispositivo, Sessão e Nó P2P

Para evitar contagens duplicadas e garantir precisão matemática nas métricas da comunidade, o sistema distingue rigidamente as seguintes entidades:

| Conceito | Definição | Exemplo Prático | Onde é Armazenado |
| :--- | :--- | :--- | :--- |
| **Usuário** | Membro com identidade cadastrada na comunidade. Possui par de chaves Ed25519 e papel (`Administrador`, `Moderador`, `Membro`). | Alice (`alice_admin`) | Tabela `users` no SQLite |
| **Dispositivo** | Equipamento físico ou cliente que acessa a rede (Desktop, Celular, Navegador). Um mesmo usuário pode ter múltiplos dispositivos. | Notebook Windows de Alice e iPhone de Alice | Tabela `device_sessions` / `push_subscriptions` |
| **Sessão** | Conexão temporária ativa autenticada com token criptográfico de expiração. | Sessão HTTP/WebSocket aberta em um navegador | Tabela `sessions` no SQLite |
| **Nó P2P** | Instância do daemon P2P em execução em um computador pessoal, participando ativamente da malha de retransmissão e armazenamento das mensagens. | Daemon de Alice ouvindo na porta P2P 6001 | Tabela `node_identities` / `P2PEngine` |

> [!NOTE]
> **Regra de Não-Duplicação:** Se Alice estiver conectada simultaneamente pelo seu aplicativo desktop e pelo navegador do seu celular, a métrica **"Total de Membros Online"** conta Alice exatamente **1 vez**, enquanto os cartões de **"Nós Desktop"** e **"Dispositivos Celular"** registram individualmente seus respectivos pontos de acesso.

---

## 📈 Significado de Cada Indicador do Painel

### 1. Cartões de Resumo (14 Métricas)

1. **Nós Desktop Online:** Quantidade de daemons de computadores pessoais atualmente conectados à malha P2P.
2. **Total de Nós Conhecidos:** Total de nós desktop persistidos no banco de dados local (incluindo nós offline).
3. **Celulares Ativos:** Dispositivos móveis sincronizados ou com subscrição Web Push ativa.
4. **Páginas Web / PWA:** Quantidade de sessões web abertas no momento.
5. **Total de Membros:** Quantidade de participantes cadastrados na comunidade.
6. **Administradores:** Quantidade de administradores com autoridade de assinatura de comunicados.
7. **Moderadores:** Quantidade de moderadores da comunidade.
8. **Membros Comuns:** Membros com permissão de leitura e replicação de mensagens.
9. **Mensagens Sincronizadas:** Altura da cadeia local de mensagens criptografadas armazenadas em SQLite.
10. **Estado da VPS:** Status do servidor de bootstrap (`Online`, `Fallback Local` ou `Inoperante`).
11. **Estado da Rede P2P:** Estado da malha (`P2P Direto (Mesh)`, `Relay Ativo` ou `Isolado`).
12. **Líder Atual:** Identificador anonimizado do nó coordenador eleito pelo algoritmo Raft-lite.
13. **Última Sincronização:** Data e hora do último bloco ou batimento cardíaco recebido.
14. **Conexões Diretas vs Relay:** Proporção de pares conectados ponto a ponto versus pares encaminhados por relay.

### 2. Indicadores de Estado P2P (10 Indicadores)

- **Servidor Bootstrap VPS:** Indica disponibilidade para descoberta inicial.
- **Malha P2P:** Ativação de conexões entre computadores pessoais.
- **Descoberta STUN / NAT:** Status da resolução do IP reflexivo via RFC 5389.
- **Relay VPS / Desktop:** Disponibilidade de encaminhamento para nós sob NAT simétrico.
- **Motor de Sincronização:** Indicador de fluxo causal da cadeia Merkle-DAG.
- **Consenso / Quórum:** Quórum estrito da maioria alcançado no termo atual da eleição.
- **Fila de Mensagens:** Mensagens no buffer de órfãos aguardando blocos anteriores.
- **Erros Recentes:** Contador de falhas de transporte ou assinaturas rejeitadas.
- **Última Reconexão:** Timestamp do último evento de restabelecimento de par.
- **Termo da Eleição:** Número do termo (epoch) persistente da eleição Raft-lite.

---

## 🗺️ Mapa e Diagrama Topológico da Rede (SVG Interativo)

O mapa renderiza a topologia em tempo real usando um gráfico SVG vetorial dinâmico:
- **Nó Central:** Representa a Comunidade Resiliente.
- **Nó VPS:** Posicionado ao topo com ícone de nuvem/servidor.
- **Nós Desktop (💻):** Computadores pessoais orbitando o núcleo.
- **Nós Celular (📱):** Dispositivos móveis conectados à margem.
- **Nós Web (🌐):** Clientes navegadores e PWA.

### Código de Cores da Topologia:
- 🟢 **Verde (`#22c55e`):** Conectado diretamente via P2P.
- 🟡 **Amarelo (`#eab308`):** Em processo de sincronização de blocos.
- 🔵 **Azul (`#3b82f6`):** Conectado através de Relay transparente.
- ⚪ **Cinza (`#64748b`):** Nó conhecido, porém temporariamente offline.
- 🔴 **Vermelho (`#ef4444`):** Erro de conexão ou handshake criptográfico falhou.

---

## 🛡️ Privacidade e Modelo de Acesso Baseado em Papéis (RBAC)

O painel foi projetado sob o princípio da **Privacidade por Padrão (Privacy by Design)**:

### 1. Dados NUNCA Expostos no Painel
- ❌ Senhas ou hashes PBKDF2 de senhas;
- ❌ Chaves privadas Ed25519;
- ❌ Chaves simétricas do canal AES-256-GCM;
- ❌ Tokens de sessão e cookies de autenticação;
- ❌ Endereços IP públicos completos (aplica-se máscara ou omissão);
- ❌ Geolocalização física dos participantes;
- ❌ Conteúdo privado das mensagens ou nomes de arquivos anexos;
- ❌ Chaves de subscrição e tokens push FCM/APNs.

### 2. Visibilidade Conforme o Papel do Usuário Conectado

| Seção / Dado | Administrador | Moderador | Membro Comum |
| :--- | :---: | :---: | :---: |
| **Resumo de Métricas (14 Cards)** | Completo | Completo | Agregado Anônimo |
| **Mapa da Rede (Topologia)** | Completo | Completo | Simplificado |
| **Lista de Membros** | Nomes e Papéis | Nomes e Papéis | Apenas próprio perfil e contagens |
| **Nós P2P (Detalhes Técnicos)** | Completo (Protocolo, Handshake, Latência) | Resumido | Oculto |
| **Dispositivos Móveis** | Quantitativo e Tipos | Quantitativo | Apenas próprio dispositivo |
| **Linha do Tempo Técnica** | Todos os eventos | Eventos de Conexão | Oculto |

> [!IMPORTANT]
> **Validação no Servidor:** As restrições de privacidade são validadas nos endpoints REST (`/api/network/*` e `/api/community/*`) e no WebSocket (`/live/network`). Modificações manuais no código JavaScript do cliente no navegador são rejeitadas pelo backend.

---

## ⚡ Queda da VPS: Interpretação Operacional

Quando o servidor central (VPS) cai ou é desligado:
1. O cartão **"Estado da VPS"** passa para **"Inoperante / Desligada"** (ícone cinza/vermelho).
2. O cartão **"Estado da Rede P2P"** exibe **"Malha P2P Autônoma"**.
3. O sistema aciona automaticamente o fallback para o cache local SQLite, recuperando os endereços de computadores conhecidos.
4. O motor Raft-lite realiza uma nova eleição de termo e define o nó líder local para coordenar as mensagens pendentes.
5. O painel continua funcionando perfeitamente de forma local no desktop de cada membro, informando a resiliência ativa do sistema.

---

## 🔄 Conexão Direta vs Relay

- **Conexão Direta (P2P Direto):** Ocorre quando ambos os computadores conseguem abrir canais diretos via IP reflexivo descoberto pelo STUN (RFC 5389) ou quando estão na mesma rede/roteador com suporte a NAT Cone ou UPnP.
- **Conexão via Relay:** Quando um ou ambos os nós estão sob **NAT Simétrico** restrito (comum em redes corporativas ou 4G/5G CGNAT com portas aleatórias), a conexão direta é impossível. O sistema utiliza automaticamente a VPS ou um nó desktop de confiança como retransmissor cifrado, sem que o relay consiga inspecionar as mensagens.

---

## ⚠️ Limitações do Monitoramento P2P

1. **Navegadores PWA em Celulares:** Navegadores móveis não executam sockets UDP STUN nativos em background de forma persistente. Celulares conectam-se ao nó desktop pessoal ou à VPS via WebSockets/Web Push.
2. **NAT Simétrico Rígido:** A descoberta STUN identifica o IP reflexivo, mas roteadores simétricos exigem que o tráfego passe pelo Relay.
3. **Notificações Push:** O serviço Web Push VAPID depende dos gateways da Apple (APNs), Google (FCM) ou Mozilla. Em caso de bloqueio governamental ou censura contra esses provedores, o push falha, mas a entrega P2P desktop continua 100% ativa.
