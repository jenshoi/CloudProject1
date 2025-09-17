

set -euo pipefail

API_URL="${API_URL:-http://localhost:3000/videos/analyze}"
TOKEN="${TOKEN:-SETT_INN_DITT_JWT_HER}"
VIDEO_FILE="${VIDEO_FILE:-test.mp4}"

DURATION="${DURATION:-300}"   # sekunder
VCPUS=$(nproc 2>/dev/null || echo 2)
DEFAULT_CONC=$(( VCPUS * 4 ))
CONCURRENCY="${CONCURRENCY:-$DEFAULT_CONC}"   # startverdi
TARGET_CPU="${TARGET_CPU:-80}"                # mål i prosent

if [[ ! -f "$VIDEO_FILE" ]]; then
  echo "[!] Fant ikke video-fila: $VIDEO_FILE" >&2
  exit 1
fi

echo "Starter CPU load test mot $API_URL"
echo "Varighet: ${DURATION}s, Start samtidighet: ${CONCURRENCY}, vCPU: ${VCPUS}, Target CPU: ${TARGET_CPU}%"

END=$((SECONDS + DURATION))
sent=0

trap 'echo; echo "[!] Avbrutt, rydder opp…"; kill 0 2>/dev/null || true' INT TERM


cpu_usage_percent() {
  read cpu a b c d e f g h i j < /proc/stat
  idle1=$d; total1=$((a+b+c+d+e+f+g+h+i+j))
  sleep 1
  read cpu a b c d e f g h i j < /proc/stat
  idle2=$d; total2=$((a+b+c+d+e+f+g+h+i+j))
  idle=$((idle2-idle1)); total=$((total2-total1))
  busy=$(( (1000*(total-idle)/total + 5)/10 ))
  echo "$busy"
}

launch_one () {
  local nonce ts
  ts=$(date +%s%N)
  nonce="n${ts}r$RANDOM"

  curl -sS -X POST "$API_URL" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Connection: keep-alive" \
    -H "Expect:" \
    --http1.1 \
    --max-time 30 \
    -F "video=@${VIDEO_FILE};type=video/mp4;filename=${nonce}.mp4" \
    -F "nonce=${nonce}" \
    -o /dev/null
}

# Bakgrunnsjobb: juster samtidighet hver 10s basert på CPU
(
  while (( SECONDS < END )); do
    usage=$(cpu_usage_percent)
    if (( usage < TARGET_CPU )); then
      CONCURRENCY=$((CONCURRENCY + VCPUS))
      echo "[AUTOTUNE] CPU=${usage}% < ${TARGET_CPU}%, øker samtidighet til ${CONCURRENCY}"
    fi
  done
) &

# Hovedlast
while (( SECONDS < END )); do
  while (( $(jobs -r | wc -l) >= CONCURRENCY )); do
    sleep 0.01
  done

  launch_one &
  ((sent++))

  if (( sent % (CONCURRENCY/2 + 1) == 0 )); then
    active=$(jobs -r | wc -l)
    printf "\r[Tid igjen %ds] Sent=%d Active=%d (Conc=%d)" "$((END-SECONDS))" "$sent" "$active" "$CONCURRENCY"
  fi
done

wait
echo -e "\nLoad test ferdig. Totalt sendt: $sent"

