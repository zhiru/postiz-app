#!/usr/bin/env bash
# Runnable check for watchdog.sh: it must kill an app that never answers on its
# port and leave an app that answers alone. Run: bash var/docker/watchdog.test.sh
dir=$(cd "$(dirname "$0")" && pwd)
alive() { local s; s=$(awk '{print $3}' "/proc/$1/stat" 2>/dev/null); [ -n "$s" ] && [ "$s" != Z ]; }

bash -c 'exec -a fake-hung-app/main.js sleep 60' &
hung=$!
python3 -m http.server 38402 --bind 127.0.0.1 > /dev/null 2>&1 &
ok=$!
sleep 1

WATCHDOG_INTERVAL=1 WATCHDOG_FAILS=2 WATCHDOG_APPS="hung 38401 fake-hung-app/main\.js
ok 38402 http\.server 38402" bash "$dir/watchdog.sh" > /dev/null &
watchdog=$!
sleep 6

status=0
alive "$hung" && { echo "FAIL: the app that never answers is still running"; status=1; }
alive "$ok" || { echo "FAIL: the app that answers was killed"; status=1; }
kill "$watchdog" "$ok" "$hung" 2> /dev/null
[ "$status" = 0 ] && echo "watchdog test passed"
exit "$status"
