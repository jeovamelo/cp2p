# Análise de Segurança, Modelo de Ameaças e Limitações

## 1. Visão Geral de Segurança

O sistema **Comunidade Resiliente** foi projetado sob a premissa de que o ambiente de execução e a rede de transporte são intrinsecamente hostis. A integridade das publicações e o sigilo das comunicações dependem exclusivamente de **propriedades matemáticas e criptográficas**, e nunca da idoneidade dos servidores intermediários.

---

## 2. Modelo de Ameaças (Classificação STRIDE)

| Ameaça | Vetor de Ataque | Mitigação no Sistema |
| :--- | :--- | :--- |
| **Spoofing (Falsificação de Identidade)** | Um invasor finge ser um Administrador e emite uma ordem falsa. | **Assinaturas Digitais Ed25519:** Todas as mensagens são assinadas com a chave privada do administrador. Qualquer nó descarta mensagens sem assinatura válida da autoridade reconhecida. |
| **Tampering (Adulteração de Mensagens)** | Um nó malicioso altera palavras em um comunicado ao retransmiti-lo. | **AES-256-GCM + Content Addressing (SHA-256):** Qualquer alteração no texto ou nos metadados invalida o bloco SHA-256 e a Authentication Tag de 128 bits do GCM, resultando em rejeição imediata. |
| **Repudiation (Repúdio)** | Um autor alega que não enviou determinado comunicado. | **Não-Repúdio Criptográfico:** A assinatura Ed25519 vincula inequivocamente a chave privada do emissor ao conteúdo publicado. |
| **Information Disclosure (Vazamento de Dados)** | Espionagem de tráfego de rede ou apreensão física de um servidor VPS. | **Criptografia Ponta a Ponta (E2EE):** O servidor de relay e os nós intermediários trafegam apenas payloads cifrados em AES-256-GCM. A VPS não possui a chave do canal. |
| **Denial of Service (Queda ou Bloqueio do Servidor)** | Um ator estatal ou criminoso desliga a VPS central ou bloqueia seu IP. | **Malha P2P Autônoma & Eleição de Líder:** Os nós pessoais continuam se comunicando diretamente via P2P Mesh. A VPS é descartável. |
| **Elevation of Privilege (Elevação de Privilégio)** | Um membro comum tenta enviar um comunicado ou revogar um administrador. | **Enforcement Criptográfico Local:** A verificação de permissões é descentralizada. O nó local só aceita blocos assinados por chaves declaradas como administradoras. |

---

## 3. Análise de Ataques Específicos em Redes P2P

### 3.1. Ataque Sybil
- **Cenário:** Um atacante cria milhares de nós virtuais para sobrecarregar a rede ou tentar manipular a votação de consenso.
- **Defesa:** Na Comunidade Resiliente, **a autoridade para publicar não decorre da quantidade de nós**. Mesmo que um atacante controle 99% dos nós da rede, ele não possui a chave privada Ed25519 do Administrador. Suas mensagens falsas serão rejeitadas por 100% dos nós legítimos. Na eleição de líder para relay, o algoritmo prioriza o nó do Administrador legítimo e nós com maior sequência histórica.

### 3.2. Ataque Eclipse
- **Cenário:** O atacante cerca um nó específico com nós controlados por ele, impedindo que o nó receba comunicados legítimos.
- **Defesa:**
  1. Configuração de múltiplos nós de bootstrap independentes em domínios/IPs diferentes;
  2. Protocolo PEX (Peer Exchange) com mistura randômica de vizinhos;
  3. Reconexão periódica e persistência local de endereços conhecidos anteriores.

### 3.3. Ataque de Replay e Fork
- **Cenário:** Um atacante reenvia um comunicado antigo fora de contexto para gerar confusão.
- **Defesa:** Cada mensagem possui um número de sequência estritamente incremental (`sequence = prev_sequence + 1`) e o hash do bloco anterior (`prev_hash`). O nó local descarta blocos obsoletos ou com encadeamento causal divergente.

---

## 4. Rotação de Chaves Criptográficas (Key Rotation)

A revogação de membros em sistemas P2P é historicamente desafiadora. A Comunidade Resiliente resolve isso através do conceito de **Épocas Criptográficas (`key_epochs`)**:
1. Quando um membro é revogado no Painel Administrativo, uma nova época $E+1$ é ativada.
2. Uma nova chave de canal de 256 bits é gerada e distribuída apenas aos membros ativos autorizados.
3. Mensagens subsequentes são criptografadas com a nova chave.
4. O dispositivo do membro revogado não recebe a nova chave e, portanto, torna-se incapaz de decifrar qualquer comunicado emitido após sua expulsão.

---

## 5. Limitações Conhecidas da Versão Atual

1. **NAT Simétrico Restritivo sem IPv6/UPnP:** Se dois nós estiverem ambos atrás de firewalls ou provedores com CGNAT duplo (Carrier-Grade NAT) sem suporte a STUN ou sem IPv6 público, a comunicação direta ponto a ponto pode requerer um nó intermediário (relay) com portas acessíveis.
2. **Escala de Malha Plena (Full Mesh):** Em comunidades com dezenas de milhares de nós concorrentes, o gossip por difusão plena pode ser otimizado com DHTs estruturadas (Kademlia/libp2p) e subscrições baseadas em tópicos (Gossipsub).
3. **Metadados de Conexão:** Embora o conteúdo seja 100% criptografado de ponta a ponta, um observador em nível de provedor de telecomunicações pode inferir que conexões TCP/WebSocket estão ocorrendo entre determinados IPs.

---

## 6. Próximos Passos de Evolução

- [ ] **Camada de Transporte via Tor / I2P:** Integração com serviços cebola (`.onion`) para anonimização total de metadados e travessia irrestrita de NATs sem expor IPs públicos.
- [ ] **Empacotamento Desktop com Tauri:** Empacotar o nó P2P com Tauri/Rust para gerar executáveis nativos leves (<15 MB) com ícone na bandeja do sistema (system tray) e auto-início no boot do sistema operacional.
- [ ] **Compartilhamento de Áudio e Vídeo Chunked:** Fragmentação de arquivos de mídia em pedaços BitTorrent/IPFS com download paralelo de múltiplos nós.
- [ ] **Quórum Multifirmas (Threshold Ed25519):** Exigir aprovação de $M$ de $N$ administradores (ex: 2 de 3) para validar comunicados de segurança crítica.
