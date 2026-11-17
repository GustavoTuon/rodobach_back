FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .

ENV NODE_ENV=production
# The container is reached through the Easypanel reverse proxy, not a public port.
ENV TRUST_PROXY_HOPS=1
EXPOSE 3333
USER node

CMD ["npm", "start"]
