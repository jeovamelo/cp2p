# Arquitetura do Sistema: Comunidade Resiliente

## 1. Visão Geral e Objetivo

O **Comunidade Resiliente** é uma plataforma de comunicação descentralizada estruturada no formato de canal unidirecional com autenticação multifunção, concebida para operar com **zero dependência de infraestrutura centralizada permanente**.

O propósito fundamental é assegurar que comunicados oficiais de lideranças e administradores alcancem todos os membros da comunidade no computador pessoal e no celular, **mesmo que o servidor central (VPS) seja confiscado, derrubado ou permanentemente desligado**.

---

## 2. Princípios de Engenharia e Modelo Zero-Trust

A arquitetura adota uma postura rígida de **Zero-Trust**:
- **Nunca confiar na rede ou em um nó intermediário:** Qualquer nó pode ser hostil, adulterado ou estar sob monitoramento.
- **Validação Matemática de Ponta a Ponta:** Nenhuma mensagem é exibida ou retransmitida sem antes ser verificada criptograficamente contra a chave pública Ed25519 autorizada.
- **Servidor VPS como Infraestrutura Efêmera:** A VPS atua exclusivamente como ponto inicial de encontro (Rendezvous / Relay). Se desaparecer, os nós de borda (computadores pessoais dos membros) formam uma malha autônoma instantânea.
- **Separação Criptográfica entre Leitura e Escrita:**
  - *Leitura:* Permitida a quem possui a chave simétrica do canal (AES-256-GCM) para a época atual.
  - *Publicação:* Exclusiva a quem possui a chave privada assimétrica (Ed25519) autorizada pela governança.

---

## 3. Diagrama Geral da Arquitetura

```
               [ Cenário 1: VPS Ativa (Fase Normal) ]

                        +----------------------+
                        |  VPS Bootstrap Node  |
                        | (Descoberta & Relay) |
                        +----------+-----------+
                                   |
                  +----------------+---------------+
                  |                                |
         +--------v---------+             +--------v---------+
         | Nó 1: Admin      | <=========> | Nó 2: Moderador  |
         | (Ed25519 Signer) |  P2P Mesh   | (SQLite E2EE)    |
         +--------+---------+             +--------+---------+
                  ^                                ^
                  |           P2P Mesh             |
                  +================================+
                  |
         +--------v---------+
         | Nó 3: Membro     |
         | (PWA / SQLite)   |
         +------------------+

-------------------------------------------------------------------------

          [ Cenário 2: VPS Derrubada / Bloqueada (Modo Resiliente) ]

                        +----------------------+
                        |  VPS Bootstrap Node  | ===> [ MORTO / OFF ]
                        +----------------------+

                  +================================+
                  |       MALHA P2P AUTÔNOMA       |
                  |                                |
         +--------v---------+             +--------v---------+
         | Nó 1: Admin      | <=========> | Nó 2: Moderador  |
         | (Líder Eleito)   |             | (Relay Ativo)    |
         +--------+---------+             +--------+---------+
                  ^                                ^
                  |                                |
                  +================================+
                  |
         +--------v---------+
         | Nó 3: Membro     |
         +------------------+
```

---

## 4. Topologia de Rede e Comunicação P2P

### 4.1. Descoberta de Nós (PEX - Peer Exchange)
1. Ao inicializar, o nó conecta-se a pelo menos dois pontos de bootstrap configuráveis via WebSockets/WebRTC.
2. Através do pacote `HELLO` e `HELLO_ACK`, os nós trocam identificadores e versões da cadeia.
3. O protocolo **PEX (Peer Exchange)** difunde periodicamente a lista de nós ativos conhecidos. Cada nó tenta abrir conexões TCP/WebSocket diretas com outros pares, formando uma malha parcialmente conectada (mesh).

### 4.2. Travessia de NAT e Fallback de Relay
- Nós em redes domésticas utilizam mecanismos de detecção de IP público (STUN).
- Quando dois nós estão sob NATs simétricos restritivos e não conseguem estabelecer conexão ponto a ponto direta, o pacote `RELAY_FORWARD` é roteado através de qualquer nó intermediário conectado (incluindo o nó líder eleito).
- O tráfego retransmitido permanece **100% criptografado de ponta a ponta**; o nó intermediário não possui acesso ao conteúdo.

---

## 5. Criptografia e Segurança

### 5.1. Assinatura Digital de Publicações (Ed25519)
- Administradores geram um par de chaves assimétricas Ed25519.
- Cada publicação gera um hash SHA-256 único do bloco:
  $$\text{BlockID} = \text{SHA-256}(\text{community\_id} \parallel \text{seq} \parallel \text{prev\_hash} \parallel \text{author\_pubkey} \parallel \text{ciphertext} \parallel \text{iv} \parallel \text{tag} \parallel \text{epoch} \parallel \text{timestamp})$$
- O $\text{BlockID}$ é assinado com a chave privada do Administrador.
- **Regra de Aceite:** Um nó receptor descarta sumariamente qualquer mensagem se:
  1. A chave pública do autor não pertencer ao conjunto de administradores autorizados;
  2. O recálculo do hash SHA-256 não coincidir com o `BlockID`;
  3. A assinatura Ed25519 falhar na validação matemática.

### 5.2. Criptografia de Conteúdo em Repouso e em Trânsito (AES-256-GCM)
- O texto e os anexos (imagens/documentos) são cifrados usando **AES-256-GCM** com IV exclusivo de 96 bits e Authentication Tag de 128 bits.
- Isso previne leitura indevida por intermediários e garante integridade contra adulterações de bits no texto cifrado.

### 5.3. Rotação de Chaves Criptográficas (Key Rotation)
- Para implementar a revogação efetiva de membros ou moderadores, o sistema opera em **Épocas Criptográficas (`epoch`)**.
- Ao revogar um usuário:
  1. O administrador emite um comando de revogação assinado;
  2. Uma nova chave de canal $\text{Key}_{E+1}$ é gerada;
  3. As mensagens futuras são criptografadas com a nova chave da época $E+1$;
  4. O membro revogado retém mensagens antigas até a época $E$, mas torna-se matematicamente incapaz de decifrar qualquer comunicado emitido a partir de $E+1$.

---

## 6. Consistência, CRDT e Cadeia Assinada

Para garantir que todos os nós convirjam para o mesmo histórico sem dependência de um relógio centralizado:
1. **Identificador Imutável por Conteúdo:** A duplicação é eliminada naturalmente usando o hash do bloco como chave primária (`PRIMARY KEY`).
2. **Hash Chain Ordenada:** Cada bloco referencia explicitamente o `prev_hash` do bloco anterior, formando uma linha do tempo criptográfica contínua.
3. **Buffer de Órfãos e Anti-Entropy Sync:** Se um nó recebe a mensagem `#5` sem ter recebido as mensagens `#3` e `#4`, o bloco `#5` é guardado em quarentena no buffer de órfãos e um pacote `SYNC_REQUEST` é emitido aos pares para obter os blocos ausentes. Assim que `#3` e `#4` chegam, a cadeia é resolvida em cascata.

---

## 7. Eleição de Líder e Consenso na Queda da VPS

Quando a VPS deixa de responder a heartbeats:
1. O motor de consenso inicia um timer aleatório de eleição.
2. Nós online emitem `ELECTION_CALL` com base em sua prioridade:
   - Administradores têm prioridade máxima;
   - Nós com maior sequência de mensagens conhecida e maior ID de nó servem como critério determinístico de desempate.
3. Os nós elegem o nó coordenador com `ELECTION_VOTE`.
4. O nó vencedor declara liderança com `ELECTION_DECLARE` e assume o papel de relay e orquestrador de sincronização da malha local até que a VPS retorne.

---

## 8. Comportamento em Partições de Rede (Split-Brain)

Caso haja um rompimento na infraestrutura de internet separando dois grupos de nós (ex: bloqueio regional):
- **Dentro de cada partição:** Nós continuam acessando o histórico local persistido em SQLite.
- **Se um Administrador estiver na partição:** Ele pode continuar publicando comunicados sequenciais assinados.
- **Cura da partição (Heal):** Quando a conectividade entre os grupos é restabelecida, os nós trocam suas cabeças de sequência (`SYNC_REQUEST`). Como as publicações são estritamente assinadas por administradores com sequenciamento incremental e encadeamento hash, a cadeia mais longa assinada por administradores legítimos prevalece e unifica o histórico de todos os membros.

---

## 9. Notificações Push e PWA

- **Web Push API & Service Worker:** Compatível com navegadores modernos no Android, iOS (Safari PWA) e desktop.
- **Proteção de Privacidade no Push:** O payload que trafega pelos servidores de push (Google FCM, Apple APNs) **nunca contém o texto confidencial do comunicado**. Ele informa apenas: `"Novo comunicado oficial recebido via P2P"`. A decifração do conteúdo acontece exclusivamente dentro da aplicação local do usuário, com a chave simétrica residente em seu dispositivo.
