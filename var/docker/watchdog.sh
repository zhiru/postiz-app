#!/usr/bin/env bash
# pm2 only watches the pnpm wrapper of each app, so a node process that hangs
# (e.g. deadlocked on boot, never binding its port) stays "online" forever.
# When an app does not answer on its port for WATCHDOG_FAILS checks in a row
# AND its processes used no CPU since the last check (hung, not just slow),
# kill them and let pm2 start the app again.
INTERVAL=${WATCHDOG_INTERVAL:-30}
FAILS=${WATCHDOG_FAILS:-6}
ENV_FILE=${WATCHDOG_ENV_FILE:-/app/.env}

# same value the app sees: process env first, then the .env it loads via dotenv
setting() {
  local v=${!1}
  [ -z "$v" ] && [ -f "$ENV_FILE" ] && v=$(grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d "\"' \r")
  echo "${v:-$2}"
}

# one app per line: <name> <port> <regex matching its command lines>
APPS=${WATCHDOG_APPS:-"backend $(setting PORT 3000) apps/backend/src/main\.js
orchestrator $(setting ORCHESTRATOR_PORT 3002) apps/orchestrator/src/main\.js
frontend 4200 next start|next-server"}

answers() {
  timeout 10 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1 && printf 'GET / HTTP/1.0\r\n\r\n' >&3 && head -c 5 <&3 | grep -q HTTP" 2>/dev/null
}

# pids whose command line matches the regex
pids_of() {
  local d c
  for d in /proc/[0-9]*; do
    c=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null) || continue
    [[ $c =~ $1 ]] && echo "${d#/proc/}"
  done
}

# total CPU ticks (utime + stime) used by the pids
cpu_of() {
  local p t=0
  for p in "$@"; do
    t=$((t + $(awk '{print $14 + $15}' "/proc/$p/stat" 2>/dev/null || echo 0)))
  done
  echo "$t"
}

declare -A fails cpu
while sleep "$INTERVAL"; do
  while read -r name port re; do
    [ -z "$name" ] && continue
    if answers "$port"; then
      fails[$name]=0
      continue
    fi
    pids=$(pids_of "$re")
    now=$(cpu_of $pids)
    fails[$name]=$((${fails[$name]:-0} + 1))
    # still burning CPU = slow boot, not a hang: wait
    if [ "$now" != "${cpu[$name]}" ]; then
      cpu[$name]=$now
      [ "${fails[$name]}" -ge "$FAILS" ] && fails[$name]=$((FAILS - 1))
      continue
    fi
    if [ "${fails[$name]}" -ge "$FAILS" ]; then
      echo "$(date -u +%FT%TZ) watchdog: $name did not answer on port $port for $((FAILS * INTERVAL))s and is idle, killing it so pm2 restarts it"
      [ -n "$pids" ] && kill -9 $pids 2>/dev/null
      fails[$name]=0
      cpu[$name]=
    fi
  done <<< "$APPS"
done
