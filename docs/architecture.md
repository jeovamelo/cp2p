# Arquitetura do Sistema: Comunidade Resiliente

## 1. Visão Geral e Filosofia

O **Comunidade Resiliente** é um ecossistema descentralizado de comunicação P2P (Peer-to-Peer) projetado para garantir disponibilidade contínua de canais comunitários mesmo diante de censura, falhas catastróficas de infraestrutura centralizada ou desligamento da VPS principal.

Diferente de sistemas convencionais baseados em arquitetura cliente-servidor centralizada (onde a queda do servidor interrompe completamente o serviço), no Comunidade Resiliente a VPS atua unicamente como **semente inicial (bootstrap)**, auxiliar de sinalização WebRTC e relé temporário para nós sob NATs restritivos. Cada computador pessoal de membro que executa o aplicativo atua como um nó completo (full node) com capacidade de roteamento, armazenamento local criptografado, validação criptográfica de publicações e eleição de liderança mesh.

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

---

## 2. Componentes da Arquitetura

### 2.1. Núcleo P2P (`packages/core`)
Biblioteca compartilhada responsável por toda a lógica de segurança, estrutura de dados e comunicação em rede:
- **Módulo Criptográfico (`crypto/`)**:
  - **Identidade e Assinaturas (Ed25519)**: Geração de par de chaves assimétricas. Todas as mensagens são assinadas digitalmente com a chave privada do Administrador.
  - **Cifra Simétrica de Canal (AES-256-GCM)**: Mensagens e anexos são cifrados com a chave comunitária vigente (*Community Key*). Apenas membros autorizados que possuem a chave do ciclo vigente (*epoch*) conseguem decifrar.
  - **Cofre Local Criptografado (Argon2 / PBKDF2 + AES-GCM)**: As chaves privadas dos nós e os dados em disco no SQLite são cifrados com uma chave mestre local derivada da senha do usuário, prevenindo vazamento de dados em repouso.
  - **Rotação de Chaves (Key Epoch Ratchet)**: Quando um membro é revogado, o Administrador emite um novo ciclo de chave (*epoch n+1*), re-encriptado individualmente para os membros legítimos restantes. Membros expulsos tornam-se incapazes de ler novas mensagens.
- **DAG de Mensagens e Log Imutável (`model/`, `sync/`)**:
  - Cada mensagem é um nó em uma cadeia de blocos leve (append-only hash-chained DAG).
  - Cada registro possui: `id`, `communityId`, `sequence`, `previousHash`, `hash`, `timestamp`, `authorPublicKey`, `payload` (cifrado), `signature`.
  - Mecanismo anti-replay e anti-duplicação baseado em cache de hashes e checagem de monotonicidade de sequência.
- **Protocolo de Rede e Gossip (`p2p/`)**:
  - Camada de transporte híbrida: WebRTC DataChannels para comunicação browser-to-browser e desktop-to-desktop, combinada com WebSockets bidirecionais de alta performance para nós desktop e servidores.
  - Descoberta mútua (Peer Discovery) via listas de sementes (Bootstrap Nodes), mDNS/broadcast local e troca de tabelas de pares (Peer Exchange - PEX).
  - Algoritmo de fofoca epidêmica (Anti-Entropy Push-Pull Gossip) com vetores de estado (Vector Clocks).
- **Eleição de Líder e Consenso Leve (`p2p/election.js`)**:
  - Quando a VPS fica offline, os nós ativos detectam perda de batimentos cardíacos (heartbeat timeout).
  - Inicia-se uma eleição estilo Bully/Raft simplificada, onde o nó online com maior prioridade determinística (combinação de uptime, pontuação de reputação e menor hash de ID de nó) é alçado a **Coordenador da Malha (Mesh Leader)**.
  - O líder assume a responsabilidade de intermediar mensagens para nós atrás de NAT restrito e coordenar sincronizações pendentes.

### 2.2. Servidor VPS Bootstrap / Relay (`packages/vps`)
- Ponto de encontro inicial para os nós ingressarem na rede e trocarem informações SDP/ICE.
- Fornece candidatos STUN públicos (`stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302`).
- Mantém em memória um cache dos últimos hashes de mensagens e registro de nós conhecidos.
- **Característica Crítica de Resiliência**: O sistema é agnóstico à morte da VPS. Se o processo for encerrado (`SIGTERM`, bloqueio de IP ou falha física do datacenter), os nós já conectados continuam operando de forma direta e aceitam reconexões via IPs de nós conhecidos.

### 2.3. Nó Desktop P2P (`packages/desktop-node`)
- Daemon multiplataforma (executável como serviço ou aplicativo de desktop).
- Banco de dados local SQLite integrado via engine nativo, garantindo persistência durável em disco com zero configuração.
- Servidor REST e WebSocket local protegido por token de sessão para interação com a interface gráfica.
- Modo de execução contínuo com reconexão automática e tolerância a mudanças de IP (DHCP, roaming Wi-Fi/4G).

### 2.4. Interface Web / PWA (`packages/web`)
- Desenvolvido em React moderno com Vite.
- Design responsivo, tema escuro cibernético de alta densidade visual (glassmorphism, animações de status e tipografia moderna).
- **PWA com Service Worker**: Permite instalação no smartphone (Android/iOS) e desktop, funcionamento offline e sincronização em segundo plano.
- **Painel de Topologia em Tempo Real**: Gráfico interativo com nós conectados, latência, papel de cada nó, status da sincronização e **Botão de Simulação de Queda da VPS** para auditoria visual instantânea.

### 2.5. Serviço de Notificações Push com Preservação de Privacidade (`packages/core/src/notification`)
- Suporte a Web Push (RFC 8030 / VAPID) e gatilhos compatíveis com FCM/APNs.
- **Princípio Zero-Knowledge no Push**: A notificação não trafega o texto da mensagem pela nuvem pública da Apple ou Google. A notificação apenas sinaliza: *"Nova mensagem criptografada disponível no canal"*. Ao ser clicada, o app P2P abre, decifra o conteúdo localmente com a chave privada/comunitária e apresenta o conteúdo ao usuário.
- Fila de notificações pendentes: se um nó ou serviço de push estiver temporariamente offline, as notificações são retidas localmente e disparadas assim que a rota for restabelecida.

---

## 3. Modelo de Dados e Estrutura Criptográfica

### 3.1. Estrutura do Envelope de Mensagem
```json
{
  "id": "msg_01h8x4a9b2...",
  "communityId": "comm_resiliente_brasil",
  "sequence": 42,
  "previousHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "hash": "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
  "timestamp": 1728950400000,
  "epoch": 1,
  "authorPublicKey": "ed25519_pk_3a5f9c...",
  "signature": "ed25519_sig_9b2d1f4e...",
  "payload": {
    "ciphertext": "a9f8e4c3b2...",
    "iv": "d1e2f3a4b5c6d7e8f9011223",
    "authTag": "c0d1e2f3a4b5c6d7e8f9011223344556"
  },
  "metadata": {
    "hasAttachments": false,
    "attachmentCount": 0
  }
}
```

### 3.2. Regras de Validação no Nó Receptor
Ao receber um pacote P2P:
1. **Verificação de Hash**: Recalcula `SHA256(sequence + previousHash + timestamp + payload.ciphertext + authorPublicKey)`. O valor deve ser idêntico ao campo `hash`.
2. **Verificação de Assinatura Digital**: Executa `Ed25519.verify(hash, signature, authorPublicKey)`. Se falhar, o pacote é descartado imediatamente e o IP do remetente pontuado negativamente.
3. **Verificação de Autorização de Papel**: Consulta o registro local do nó para a chave `authorPublicKey`. Se o usuário não possuir papel `ADMIN` para a comunidade em questão, a mensagem é categoricamente rejeitada.
4. **Verificação de Monotonicidade e Anti-Replay**: Se o `id` ou `hash` já existir no banco local, a mensagem é ignorada. Se o `sequence` estiver à frente do histórico conhecido, o nó solicita os blocos faltantes via rotina de sincronização anti-entropia.
5. **Decifração**: Utiliza a `CommunityKey` correspondente ao `epoch` indicado para abrir o envelope AES-256-GCM.

---

## 4. Estratégia de Tolerância a Falhas e Partições de Rede

### 4.1. Cenário A: VPS Ativa (Operação Normal)
- Nós novos consultam a VPS para obter lista de pares ativos e negociar canal WebRTC.
- Mensagens do Administrador são propagadas simultaneamente para a VPS e diretamente para os nós conectados via malha P2P.

### 4.2. Cenário B: VPS Derrubada / Bloqueada / Fora do Ar
- **Detecção**: Nós falham em renovar o ping com a VPS após 3 tentativas (intervalo configurável, ex.: 3 segundos).
- **Sobrevivência da Malha**:
  - Os nós continuam conectados uns aos outros via canais WebRTC ou WebSockets locais previamente abertos.
  - Conexões com novos nós utilizam a tabela de rotas locais (Peer Exchange).
- **Eleição de Novo Líder**:
  - Os nós remanescentes realizam uma votação distribuída.
  - O nó com menor hash de identidade ou maior tempo de atividade é eleito **Líder Provisório**.
  - O líder coordena a transmissão de mensagens e o registro de novos nós enquanto a VPS estiver inacessível.
- **Publicação Continuada**:
  - O Administrador (seja ele o líder ou apenas um nó na rede) continua criando e assinando mensagens normalmente.
  - As mensagens são disseminadas pela malha via protocolo de fofoca (*gossip*). Todos os nós verificam a assinatura Ed25519 e armazenam a mensagem em seus bancos SQLite.
- **Restauração da VPS**:
  - Quando a VPS volta ao ar, os nós se reconectam e executam sincronização bidirecional, atualizando o histórico da VPS com todas as mensagens criadas durante o período de indisponibilidade.

---

## 5. Garantia de Quórum e Segurança de Governança
- **Apenas Administradores publicam**: Garantido matematicamente por assinaturas Ed25519 que nós não conseguem forjar.
- **Moderadores**: Possuem chaves para assinar comandos administrativos (ex.: marcar mensagem como oculta, banir nó malicioso local).
- **Quórum para Revogação**: Para expulsar um membro ou alterar permissões de comunidade em modo federado, é exigida a assinatura do Administrador principal ou aprovação de mais de 50% dos moderadores ativos.
- **Logs de Auditoria Criptografados**: Cada evento administrativo gera uma entrada imutável no log local com carimbo de tempo e assinatura digital.
