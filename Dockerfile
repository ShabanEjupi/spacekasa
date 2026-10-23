FROM node:22-slim
# No npm install: the app has zero dependencies.
WORKDIR /app
# Explicit list, not `COPY . .`, so no .env or data file can ever land in the image.
COPY server.mjs supplier.mjs a2a.mjs qr.mjs audit.mjs mandate.mjs forecast.mjs negotiate.mjs procure.mjs catalog.json supplies.json supplier.json ./
COPY public ./public
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "server.mjs"]
