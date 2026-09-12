#!/usr/bin/env bash
# API smoke test for the chat worker.
# Requires: wrangler dev on :8787 (worker/.dev.vars points TELEGRAM_API_BASE to the mock) and mock-telegram on :8099.
set -u
W=http://127.0.0.1:8787
SID=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
SHORT=${SID:0:8}
H='Content-Type: application/json'
O='Origin: http://localhost:8000'
S='X-Telegram-Bot-Api-Secret-Token: localsecret-0123456789abcdef'
fail=0
check() { if [ "$1" != "$2" ]; then echo "FAIL: $3 (got '$1', want '$2')"; fail=1; else echo "ok: $3"; fi; }

R=$(curl -s -X POST "$W/api/chat/$SID/messages" -H "$H" -H "$O" -d '{"text":"Здравствуйте! Хочу тариф Business","name":"Иван","contact":"@ivan","page":"/#pricing"}')
check "$(echo "$R" | grep -o '"delivered":true')" '"delivered":true' "user message stored and forwarded to Telegram"
ID1=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

TG=$(curl -s http://127.0.0.1:8099/__log | SHORT="$SHORT" node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s).filter(e=>e.method==='sendMessage'&&(e.payload.text||'').includes('#'+process.env.SHORT));console.log(l.length?l[l.length-1].result.message_id:'')})")
check "$([ -n "$TG" ] && echo yes)" yes "telegram message id captured ($TG)"

curl -s -o /dev/null -X POST "$W/tg/webhook" -H "$H" -H "$S" -d "{\"update_id\":1,\"message\":{\"message_id\":$((RANDOM*7+100000)),\"chat\":{\"id\":777},\"text\":\"Добрый день!\",\"reply_to_message\":{\"message_id\":$TG,\"text\":\"x\"}}}"
R=$(curl -s "$W/api/chat/$SID/messages?after=$ID1" -H "$O")
check "$(echo "$R" | grep -o '"from":"admin"' | head -1)" '"from":"admin"' "admin reply via reply_to routed to session"

curl -s -o /dev/null -X POST "$W/tg/webhook" -H "$H" -H "$S" -d "{\"update_id\":2,\"message\":{\"message_id\":$((RANDOM*7+200000)),\"chat\":{\"id\":777},\"text\":\"#$SHORT Ответ по префиксу\"}}"
R=$(curl -s "$W/api/chat/$SID/messages?after=0" -H "$O")
check "$(echo "$R" | grep -o 'Ответ по префиксу')" 'Ответ по префиксу' "admin reply via #prefix routed"

check "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$W/tg/webhook" -H "$H" -H 'X-Telegram-Bot-Api-Secret-Token: nope' -d '{}')" 403 "webhook rejects wrong secret"
check "$(curl -s -o /dev/null -w '%{http_code}' "$W/api/chat/$SID/messages?after=0" -H 'Origin: https://evil.example')" 403 "API rejects foreign origin"
check "$(curl -s -o /dev/null -w '%{http_code}' "$W/api/chat/short/messages" -H "$O")" 400 "bad session id rejected"
check "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$W/api/chat/$SID/messages" -H "$O" -H 'Access-Control-Request-Method: POST')" 204 "CORS preflight"

codes=""
for i in $(seq 1 10); do codes="$codes$(curl -s -o /dev/null -w '%{http_code}' -X POST "$W/api/chat/$SID/messages" -H "$H" -H "$O" -d "{\"text\":\"spam $i\"}") "; done
check "$(echo "$codes" | grep -o 429 | wc -l | tr -d ' ')" 1 "rate limit kicks in within 11 msgs/min ($codes)"
check "$(curl -s "$W/api/health" | grep -o '"ok":true')" '"ok":true' "health"

# посетитель пишет боту напрямую → оператору приходит ✈️ → reply оператора уходит посетителю в Telegram
VID=$((RANDOM+300000))
curl -s -o /dev/null -X POST "$W/tg/webhook" -H "$H" -H "$S" -d "{\"update_id\":5,\"message\":{\"message_id\":$VID,\"chat\":{\"id\":555,\"type\":\"private\",\"first_name\":\"Пётр\",\"username\":\"petr\"},\"from\":{\"id\":555,\"first_name\":\"Пётр\",\"username\":\"petr\"},\"text\":\"Здравствуйте, сколько стоит аренда панели?\"}}"
FWD=$(curl -s http://127.0.0.1:8099/__log | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s).filter(e=>e.method==='sendMessage'&&String(e.payload.chat_id)==='777'&&(e.payload.text||'').includes('✈️')&&(e.payload.text||'').includes('аренда панели'));console.log(l.length?l[l.length-1].result.message_id:'')})")
check "$([ -n "$FWD" ] && echo yes)" yes "telegram-direct visitor forwarded to admin ($FWD)"
curl -s -o /dev/null -X POST "$W/tg/webhook" -H "$H" -H "$S" -d "{\"update_id\":6,\"message\":{\"message_id\":$((RANDOM+400000)),\"chat\":{\"id\":777},\"text\":\"Пётр, стоимость пришлю в личку\",\"reply_to_message\":{\"message_id\":$FWD,\"text\":\"x\"}}}"
TOVIS=$(curl -s http://127.0.0.1:8099/__log | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s).filter(e=>e.method==='sendMessage'&&String(e.payload.chat_id)==='555'&&(e.payload.text||'').includes('стоимость пришлю'));console.log(l.length)})")
check "$TOVIS" 1 "admin reply delivered back to the Telegram visitor"

if [ $fail = 0 ]; then echo "API TESTS PASSED"; else echo "API TESTS FAILED"; fi
exit $fail
