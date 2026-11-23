FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm install --omit=dev --no-audit --no-fund || echo "Módulo opcional do WhatsApp não instalado"
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server.js"]
