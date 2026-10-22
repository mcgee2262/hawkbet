FROM node:24-slim
WORKDIR /app
COPY server.js index.html style.css app.js logo.svg hawk.svg rocket.svg reset-password.js ./
ENV NODE_ENV=production TRUST_PROXY=1 PORT=8080 DB_PATH=/data/hawkbet.db
RUN mkdir -p /data && chown -R node:node /data /app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Fly mounts the volume at /data owned by root: hand it to the unprivileged node user, then run the server as node
CMD ["sh", "-c", "chown -R node:node /data && exec setpriv --reuid=node --regid=node --init-groups node --no-warnings server.js"]
