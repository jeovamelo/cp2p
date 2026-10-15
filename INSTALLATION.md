# Manual de Instalação e Uso: Comunidade Resiliente

Bem-vindo ao **Comunidade Resiliente**, uma plataforma descentralizada P2P de comunicação comunitária desenhada para continuar operando mesmo se servidores centrais ou VPSs forem completamente desligados ou bloqueados.

---

## 1. Requisitos de Sistema

- **Sistema Operacional:** Windows 10/11, macOS (Intel ou Apple Silicon) ou Linux (Ubuntu, Debian, Fedora, Arch, etc.).
- **Ambiente de Execução:** Node.js v22.5.0 ou superior (já inclui motor nativo SQLite).
- **Navegador Web:** Google Chrome, Brave, Microsoft Edge, Firefox ou Safari (com suporte a PWA e WebSockets).
- **Opcional:** Docker e Docker Compose (para implantação conteinerizada).

---

## 2. Instalação com 1 Clique (Para Usuários Leigos / Sem Terminal)

Para disponibilizar o sistema para pessoas comuns sem necessidade de conhecimento técnico:

### 🪟 No Windows (Recomendado):
1. Baixe ou descompacte a pasta do projeto.
2. Dê um **duplo-clique no arquivo `INSTALAR-WINDOWS.bat`**.
3. O instalador cuidará de tudo automaticamente:
   - Configura os arquivos em `%LocalAppData%\ComunidadeResiliente`.
   - Detecta o Node.js ou baixa o motor autônomo portátil se necessário.
   - Cria o atalho **"Comunidade Resiliente"** diretamente na sua **Área de Trabalho**.
   - Adiciona a aplicação ao **Menu Iniciar** do Windows.
   - Cria o **Desinstalador** automático.
   - Inicia o nó P2P em segundo plano (sem janela preta de prompt) e abre o navegador automaticamente!

### 🐧 No Linux ou 🍎 macOS:
Abra o terminal na pasta e execute:
```bash
./install.sh
```
O atalho `.desktop` será criado automaticamente no seu menu de aplicativos.

---

## 3. Instalação Manual para Desenvolvedores

### 3.1. Clonar ou Baixar o Repositório
```bash
git clone https://github.com/seu-usuario/comunidade-resiliente.git
cd comunidade-resiliente
```

### 3.2. Instalar as Dependências
```bash
npm install
```

## 3. Modos de Execução

### Modo A: Executar o Cluster de Demonstração (Recomendado para Testes)
Inicia automaticamente 1 Servidor Bootstrap (VPS) e 3 Nós P2P locais em portas isoladas:
- **VPS Bootstrap:** porta `4001`
- **Nó Alice (Administradora):** `http://localhost:5001` (P2P: `6001`)
- **Nó Bob (Moderador):** `http://localhost:5002` (P2P: `6002`)
- **Nó Carlos (Membro):** `http://localhost:5003` (P2P: `6003`)

Execute no terminal:
```bash
npm run cluster
```
O navegador abrirá automaticamente em `http://localhost:5001`.

---

### Modo B: Simulação Automática de Queda da VPS (Failover Test)
Demonstra em tempo real a resiliência do sistema:
1. Inicia a VPS e 3 nós.
2. Publica comunicado oficial com VPS ativa.
3. **Desliga abruptamente a VPS central.**
4. Os nós remanescentes elegem um novo líder descentralizado.
5. Publica um novo comunicado de emergência com a VPS 100% morta.
6. Todos os nós recebem, decifram e validam a mensagem via P2P direta.

Para rodar a simulação:
```bash
npm run simulate:kill
```

---

### Modo C: Executar Apenas o Seu Nó Desktop Pessoal
Para rodar no seu computador conectando a uma comunidade existente:
```bash
# Como Membro Comum:
npm start

# Ou especificando seu papel e porta:
HTTP_PORT=5001 P2P_PORT=6001 ROLE=Administrador npm start
```
No Windows PowerShell:
```powershell
$env:HTTP_PORT="5001"; $env:P2P_PORT="6001"; $env:ROLE="Administrador"; npm start
```

---

### Modo D: Execução com Docker Compose
Para subir o ambiente completo em contêineres isolados:
```bash
docker compose up --build
```
Acesse a interface de Alice em `http://localhost:5001`, Bob em `http://localhost:5002` e Carlos em `http://localhost:5003`.

---

## 4. Guia de Uso da Interface Web / PWA

### 4.1. Publicando Comunicados (Apenas Administradores)
1. Acesse `http://localhost:5001` (Nó da Administradora Alice).
2. Na parte inferior, observe a barra de composição ativa.
3. Digite o comunicado desejado.
4. (Opcional) Clique em **"Anexar Imagem"** para carregar uma imagem ou foto.
5. Clique em **"Publicar Comunicado Assinado"**.
6. A mensagem é assinada com sua chave privada Ed25519, cifrada com AES-256-GCM e disseminada na malha P2P.

### 4.2. Leitura por Membros e Moderadores
1. Abra uma nova aba anônima ou navegador em `http://localhost:5002` (Bob) ou `http://localhost:5003` (Carlos).
2. Observe que a barra de envio de mensagens é bloqueada: *"Canal Oficial Unidirecional: Apenas administradores com chave privada autorizada podem publicar"*.
3. O comunicado enviado por Alice aparece instantaneamente na tela, com selo de verificação criptográfica.

### 4.3. Teste Manual de Queda da VPS
1. No terminal do cluster ou no container da VPS, encerre o processo com `CTRL+C` ou pare o container `vps-bootstrap`.
2. No navegador, o indicador no topo mudará para `VPS: Offline` e um alerta amarelo surgirá informando a ativação da malha autônoma.
3. Na interface da Administradora, envie uma nova mensagem.
4. Vá para a aba do Membro: **a mensagem chegará normalmente**, transmitida diretamente de nó para nó através da malha P2P!

### 4.4. Instalando como PWA no Celular ou Desktop
1. No Google Chrome ou Edge, clique no ícone de computador/celular na barra de endereços: **"Instalar Comunidade Resiliente"**.
2. No celular (Android/iOS), clique em **"Compartilhar"** > **"Adicionar à Tela de Início"**.
3. O aplicativo funcionará em janela própria e receberá notificações locais.

---

## 5. Testes Automatizados Unitários e de Integração

Para executar a bateria de testes criptográficos, banco SQLite, consistência de DAG e eleição:
```bash
npm test
```
Todos os 16 testes devem passar com `0` falhas.
