#!/bin/zsh
# Double-click (Mac) to start HawkBet and open it in your browser. Close this window to stop it.
source ~/.nvm/nvm.sh >/dev/null 2>&1
cd "$(dirname "$0")" || exit 1
if ! curl -s http://localhost:8622/healthz >/dev/null; then
  node --no-warnings server.js &
  sleep 1.5
fi
open http://localhost:8622
echo "HawkBet is running at http://localhost:8622  (close this window to stop it)"
wait
