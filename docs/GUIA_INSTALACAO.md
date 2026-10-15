# Guia de Instalação e Uso: Comunidade Resiliente

Este guia orienta a instalação e execução do sistema **Comunidade Resiliente** para usuários comuns, desenvolvedores e operadores de infraestrutura.

---

## 1. Requisitos do Sistema

- **Sistemas Operacionais Homologados:** Windows 10/11, macOS (Intel ou Apple Silicon), Linux (Ubuntu, Debian, Fedora, Arch).
- **Ambiente de Execução:** Node.js v20+ ou v22/v24 (inclui SQLite nativo sem compilações externas).
- **Opcional:** Docker e Docker Compose (para ambientes isolados em containers).

---

## 2. Instalação Rápida (Usuários Comuns)

### Passo 1: Obter o Código
Abra seu terminal e clone ou descompacte o projeto:
```bash
git clone <url-do-repositorio> comunidade-resiliente
cd comunidade-resiliente
```

### Passo 2: Instalar Dependências
```bash
npm install
```

### Passo 3: Iniciar o Nó Pessoal Desktop
Para iniciar o nó no seu computador e abrir a interface no navegador:
```bash
npm start
```
O sistema inicializará o nó P2P local, carregará o banco de dados criptografado e abrirá automaticamente seu navegador em `http://localhost:5001`.

---

## 3. Instalação e Uso no Celular (PWA)

1. Certifique-se de que o nó P2P está rodando no computador da mesma rede Wi-Fi ou com túnel HTTPS (ex: Cloudflare Tunnel / Tailscale).
2. Abra o navegador do celular (Chrome no Android ou Safari no iOS).
3. Acesse o endereço IP local do nó (ex: `http://192.168.1.100:5001`).
4. Toque no menu do navegador e selecione **"Adicionar à Tela de Início"** ou **"Instalar Aplicativo"**.
5. O aplicativo funcionará com aparência nativa (sem barra de navegação), recebendo notificações e permitindo acesso offline ao histórico.

---

## 4. Demonstração Local com Cluster Multi-Nós

Para testar a interação entre múltiplos computadores em uma única máquina, utilize o script de cluster pré-configurado:
```bash
npm run cluster
```
Este comando inicializa simultaneamente:
- **1 Servidor VPS de Descoberta:** Porta 4001
- **Nó 1 (Alice - Administradora):** `http://localhost:5001` (Pode publicar e gerenciar)
- **Nó 2 (Bob - Moderador):** `http://localhost:5002` (Pode gerenciar usuários e visualizar)
- **Nó 3 (Carlos - Membro):** `http://localhost:5003` (Somente leitura e retransmissão P2P)

Abra as três abas no navegador para observar comunicados publicados por Alice aparecendo em tempo real nas telas de Bob e Carlos via P2P!

---

## 5. Simulação Automatizada de Queda da VPS

Para comprovar a resiliência do sistema e a imunidade à derrubada do servidor central, execute:
```bash
npm run simulate:kill
```

### O que o teste executa automaticamente:
1. Sobe a VPS e 3 nós independentes.
2. Publica o Comunicado #1 enquanto a VPS está ativa.
3. **Desliga abruptamente a VPS central.**
4. Os nós detectam a ausência da VPS e **elegem um novo nó líder local**.
5. O Administrador publica o Comunicado #2 **com a VPS desligada**.
6. Os membros recebem o comunicado diretamente através da malha P2P pessoal.
7. Testa e rejeita tentativas de falsificação por não-administradores.
8. Testa a rotação de chaves criptográficas (Key Rotation).

---

## 6. Execução dos Testes Unitários e de Integração

Para rodar a bateria completa de 16 testes automatizados (criptografia Ed25519, AES-256-GCM, SQLite, consenso e privacidade):
```bash
npm test
```

---

## 7. Execução com Docker Compose

Para rodar o ambiente completo com containers Docker isolados:
```bash
docker compose up --build
```

Endpoints expostos nos containers:
- **VPS Bootstrap:** `ws://localhost:4001`
- **Nó Alice (Admin):** `http://localhost:5001`
- **Nó Bob (Moderador):** `http://localhost:5002`
- **Nó Carlos (Membro):** `http://localhost:5003`

Para desligar a VPS no Docker e testar a resiliência:
```bash
docker stop vps-bootstrap
```
Os nós `node-alice-admin`, `node-bob-moderador` e `node-carlos-membro` continuarão funcionando e sincronizando mensagens entre si pela rede interna P2P!
