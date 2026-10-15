# Guia de Implantação em Produção: https://cp2p.democracias.org 🚀🔒

> **Manual de Operação, Configuração de Domínio, DNS, TLS e Proxy Reverso**

Este documento detalha o procedimento formal para disponibilizar a plataforma **Comunidade Resiliente** no domínio oficial **`https://cp2p.democracias.org`**.

---

## 📋 Ações Manuais Necessárias Antes da Publicação

Para que a rede entre em operação no domínio oficial pela primeira vez, as seguintes ações dependem de acesso externo aos serviços de registro e hospedagem:

| # | Ação Manual | Onde Realizar | Descrição |
| :---: | :--- | :--- | :--- |
| **1** | **Apontar o Registro DNS (Tipo A / AAAA)** | Painel de DNS do domínio `democracias.org` (ex: Cloudflare, Registro.br) | Criar entrada `A` com nome `cp2p` apontando para o IP público da sua VPS. |
| **2** | **Liberar Portas no Firewall da Nuvem** | Painel do Provedor da VPS (AWS, DigitalOcean, Hetzner, Oracle) | Liberar conexões de entrada nas portas `80/tcp` (HTTP) e `443/tcp` (HTTPS/WSS). |
| **3** | **Copiar e Ajustar o Arquivo `.env`** | No servidor VPS (`/opt/comunidade-resiliente/.env`) | Definir `NODE_ENV=production` e confirmar `APP_DOMAIN=cp2p.democracias.org`. |
| **4** | **Subir os Contêineres de Produção** | Terminal SSH da VPS | Executar `docker compose -f docker-compose.prod.yml up -d --build`. |
| **5** | **Validar Certificado e Health Check** | Navegador ou terminal | Acessar `https://cp2p.democracias.org/health` e verificar status `HEALTHY`. |

---

## 1. Configuração do DNS

No painel de gerenciamento de DNS da zona `democracias.org`, adicione os seguintes registros:

### Registro IPv4 Principal (Obrigatório)
```text
Tipo:     A
Nome:     cp2p
Valor:    <IP_PUBLICO_DA_VPS>
TTL:      Auto (ou 300 segundos para propagação rápida)
Proxy:    DNS Only (ou Cloudflare com Full Strict SSL / WebSocket ativado)
```

### Registro IPv6 (Opcional, se sua VPS possuir IPv6)
```text
Tipo:     AAAA
Nome:     cp2p
Valor:    <IPV6_DA_VPS>
TTL:      Auto
```

### Registros Opcionais para Infraestrutura Dedicada
Caso deseje separar o tráfego de bootstrap e relay em subdomínios dedicados:
```text
Tipo:     CNAME
Nome:     bootstrap.cp2p
Valor:    cp2p.democracias.org

Tipo:     CNAME
Nome:     relay.cp2p
Valor:    cp2p.democracias.org
```

> [!WARNING]
> Substitua `<IP_PUBLICO_DA_VPS>` pelo endereço IPv4 real fornecido pelo provedor da sua VPS (ex: `198.51.100.25`). Não utilize endereços locais como `127.0.0.1` ou `192.168.x.x`.

---

## 2. Preparação do Servidor VPS (Linux Ubuntu/Debian)

### 2.1. Atualização e Instalação do Docker
Acesse sua VPS via SSH e execute:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw

# Instalar Docker Engine e Docker Compose Plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### 2.2. Configuração do Firewall (UFW)
Apenas as portas estritamente necessárias devem ser expostas publicamente:
```bash
# Permitir SSH (ajuste a porta se usar porta personalizada)
sudo ufw allow 22/tcp

# Permitir tráfego Web e TLS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp # Suporte a HTTP/3 QUIC

# Ativar o firewall
sudo ufw enable
sudo ufw status
```

> [!NOTE]
> As portas internas da aplicação (`5001`, `6001`, `4001`) **não devem ser abertas no firewall**. Elas comunicam-se exclusivamente dentro da rede virtual isolada do Docker (`mesh-net`).

---

## 3. Implantação com Docker Compose e Caddy (Recomendado)

O **Caddy** gerencia a emissão e renovação automática de certificados SSL/TLS da Let's Encrypt / ZeroSSL, além de redirecionar automaticamente todo o tráfego HTTP para HTTPS.

### 3.1. Clonar o Repositório no Servidor
```bash
cd /opt
sudo git clone https://github.com/seu-repositorio/comunidade-resiliente.git
cd comunidade-resiliente
sudo chown -R $USER:$USER .
```

### 3.2. Configurar o `.env` de Produção
```bash
cp .env.example .env
nano .env
```
Certifique-se de que as variáveis de produção estão ativas:
```env
APP_DOMAIN=cp2p.democracias.org
APP_URL=https://cp2p.democracias.org
PUBLIC_URL=https://cp2p.democracias.org
API_URL=https://cp2p.democracias.org/api
WS_URL=wss://cp2p.democracias.org
BOOTSTRAP_URL=https://cp2p.democracias.org
BOOTSTRAP_WS_URL=wss://cp2p.democracias.org
PUBLIC_BOOTSTRAP_ADDRESS=wss://cp2p.democracias.org
NODE_ENV=production
```

### 3.3. Iniciar os Serviços de Produção
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

O Caddy detectará automaticamente a configuração de `cp2p.democracias.org`, solicitará o certificado TLS e iniciará o proxy reverso seguro.

---

## 4. Implantação Alternativa com Nginx e Certbot

Se você preferir utilizar Nginx gerenciado diretamente no sistema operacional da VPS:

### 4.1. Instalação do Nginx e Certbot
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 4.2. Instalação da Configuração
Copie o arquivo fornecido no projeto:
```bash
sudo cp deploy/nginx/cp2p.democracias.org.conf /etc/nginx/sites-available/cp2p.democracias.org.conf
sudo ln -s /etc/nginx/sites-available/cp2p.democracias.org.conf /etc/nginx/sites-enabled/
```

### 4.3. Emissão do Certificado SSL com Certbot
```bash
sudo certbot --nginx -d cp2p.democracias.org
```

### 4.4. Teste e Recarregamento do Nginx
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 5. Verificação e Teste de Funcionamento

Após a implantação, execute os seguintes comandos de verificação:

### 5.1. Teste de Redirecionamento HTTP -> HTTPS
```bash
curl -I http://cp2p.democracias.org/
```
**Resposta esperada:** `HTTP/1.1 301 Moved Permanently` apontando para `https://cp2p.democracias.org/`.

### 5.2. Teste do Endpoint de Saúde (Health Check)
```bash
curl -s https://cp2p.democracias.org/health
```
**Resposta esperada:**
```json
{
  "status": "HEALTHY",
  "version": "1.1.0",
  "domain": "cp2p.democracias.org",
  "https": true,
  "uptimeSeconds": 45,
  "database": "CONNECTED",
  "bootstrap": {
    "status": "CONNECTED",
    "activePeers": 1
  }
}
```

### 5.3. Teste de WebSocket Seguro (WSS)
Abra o navegador em `https://cp2p.democracias.org`. No console de desenvolvedor (F12), verifique a conexão:
```text
[Comunidade Resiliente] Conectando WebSocket Seguro em: wss://cp2p.democracias.org/live
[Comunidade Resiliente] Conectado ao daemon via WebSocket seguro.
```

### 5.4. Teste de Instalação do PWA
1. Acesse `https://cp2p.democracias.org` no Google Chrome, Brave ou Edge;
2. Observe o ícone de instalação de aplicativo na barra de navegação;
3. No smartphone Android/iOS, clique em **"Adicionar à Tela de Início"**;
4. O app será instalado com o nome **"Comunidade Resiliente"** e escopo fixado em `https://cp2p.democracias.org/`.

---

## 6. Solução de Problemas (Troubleshooting)

### Certificado TLS Não Emite:
- **Causa:** O DNS ainda não propagou ou a porta 80/443 está bloqueada no firewall da nuvem.
- **Solução:** Verifique `dig +short cp2p.democracias.org` e certifique-se de que o IP retornado é o da sua VPS. Verifique se o UFW ou Security Group libera a porta 80.

### Erro "WebSocket Connection Failed":
- **Causa:** O proxy reverso não está encaminhando os cabeçalhos `Upgrade` e `Connection`.
- **Solução:** No Caddy, a diretiva `reverse_proxy` já suporta WebSockets nativamente. No Nginx, confirme que o bloco `map $http_upgrade $connection_upgrade` está presente no arquivo `nginx.conf`.

### Queda da VPS / Domínio Fora do Ar:
- **Comportamento Esperado:** Os computadores desktop dos membros que já possuíam a chave da comunidade continuam sincronizando diretamente entre si via P2P local e cache SQLite. O painel exibirá `VPS: Offline (Malha Ativa)`, e novos comunicados assinados continuarão sendo propagados de computador a computador.
