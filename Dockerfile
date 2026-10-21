FROM node:24-slim
WORKDIR /app
COPY server.js index.html style.css app.js ./
ENV NODE_ENV=production TRUST_PROXY=1 PORT=8080 DB_PATH=/data/hawkbet.db
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "server.js"]
