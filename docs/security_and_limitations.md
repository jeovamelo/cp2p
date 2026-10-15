# Análise de Segurança, Modelo de Ameaças, Limitações e Próximos Passos

Este documento detalha o modelo formal de segurança do **Comunidade Resiliente**, as salvaguardas implementadas, as limitações conhecidas da versão MVP e a folha de rota para evolução contínua.

---

## 1. Modelo de Ameaças (Threat Model)

O sistema foi arquitetado assumindo o princípio de **Zero-Trust**: **nenhum nó na rede é considerado confiável**, incluindo a VPS inicial de bootstrap.

| Vetor de Ameaça | Descrição do Ataque | Contramedida Implementada no Sistema |
| :--- | :--- | :--- |
| **Apreensão / Queda da VPS** | O servidor central é desligado, apreendido ou censurado por ordem judicial ou ataque DDoS. | **Imunidade por Design:** Os computadores dos membros são nós P2P completos que armazenam o histórico criptografado e continuam trocando mensagens diretamente. Um novo líder de malha é eleito dinamicamente. |
| **Forjamento de Mensagens** | Um nó malicioso conectado na malha tenta emitir um comunicado falso ou desinformação. | **Assinaturas Digitais Ed25519:** Todas as mensagens são assinadas com a chave privada do Administrador. Cada nó receptor valida matematicamente a assinatura antes de salvar ou retransmitir. |
| **Ataque de Replay / Duplicação** | Um invasor captura um pacote legítimo e o retransmite milhares de vezes para sobrecarregar nós. | **ID Único + Hash Cache + Sequência Monotônica:** Cada mensagem possui um hash SHA-256 determinístico e número de sequência estrito. Mensagens repetidas são descartadas no primeiro salto. |
| **Espionagem em Trânsito (Eavesdropping)** | Um provedor de internet ou nó intermediário tenta ler o conteúdo das mensagens que trafegam. | **Criptografia Ponta-a-Ponta (AES-256-GCM):** O payload só pode ser decifrado por membros que possuem a chave simétrica do canal vigente (*Epoch Key*). Provedores e intermediários enxergam apenas ciphertext ilegível. |
| **Membro Revogado (Ex-membro Malicioso)** | Um membro é expulso da comunidade e tenta continuar lendo os novos comunicados confidenciais. | **Rotação de Chaves (Key Epoch Ratchet):** Ao revogar o membro, a comunidade avança para uma nova época criptográfica (*Epoch n+1*). A nova chave é encapsulada apenas para os membros ativos remanescentes. |
| **Vazamento do Dispositivo Local** | O computador físico de um membro é inspecionado ou furtado. | **Cofre Criptografado (Local Vault):** A chave privada Ed25519 do usuário e os dados em repouso no SQLite são protegidos com chave mestra derivada via PBKDF2/Argon2 com 100.000 iterações e salt aleatório. |
| **Vazamento de Privacidade via Push** | Servidores push comerciais (Google FCM / Apple APNs) inspecionam o texto das notificações no smartphone. | **Zero-Knowledge Push Notification:** A notificação push trafega apenas metadados genéricos (*"Nova mensagem criptografada disponível"*). A decifração ocorre exclusivamente no hardware do celular após sincronização P2P. |

---

## 2. Garantias e Invariantes Criptográficas

1. **Autenticidade e Não-Repúdio:** Somente quem possui a chave privada correspondente a `genesis_admin_pubkey` consegue gerar assinaturas válidas que são aceitas pelos nós. É computacionalmente inviável para um membro comum forjar comunicados oficiais.
2. **Integridade Estrutural (Signed Hash-Chain / DAG):** Cada mensagem aponta para o hash do bloco anterior (`prev_hash`). Qualquer tentativa de alterar um texto do passado invalida todos os hashes subsequentes, sendo rejeitada instantaneamente pelos nós da rede.
3. **Auditoria Imutável:** Todas as ações administrativas (criação de usuário, revogação, rotação de época, conexão de novos nós) são registradas em uma cadeia local encadeada com SHA-256 e assinaturas digitais.

---

## 3. Limitações Conhecidas do MVP Atual

Embora o MVP comprove matematicamente e na prática a sobrevivência do sistema sem a VPS, algumas limitações de engenharia existem na versão atual:

### 3.1. NATs Simétricos e CGNAT Agressivo
- **Situação:** Nós residenciais sob CGNAT estrito (onde ambos os nós estão atrás de roteadores sem portas abertas ou UPnP) necessitam de assistência de STUN para perfuração de NAT (UDP Hole Punching) ou relés voluntários (TURN).
- **Impacto no MVP:** Em redes locais e conexões diretas por IP/porta ou com pelo menos um nó de borda acessível, a malha funciona 100%. Em cenários onde 100% dos nós estão sob CGNAT simétrico duplo e a VPS cair, a comunicação pode necessitar que pelo menos um membro possua porta mapeada ou use rede overlay.

### 3.2. Dependência de Pontos Iniciais de Bootstrap
- **Situação:** Ao ingressar pela primeira vez na rede, um nó desconhece o IP dos outros computadores pessoais. A lista de nós de bootstrap inicial fornece esse ponto de encontro.
- **Mitigação:** O sistema suporta múltiplos bootstraps configuráveis e descoberta por mDNS na rede local. Se a VPS cair após a descoberta inicial, a tabela PEX nos bancos SQLite locais garante a continuidade das conexões.

### 3.3. Volume de Anexos Grandes
- **Situação:** O protocolo de gossip epidêmico replica dados diretamente em broadcast. Enviar arquivos muito grandes (vídeos de centenas de megabytes) via gossip puro consome largura de banda excessiva de nós com conexões limitadas.
- **Mitigação Atual:** O sistema suporta texto e imagens/arquivos leves. Arquivos grandes devem usar chunking estilo BitTorrent.

---

## 4. Próximos Passos e Roadmap de Evolução

### Fase 1: Governança Multi-Assinatura (Threshold Multi-Sig)
- Substituir a assinatura de Administrador único por um esquema de **Quórum de Administradores (M-de-N)** usando assinaturas Schnorr / BLS agregadas.
- Uma mensagem só é válida se assinada por pelo menos 3 de 5 administradores, eliminando o risco de um administrador individual ser coagido ou ter sua chave comprometida.

### Fase 2: Roteamento Anônimo sobre Tor / I2P
- Adicionar suporte nativo a endereços Onion (`.onion`) e túneis I2P para que os nós P2P não precisem expor seus endereços IP públicos uns aos outros.
- Protege a privacidade física dos membros contra rastreamento de localização.

### Fase 3: Distribuição de Mídia em Pedaços (BitTorrent Chunking)
- Para imagens de alta resolução, áudios e vídeos, a mensagem no log carregará apenas o hash Merkle da mídia (Magnet link).
- O download dos pedaços binários ocorrerá sob demanda via protocolo de transferência P2P particionado.

### Fase 4: Integração de libp2p Completa com Kademlia DHT
- Transição da camada de rede para a especificação completa do `libp2p` com tabela hash distribuída (Kademlia DHT) para descoberta de nós sem depender de nenhuma VPS.
