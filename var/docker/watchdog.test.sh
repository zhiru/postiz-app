#!/usr/bin/env bash
# Runnable check for watchdog.sh: it must kill an app that never answers on its
# port and is idle (hung), and leave alone an app that answers and an app that
# does not answer yet but is busy (slow boot). Run: bash var/docker/watchdog.test.sh
dir=$(cd "$(dirname "$0")" && pwd)
alive() { local s; s=$(awk '{print $3}' "/proc/$1/stat" 2>/dev/null); [ -n "$s" ] && [ "$s" != Z ]; }

bash -c 'exec -a fake-hung-app/main.js sleep 60' &
hung=$!
bash -c 'exec -a fake-busy-app/main.js bash -c "while :; do :; done"' &
busy=$!
python3 -m http.server 38402 --bind 127.0.0.1 > /dev/null 2>&1 &
ok=$!
sleep 1

WATCHDOG_INTERVAL=1 WATCHDOG_FAILS=2 WATCHDOG_APPS="hung 38401 fake-hung-app/main\.js
busy 38403 fake-busy-app/main\.js
ok 38402 http\.server 38402" bash "$dir/watchdog.sh" > /dev/null &
watchdog=$!
sleep 7

status=0
alive "$hung" && { echo "FAIL: the hung app (no answer, idle) is still running"; status=1; }
alive "$busy" || { echo "FAIL: the busy app (slow boot) was killed"; status=1; }
alive "$ok" || { echo "FAIL: the app that answers was killed"; status=1; }
kill "$watchdog" "$ok" "$hung" "$busy" 2> /dev/null
[ "$status" = 0 ] && echo "watchdog test passed"
exit "$status"
