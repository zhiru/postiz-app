#!/usr/bin/env bash
# pm2 only watches the pnpm wrapper of each app, so a node process that hangs
# on boot (never binds its port) stays "online" forever. When an app does not
# answer on its port for WATCHDOG_FAILS checks in a row, kill its processes and
# let pm2 start it again.
INTERVAL=${WATCHDOG_INTERVAL:-30}
FAILS=${WATCHDOG_FAILS:-6}
# one app per line: <name> <port> <regex matching its command lines>
APPS=${WATCHDOG_APPS:-"backend ${PORT:-3000} apps/backend/src/main\.js
orchestrator ${ORCHESTRATOR_PORT:-3002} apps/orchestrator/src/main\.js
frontend 4200 next start|next-server"}

answers() {
  timeout 10 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1 && printf 'GET / HTTP/1.0\r\n\r\n' >&3 && head -c 5 <&3 | grep -q HTTP" 2>/dev/null
}

kill_app() {
  local d c
  for d in /proc/[0-9]*; do
    c=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null) || continue
    [[ $c =~ $1 ]] && kill -9 "${d#/proc/}" 2>/dev/null
  done
}

declare -A fails
while sleep "$INTERVAL"; do
  while read -r name port re; do
    [ -z "$name" ] && continue
    if answers "$port"; then
      fails[$name]=0
      continue
    fi
    fails[$name]=$((${fails[$name]:-0} + 1))
    if [ "${fails[$name]}" -ge "$FAILS" ]; then
      echo "$(date -u +%FT%TZ) watchdog: $name did not answer on port $port for $((FAILS * INTERVAL))s, killing it so pm2 restarts it"
      kill_app "$re"
      fails[$name]=0
    fi
  done <<< "$APPS"
done
