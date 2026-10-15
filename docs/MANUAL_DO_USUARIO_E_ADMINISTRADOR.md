# Comunidade Resiliente - Manual Completo de Uso e Administração 🛡️📖

> **Guia Oficial de Operação, Segurança e Resiliência P2P**  
> **Domínio de Produção:** [https://cp2p.democracias.org](https://cp2p.democracias.org)  
> **Suíte de Testes:** 75/75 Testes Automatizados Aprovados (0 falhas)

---

## 📑 Sumário

1. [Visão Geral e Filosofia do Sistema](#1-visão-geral-e-filosofia-do-sistema)
2. [Cadastro Simples e Pseudônimo (Sem Dados Pessoais)](#2-cadastro-simples-e-pseudônimo)
3. [Instalação e Acesso (Desktop, Web e PWA)](#3-instalação-e-acesso)
4. [Como Criar e Configurar uma Comunidade](#4-como-criar-e-configurar-uma-comunidade)
5. [Como Convidar Membros (Código Curto e QR Code)](#5-como-convidar-membros)
6. [Vinculação Segura de Novos Dispositivos (Pareamento & QR Code)](#6-vinculação-segura-de-novos-dispositivos)
7. [Arquitetura de Canais e Controle de Permissões](#7-arquitetura-de-canais-e-controle-de-permissões)
8. [Envio de Mensagens, Imagens e Arquivos em Partes (Chunking)](#8-envio-de-mensagens-imagens-e-arquivos)
9. [Compartilhamento Seguro de Links com Pré-Visualização (SSRF-Safe)](#9-compartilhamento-seguro-de-links)
10. [Encaminhamento de Conteúdo com Proveniência](#10-encaminhamento-de-conteúdo-com-proveniência)
11. [Resiliência Offline e Sincronização Posterior (Fila Outbox)](#11-resiliência-offline-e-fila-outbox)
12. [Interpretação do Status da Rede P2P e Telemetria](#12-interpretação-do-status-da-rede-p2p)
13. [Notificações e Silenciamento por Canal (Zero-Knowledge)](#13-notificações-e-silenciamento)
14. [Gestão de Cotas de Armazenamento por Nó](#14-gestão-de-cotas-de-armazenamento)
15. [Segurança Criptográfica e Privacidade](#15-segurança-criptográfica-e-privacidade)
16. [Recuperação Comprovada após Queda da VPS](#16-recuperação-comprovada-após-queda-da-vps)
17. [Backup e Restauração da Comunidade](#17-backup-e-restauração)

---

## 1. Visão Geral e Filosofia do Sistema

A **Comunidade Resiliente** foi concebida para oferecer uma experiência de uso **simples, familiar e acessível**, inspirada nas melhores práticas de mensageiros e comunidades modernas, mas com uma arquitetura técnica radicalmente descentralizada:
- **Zero Marcas Proprietárias:** A interface possui identidade original, design tokens próprios (`--cp2p-*`), temas Claro, Escuro e Alto Contraste, sem copiar nomes, logotipos ou ícones de terceiros.
- **Canal Oficial de Avisos Assinado:** Somente administradores com chaves criptográficas Ed25519 conseguem publicar comunicados no canal oficial de Avisos.
- **Canais Abertos para Membros:** Canais colaborativos como `#conversas` e `#suporte` permitem mensagens de membros comuns para debate e ajuda mútua.
- **Imunidade a Bloqueios:** Se o servidor central (VPS) for bloqueado ou desligado, a rede continua operando 100% de forma autônoma através dos computadores dos membros, sem perda de dados ou histórico.

---

## 2. Cadastro Simples e Pseudônimo

O cadastro no sistema foi projetado para ser **instantâneo, descomplicado e seguro**, sem burocracias ou coleta invasiva de dados:

### 2.1. Princípios de Privacidade
- **Pseudonimato:** O usuário escolhe apenas um apelido público (pseudônimo).
- **Sem Coleta de Dados Pessoais:** O sistema **nunca** solicita ou armazena nome real, CPF, telefone, e-mail, endereço residencial ou outros identificadores pessoais.
- **Sem Senha Obrigatória:** Uma chave privada criptográfica Ed25519 e um identificador interno aleatório (`usr_...`) são gerados localmente e protegidos de forma transparente no cofre do dispositivo. A chave privada **nunca** é gravada em texto puro.
- **Transparência sobre Metadados Técnicos:** O sistema explica com clareza ao usuário que o cadastro é pseudônimo, mas que o anonimato absoluto não existe na internet — seu provedor de acesso ainda pode observar metadados de rede, como horários de conexão e volume de tráfego.

### 2.2. Fluxo Passo a Passo
1. Ao abrir o aplicativo ou link de convite (`https://cp2p.democracias.org/join/CR-XXXX`), a tela solicita apenas:
   - **Campo:** *"Escolha um nome de usuário"*
   - **Aviso:** *"Use um apelido. Não informe seu nome real se não quiser."*
   - **Botão:** *"Entrar na comunidade"*
2. **Validação de Unicidade em Tempo Real:**
   - A comparação é case-insensitive (ignora maiúsculas e minúsculas).
   - Nomes reservados (`admin`, `sistema`, `root`, `suporte`, etc.) são bloqueados.
   - Se o nome já estiver em uso, o sistema sugere opções alternativas disponíveis com 1 clique (ex: `viajante_1`, `viajante_p2p`, `viajante_482`).
3. **Criação Imediata:**
   - Ao clicar em *"Entrar na comunidade"*, o perfil é criado instantaneamente.
   - O sistema exibe: **“Usuário criado com sucesso.”**
   - Um **Código de Recuperação Seguro** (ex: `REC-A3F8-K92B-X17D`) é gerado caso o usuário deseje guardar para restaurar o acesso ou vincular outros aparelhos.
4. **Status de Entrada:** O usuário entra como membro ativo imediatamente ou fica pendente caso o convite do administrador exija moderação prévia.

---

## 3. Instalação e Acesso

### Computador (Windows, Linux, macOS)
- **Windows Executável / Instalador:** Execute o script `INSTALAR-WINDOWS.bat` ou inicialize via terminal com `npm start`. O aplicativo inicia o daemon local e abre o navegador automaticamente na porta local `5001`.
- **Linux / macOS:** Execute `npm install` e `npm start`.

### PWA e Navegador de Celular (Android / iOS)
- Acesse `https://cp2p.democracias.org` no Chrome, Firefox ou Safari.
- Clique em **"Adicionar à Tela de Início"** ou **"Instalar Aplicativo"**.
- O PWA funciona em tela cheia (standalone) com suporte a modo offline via Service Worker.

---

## 4. Como Criar e Configurar uma Comunidade

1. No dock lateral esquerdo, clique no botão **`+` (Criar Comunidade)**.
2. Defina o **Nome da Comunidade** e a **Descrição/Objetivo**.
3. Ao clicar em **"Criar Comunidade"**, o sistema automaticamente:
   - Gera a chave simétrica de época AES-256-GCM para cifragem ponta a ponta dos comunicados;
   - Registra seu perfil como **Administrador Gênesis**;
   - Cria os 5 canais padrão da comunidade (`avisos`, `eventos`, `documentos`, `conversas`, `suporte`);
   - Gera o primeiro código de convite amigável de 4 dígitos (`CR-XXXX`) e o respectivo QR Code vetorial.

---

## 5. Como Convidar Membros

Para convidar participantes sem exigir conhecimento técnico de P2P ou chaves:

1. Clique no botão de convite (ícone de compartilhamento no topo da lista de canais) ou acesse o menu de opções.
2. O sistema exibe:
   - **QR Code Vetorial em SVG:** Pode ser escaneado por qualquer câmera de smartphone ou leitor de QR Code.
   - **Código Curto:** No formato amigável `CR-XXXX` (ex: `CR-7842`).
   - **Link Direto:** Ex: `https://cp2p.democracias.org/join/CR-7842`.
3. Clique em **"Copiar Link"** ou **"Compartilhar"** para enviar por qualquer aplicativo.
4. O administrador pode configurar prazo de expiração (ex: 48 horas) e número máximo de utilizações para evitar acessos indevidos.

---

## 6. Vinculação Segura de Novos Dispositivos (Pareamento & QR Code)

Usuários podem acessar seu mesmo pseudônimo em múltiplos dispositivos (celular, tablet ou outro computador) sem precisar de senhas complicadas:

1. No dispositivo principal já autenticado, clique no botão **📱 (Vincular Novo Dispositivo)** no rodapé da barra lateral.
2. O sistema gera instantaneamente:
   - Um **Código de Pareamento Seguro** temporário (ex: `PAIR-8821-9932`), válido por 10 minutos;
   - Um **QR Code Vetorial em SVG** pronto para leitura por câmera de smartphone.
3. No novo dispositivo (celular ou navegador):
   - Abra o link ou aponte a câmera para o QR Code;
   - Ou clique em *"Já tenho um código de recuperação ou pareamento"* na tela inicial e digite o código;
4. O novo dispositivo é autenticado e vinculado com sessão segura criptográfica de forma imediata.
5. **Revogação de Acesso:** No modal de dispositivos, o usuário pode visualizar todas as sessões ativas (Desktop, Celular, Web) e revogar qualquer dispositivo perdido com um clique em **"Revogar"**.

---

## 7. Arquitetura de Canais e Controle de Permissões

Cada comunidade possui múltiplos canais internos separados por finalidade:

| Canal | Ícone | Finalidade | Permissão de Post Padrão |
| :--- | :---: | :--- | :--- |
| **Avisos Oficiais** | 📢 | Comunicados de alta prioridade da coordenação | **Apenas Administradores** (Protegido) |
| **Eventos e Agendas** | 📅 | Datas de reuniões, mobilizações e prazos | **Apenas Administradores** |
| **Documentos e Materiais** | 📁 | Cartilhas, resoluções e arquivos verificados | **Apenas Administradores** |
| **Conversas e Debates** | 💬 | Espaço de interação entre todos os membros | **Aberto para Membros** |
| **Dúvidas e Suporte** | 🤝 | Ajuda mútua e orientações | **Aberto para Membros** |

### Criando Novos Canais
Administradores podem criar canais adicionais clicando no botão **`+` (Criar Novo Canal)** no cabeçalho da barra lateral, podendo escolher nome, ícone, descrição e ativar ou desativar a permissão de post de membros comuns.

---

## 8. Envio de Mensagens, Imagens e Arquivos em Partes (Chunking)

### Envio de Mensagens e Emojis
- Digite seu texto no campo inferior. Pressione `Enter` para enviar ou `Shift + Enter` para quebrar linha.
- Clique no botão `😊` para inserir reações rápidas ou emojis.
- Mensagens longas são acomodadas com expansão suave para preservar a leitura limpa do feed.

### Envio de Arquivos e Imagens
1. **Pelo Botão de Clipe:** Clique no ícone de clipe `📎` e selecione uma imagem ou documento.
2. **Arrastar e Soltar (Drag & Drop):** Arraste o arquivo diretamente da sua área de trabalho para dentro da janela do aplicativo.
3. **Colar da Área de Transferência (Clipboard Paste):** Copie uma imagem e pressione `Ctrl + V` dentro do chat.
4. **Pré-visualização Antes do Envio:** Uma barra exibe o nome e tamanho do anexo antes da confirmação de envio.

### Replicação e Chunking de Arquivos Grandes
- Arquivos pesados são automaticamente fragmentados em **partes de 512 KB (chunks)**.
- Cada fragmento possui um hash SHA-256 verificado individualmente.
- O download pode ser interrompido e retomado sem necessidade de reiniciar do zero.
- Chunks são replicados de múltiplos nós da malha P2P, aliviando a banda de um único nó.
- Executáveis perigosos (`.exe`, `.bat`, `.cmd`, `.sh`, `.vbs`) são **bloqueados na validação**.

---

## 8. Compartilhamento Seguro de Links (SSRF-Safe)

Quando você digita ou cola um link (ex: `https://noticias.org/comunicado`):
- O sistema detecta a URL e exibe o endereço clicável com protocolo seguro.
- Uma pré-visualização automática OpenGraph (título, resumo e miniatura) é gerada.
- **Proteção Estrita contra SSRF:** O serviço de pré-visualização bloqueia automaticamente IPs locais (`127.0.0.1`, `localhost`), redes privadas RFC 1918 (`10.x.x.x`, `192.168.x.x`, `172.16-31.x.x`) e metadados de nuvem (`169.254.169.254`).
- Se a pré-visualização falhar ou o site remoto estiver fora do ar, o envio da mensagem **não é bloqueado**.

---

## 9. Encaminhamento de Conteúdo com Proveniência

Para compartilhar mensagens, imagens ou arquivos entre canais:
1. Passe o mouse sobre a mensagem e clique no botão **Encaminhar (`↪️`)**.
2. No diálogo exibido, selecione o canal de destino (ex: `#conversas` ou `#documentos`).
3. Adicione um comentário contextual opcional.
4. Clique em **"Confirmar e Encaminhar"**.

**Garantias de Integridade:**
- A mensagem exibe a tag **"↪️ Encaminhado de #[Canal Original]"**.
- A assinatura criptográfica do autor original e os hashes dos anexos são preservados.
- Não há duplicação física desnecessária do arquivo na rede: o mesmo hash de conteúdo é referenciado com segurança.

---

## 10. Resiliência Offline e Fila Outbox

A Comunidade Resiliente foi desenhada para funcionar perfeitamente em cenários de conectividade instável:
- **Leitura Offline:** Todas as mensagens, canais e anexos salvos localmente no SQLite permanecem legíveis mesmo sem sinal de internet.
- **Fila Outbox Automática:** Se você enviar uma mensagem quando estiver desconectado, ela é gravada na tabela `outbox_pending`.
- Um banner amarelo no topo informa: `📤 X mensagem(ns) aguardando envio na fila offline local`.
- **Sincronização Automática (`flushOutbox`):** Assim que a conexão com outros nós P2P ou com a rede retornar, o sistema esvazia a fila e transmite os comunicados automaticamente. Você também pode forçar o envio imediato clicando no botão **"Sincronizar Agora"**.

---

## 11. Interpretação do Status da Rede P2P

No topo do aplicativo e na barra lateral, os seguintes indicadores informam o estado de conexão:

| Indicador | Significado | O que está acontecendo? |
| :---: | :--- | :--- |
| 🟢 **Online (P2P + VPS)** | Conexão plena | O nó está conectado ao bootstrap e a múltiplos outros nós da malha. |
| 🟡 **Modo Autônomo / Relay** | Resiliência Ativa | A VPS caiu ou está inacessível. Os computadores dos membros estão sincronizando diretamente entre si. |
| 🔴 **Modo Offline** | Sem pares na rede | O dispositivo está sem sinal de rede. Operando exclusivamente a partir do cache local SQLite. |

Administradores podem clicar no botão **"Visão da Comunidade"** para abrir o painel de telemetria completa com listagem de endereços de nós, tipos de NAT (STUN RFC 5389), termo de consenso e eventos técnicos.

---

## 12. Notificações e Silenciamento por Canal

O sistema despacha notificações push compatíveis com Desktop, PWA e Android:
- **Eventos Notificados:** Nova mensagem, novo arquivo, novo link compartilhado, mensagem fixada, resposta recebida e avisos de queda ou restauração de rede.
- **Zero-Knowledge Rigoroso:** O gateway de push de terceiros (Google FCM, Apple APNs, Mozilla) recebe apenas metadados genéricos (ex: `Novo comunicado em #Avisos Oficiais`). O conteúdo confidencial da mensagem **nunca** é enviado em texto claro.
- **Silenciamento por Canal:** Membros podem silenciar notificações de canais muito movimentados (ex: `#conversas`) sem perder os comunicados urgentes do canal `#avisos`.

---

## 13. Gestão de Cotas de Armazenamento por Nó

Para que computadores com pouco espaço em disco possam participar sem sobrecarga, cada nó pode escolher sua política de armazenamento no menu **"Armazenamento"**:

1. **Armazenar Tudo (`all`):** Guarda mensagens de texto, imagens e arquivos completos. Ideal para nós servidores ou computadores com bastante espaço.
2. **Mensagens e Imagens (`messages_images`):** Guarda textos e miniaturas de imagens, baixando arquivos pesados somente quando o usuário solicitar.
3. **Apenas Mensagens de Texto (`messages_only`):** Não persiste chunks de arquivos pesados, economizando espaço em disco ao máximo.
4. **Sem Conteúdo Persistente (`no_persistence`):** Opera apenas com histórico temporário.

---

## 14. Segurança Criptográfica e Privacidade

- **Criptografia Ponta a Ponta (E2EE):** AES-256-GCM autenticado com vetores de inicialização (IV) de 12 bytes e tags de autenticação de 16 bytes.
- **Assinaturas Digitais Imutáveis:** Ed25519 em cada comunicado. Mensagens adulteradas em trânsito são sumariamente descartadas.
- **Cofre Local Protegido:** A chave privada do usuário é guardada no SQLite cifrada com derivação de chave **PBKDF2 (100.000 iterações)** e salt aleatório de 16 bytes.
- **Trilha de Auditoria SHA-256:** Todas as ações administrativas (criação de canais, convites, rotação de chaves) são encadeadas em uma blockchain local de auditoria que valida a integridade contínua do histórico.

---

## 15. Recuperação Comprovada após Queda da VPS

A resiliência da plataforma não é teórica: ela é **comprovada através de testes reais automatizados**:
- Durante a simulação (`scripts/simulate_vps_kill.js`), o servidor central VPS é **desligado abruptamente**.
- Os nós clientes detectam a perda de conexão com o bootstrap em menos de 3 segundos.
- Automaticamente, os nós consultam a lista de computadores conhecidos no cache persistente do SQLite local.
- Estabelecem conexões diretas P2P via WebSocket/TCP.
- Executam o algoritmo de consenso Raft-lite e elegem um novo líder coordenador.
- Novos comunicados oficiais são transmitidos, assinados e decifrados em todos os computadores dos membros com **zero dependência do servidor central**.

---

## 16. Backup e Restauração

- **Criar Backup:** No painel de administração, clique em **"Backup"**. O sistema exporta um pacote JSON contendo todas as comunidades, canais, mensagens assinadas, reações, convites e logs de auditoria.
- **Restaurar Comunidade:** Em caso de troca de computador ou reinstalação, use a opção **"Restaurar Backup"** para reinjetar o histórico no SQLite local sem perder nenhuma validação criptográfica.

---

*Comunidade Resiliente — Comunicação P2P verdadeiramente livre, segura e imune a quedas de servidor.*
