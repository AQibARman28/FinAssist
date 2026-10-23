# Node 22 LTS (supported to April 2027). Node 20 left support in April 2026.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the source owned by the unprivileged `node` user that the image ships,
# and run as that user so a compromised dependency doesn't land as root.
COPY --chown=node:node . .
USER node

EXPOSE 5000

CMD ["node", "index.js"]
