FROM node:22-alpine

WORKDIR /app

# Instala dependências do projeto
COPY package*.json ./
RUN npm install --production

# Copia código-fonte e arquivos da interface web
COPY src/ ./src/
COPY scripts/ ./scripts/

# Diretório para armazenamento local do SQLite
RUN mkdir -p /data

EXPOSE 4001 5001 5002 5003 6001 6002 6003

CMD ["node", "src/desktop/desktop_runner.js"]
