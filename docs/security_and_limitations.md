# Segurança, Modelo de Ameaças, Limitações e Privacidade 🛡️🔐

> **Documento de Auditoria e Diretrizes de Segurança do Sistema Comunidade Resiliente**

---

## 1. Modelo de Ameaças (Threat Model)

O sistema foi arquitetado sob o princípio de **Zero-Trust**: **nenhum elemento da rede é implicitamente confiável**, inclusive os servidores VPS de bootstrap e relay. Toda interação é verificada criptograficamente.

| Vetor de Ameaça | Superfície de Ataque | Contramedida Implementada no Sistema | Nível de Mitigação |
| :--- | :--- | :--- | :---: |
| **Queda ou Apreensão da VPS** | Bloqueio judicial, apreensão física de servidor ou queda de datacenter. | **Arquitetura P2P Autônoma:** Histórico preservado em SQLite local com WAL. Queda da VPS aciona fallback para nós conhecidos no cache local; malha elege novo líder via Raft-lite e continua sincronizando sem servidor central. | **Total** |
| **Forjamento de Mensagens** | Membro malicioso ou nó intermediário tenta emitir comunicados em nome da comunidade. | **Assinaturas Digitais Ed25519:** Todas as mensagens são assinadas com a chave privada de Administrador legítimo. Blocos com autor não-admin ou assinatura inválida são descartados no primeiro salto (`UNAUTHORIZED_AUTHOR_NOT_ADMIN`). | **Total** |
| **Ataque de Força Bruta no Login** | Tentativas automatizadas de adivinhação de senhas locais. | **Lockout de Autenticação:** Tabela `login_attempts` registra falhas consecutivas. 5 erros bloqueiam o usuário por 15 minutos (`ACCOUNT_TEMPORARILY_LOCKED`). | **Total** |
| **Escalação de Privilégios** | Usuário comum tenta forjar requisição para se autoconceder papel de `Administrador`. | **Validação Criptográfica e no Servidor:** O endpoint `/api/admin/users/role` exige sessão válida com permissão de Administrador e valida assinaturas de autoridade. O papel de admin não pode ser escolhido livremente pelo cliente. | **Total** |
| **Espionagem em Trânsito (Eavesdropping)** | Provedor de internet, governo ou relay intercepta pacotes. | **Cifra Autenticada AES-256-GCM:** Conteúdo e anexos são cifrados com chave comunitária de canal. Vetor de inicialização (IV) de 12 bytes único por mensagem e tag de 16 bytes. Provedores e relays enxergam apenas ciphertext ilegível. | **Total** |
| **Adulteração de Mensagens (Tampering)** | Modificação de bits do payload durante a retransmissão. | **Assinatura Ed25519 + Tag AES-GCM + ID SHA-256:** Qualquer alteração no texto ou anexo corrompe a tag de autenticação e o hash canônico do bloco, sendo rejeitado imediatamente (`BLOCK_TAMPERED_INVALID_HASH`). | **Total** |
| **Ataque de Replay e Duplicação** | Retransmissão de mensagens legítimas antigas para causar sobrecarga ou inconsistência. | **Sequência Monotônica e Deduplicação:** Tabela de mensagens possui índice único em `(community_id, sequence)` e chave primária `id`. Mensagens já processadas retornam `ALREADY_EXISTS`. | **Total** |
| **Partições de Rede e Split-Brain** | Rede se divide temporariamente e dois nós publicam blocos conflitantes na mesma sequência. | **Reconciliação Determinística CRDT:** Desempate formal por menor timestamp de emissão real seguido de menor hash SHA-256 lexicográfico. O bloco vencedor substitui deterministicamente o divergente com log de auditoria. | **Total** |
| **Comprometimento de Nós Intermediários (Relay Malicioso)** | Servidor de relay tenta inspecionar ou alterar mensagens em trânsito. | **Relay Cego com Rate-Limiting:** O relay atua apenas como retransmissor de envelopes `RELAY_FORWARD`. Ele não possui a chave do canal nem as chaves privadas dos nós, não podendo ler nem modificar o payload. Possui limite de 60 pkts/s. | **Total** |
| **Vazamento de Dados por Push Comercial** | Gateways push da Apple (APNs) ou Google (FCM) interceptam dados de membros. | **Push Zero-Knowledge:** Notificações Web Push VAPID contêm apenas metadados genéricos (*"Nova mensagem oficial disponível"*). O texto privado nunca é enviado a provedores comerciais. | **Total** |
| **Acesso Indevido a Dados do Disco** | Exame forense no computador pessoal de um membro. | **Cofre Local Criptografado (Local Vault):** Chaves privadas Ed25519 são cifradas em repouso com PBKDF2 (100.000 iterações com salt aleatório) e AES-256-GCM. Sem senhas padrão no código (`senha123` é expressamente proibida). | **Total** |
| **Impersonação de Nós na Rede** | Um invasor tenta se passar por um nó legítimo apenas usando o mesmo IP. | **Autenticação Mútua de Nós (Handshake Ed25519):** Todo par executa desafio criptográfico com nonce aleatório assinado antes de ser admitido na malha. | **Total** |

---

## 2. Invariantes de Segurança Criptográfica

1. **Assinatura Digital Ed25519 Obrigatória:**
   - Cada mensagem possui um hash SHA-256 canônico calculado sobre seus campos imutáveis (`community_id`, `sequence`, `prev_hash`, `author_pubkey`, `encrypted_content`, `iv`, `tag`, `epoch`, `timestamp`).
   - A assinatura do autor é verificada matematicamente contra a chave pública declarada e validada contra a lista de administradores autorizados.
2. **Encadeamento Causal Imutável (Merkle-DAG):**
   - O campo `prev_hash` amarra cada mensagem ao bloco anterior. É impossível alterar uma mensagem do passado sem invalidar todas as assinaturas posteriores da cadeia.
3. **Cifra de Canal com Forward Secrecy Relativa:**
   - A chave simétrica comunitária de 256 bits é rotacionada a cada nova época criptográfica (`current_epoch`).
   - Membros removidos ou revogados não recebem as chaves das épocas futuras, impedindo a leitura de novos comunicados.
4. **Isolamento de Credenciais:**
   - Senhas locais são processadas com PBKDF2 (`hashPassword` com salt aleatório de 16 bytes).
   - Sessões são identificadas por tokens criptográficos de 32 bytes gerados via CSPRNG (`crypto.randomBytes(32).toString('hex')`) com tempo de expiração estrito.

---

## 3. Modelo de Privacidade do Painel "Visão da Comunidade"

O painel visual opera sob políticas rígidas de controle de acesso baseado em papéis (RBAC):

### 3.1. Dados Expressamente Ocultados de Todos os Usuários
- Senhas, hashes de senhas e salts;
- Chaves privadas Ed25519 e chaves simétricas do canal;
- Tokens de sessão ativos e identificadores de cookies;
- Endereços IP completos de computadores pessoais (aplica-se máscara ou anonimização);
- Geolocalização física e metadados de rede doméstica;
- Conteúdo privado de mensagens e nomes de anexos;
- Tokens e credenciais de subscrição Web Push (FCM/APNs).

### 3.2. Visibilidade Diferenciada por Papel
- **Administrador:** Acesso a todas as métricas de saúde da malha, tabela de nós com latência, resumo de dispositivos por categoria e linha do tempo de eventos técnicos de conectividade.
- **Moderador:** Acesso a métricas operacionais gerais e lista de participantes com status básico.
- **Membro Comum:** Acesso estrito a contagens agregadas da comunidade (ex: quantidade de membros online) e ao seu próprio status de conexão. Dados técnicos da infraestrutura e perfis de outros membros são ocultados no backend.

---

## 4. Limitações Conhecidas e Dependências Externas

Para manter a honestidade técnica e não fazer promessas infundadas ("100% à prova de falhas"):

### 4.1. Travessia de NATs Simétricos e CGNAT Restritivo
- **Limitação:** Em roteadores residenciais que implementam **NAT Simétrico Rígido** (onde portas externas são aleatorizadas por destino), a perfuração de portas UDP STUN direta pode falhar entre dois computadores ambos sob NAT simétrico.
- **Mitigação:** Nesses cenários, a comunicação é viabilizada através do servidor de Relay transparente (hospedado na VPS ou em nó desktop com porta acessível). Caso a VPS caia E nenhum nó possua porta roteável ou UPnP, esses nós específicos dependem da entrada de um nó intermediário acessível para retransmitir blocos.

### 4.2. Dependência de Gateways Externos para Push Notifications
- **Limitação:** Notificações Web Push enviadas a celulares desligados ou navegadores em background dependem obrigatoriamente da infraestrutura dos provedores dos sistemas operacionais (Apple APNs, Google FCM e Mozilla WebPush).
- **Mitigação:** Se o acesso a esses servidores comerciais for bloqueado pelo governo ou operadoras, o push falhará, mas a **sincronização de dados P2P continua ativa e garantida** assim que o aplicativo ou nó desktop for aberto.

### 4.3. Restrições de Browsers Móveis
- **Limitação:** Navegadores em smartphones (iOS Safari e Android Chrome) limitam a execução de processos em segundo plano para preservação de bateria, impedindo a atuação contínua de celulares como nós servidores P2P completos.
- **Mitigação:** Celulares atuam como clientes de sincronização rápida (Edge Nodes) pareados com nós desktop persistentes.

---

## 5. Requisitos para Escala em Produção

Para implantações corporativas ou comunitárias de larga escala:
1. **Governança Multi-Assinatura (M-of-N):** Integrar assinaturas de limiar (Threshold Signatures como BLS ou FROST/Ed25519) para exigir a assinatura de $M$ administradores de um total de $N$ para publicação de mensagens.
2. **Camada de Anonimato sobre Tor / I2P:** Adicionar suporte a transporte via Onion Services (`.onion`), impedindo que computadores residenciais conheçam o endereço IP público uns dos outros.
3. **Distribuição Particionada de Mídia (Chunking Merkle):** Fragmentação de arquivos binários pesados (> 10 MB) no estilo BitTorrent com verificação de hashes individuais para proteger a banda da malha gossip.
