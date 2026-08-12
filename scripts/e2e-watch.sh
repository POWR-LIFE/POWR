#!/usr/bin/env bash
# E2E geofence field-test watcher — polls Supabase every 30s and emits one line per
# meaningful state change (region events, visit lifecycle, sessions, streaks, points,
# push sends + display receipts, 15-min heartbeat with OTA staleness check).
#
# Run via the Monitor tool with persistent:true during a field test.
# Reads EXPO_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from repo-root .env.
#
# bash 3.2 safe: per-device state lives in files under mktemp -d, no declare -A
# (string subscripts collapse to index 0 on macOS bash and the script dies).
#
# Per-run knobs (env-overridable; defaults = 2026-08-11 run):
#   WATCH_USER_A / WATCH_USER_B  test-account UUIDs (A prints as AND, B as iOS)
#   WATCH_VENUE                  partner-id prefix of the venue under test
#   WATCH_AND_OTA / WATCH_IOS_OTA  expected ota_update_id per platform; heartbeat
#                                  flags STALE-OTA when a device runs anything else
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env >/dev/null 2>&1; set +a
URL="${EXPO_PUBLIC_SUPABASE_URL}"; KEY="${SUPABASE_SERVICE_ROLE_KEY}"
A="${WATCH_USER_A:-234d49f3-d189-44b1-a874-063e724e4380}"   # AND = powrcto (production channel)
B="${WATCH_USER_B:-a2585666-5b7a-4622-8e43-6bd4fb8013f0}"   # iOS = jpowr (preview channel)
USERS="in.(${A},${B})"
VENUE="${WATCH_VENUE:-7d865c3b}"   # POWR partner id prefix (radius 40m)
# 2026-08-12: both devices run the 1.5.0 native builds (commit 14902ec, runtime
# 6acdda91) whose EMBEDDED bundle is current — no OTA exists on that runtime, so
# ota_update_id is expected to be null, which the heartbeat maps to "embedded".
AND_OTA="${WATCH_AND_OTA:-embedded}"
IOS_OTA="${WATCH_IOS_OTA:-embedded}"

S=$(mktemp -d) || exit 1; trap 'rm -rf "$S"' EXIT
get() { cat "$S/$1" 2>/dev/null; }
put() { printf '%s' "$2" > "$S/$1"; }
nm() { case "$1" in "$A") printf 'AND';; "$B") printf 'iOS';; *) printf '%s' "${1:0:8}";; esac; }
q() { curl -sS --max-time 25 -H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}" "${URL}/rest/v1/$1?$2" 2>/dev/null; }
ok_array() { [ "$(jq -r 'type' <<<"$1" 2>/dev/null)" = "array" ]; }

# venue-name map, fetched once
q partners "select=id,name&limit=1000" | jq -r '.[] | [.id,.name] | @tsv' > "$S/partners.tsv" 2>/dev/null
pname() { grep "^${1:0:36}" "$S/partners.tsv" 2>/dev/null | head -1 | cut -f2; }

TS=$(date -u +%Y-%m-%dT%H:%M:%S); TS_GEO="$TS"; TS_GVE="$TS"; TS_PT="$TS"; TS_PS="$TS"
HB_LAST=0
echo "watch armed (bash ${BASH_VERSINFO[0]}) — polling every 30s from ${TS}Z | expecting OTA AND ${AND_OTA:0:8}, iOS ${IOS_OTA:0:8}"

while true; do
  # ---- geofence region events ----
  rows=$(q geofence_region_events "user_id=${USERS}&created_at=gt.${TS_GEO}&order=created_at.asc&select=user_id,region_id,event,detail,created_at")
  if ok_array "$rows"; then
    while IFS=$'\t' read -r uid ev rid det ts; do
      [ -z "$ts" ] && continue; TS_GEO="${ts%%+*}"; who=$(nm "$uid")
      case "$ev" in
        sweep) out=$(jq -r '.outcome // "?"' <<<"$det"); prev=$(get "sweep_$uid")
               [ "$prev" != "$out" ] && { echo "[$who] SWEEP ${prev:-none} -> ${out}  $(jq -c . <<<"$det")"; put "sweep_$uid" "$out"; } ;;
        enter) vn=$(pname "$rid"); vn=${vn:-${rid:0:8}}
               put "seen_enter_${uid}_${rid:0:8}" 1
               case "$rid" in ${VENUE}*) echo "[$who] >>> VENUE ENTER (${ts}Z) <<<  $(jq -c . <<<"$det")" ;;
                 *) echo "[$who] enter ${vn}  $(jq -c '{accuracy_m,distance_m}' <<<"$det" 2>/dev/null)" ;; esac ;;
        exit)  case "$rid" in
                 ${VENUE}*) echo "[$who] >>> VENUE EXIT (${ts}Z) <<<  $(jq -c . <<<"$det")" ;;
                 *) if [ -n "$(get "seen_enter_${uid}_${rid:0:8}")" ]; then
                      vn=$(pname "$rid"); echo "[$who] exit ${vn:-${rid:0:8}}"
                    else n=$(get "supx_$uid"); put "supx_$uid" $(( ${n:-0} + 1 )); fi ;; esac ;;
        exit_check) now=$(date +%s); last=$(get "exch_$uid"); last=${last:-0}
               [ $(( now - last )) -ge 120 ] && { echo "[$who] exit_check  $(jq -c . <<<"$det")"; put "exch_$uid" "$now"; } ;;
        armed|rearm_skipped)
               now=$(date +%s); last=$(get "arm_$uid"); last=${last:-0}
               n=$(get "armn_$uid"); n=$(( ${n:-0} + 1 )); put "armn_$uid" "$n"
               if [ $(( now - last )) -ge 120 ]; then
                 sx=$(get "supx_$uid"); echo "[$who] ARM ${ev} (${n} since last, ${sx:-0} bg exits suppressed)  $(jq -c . <<<"$det")"
                 put "arm_$uid" "$now"; put "armn_$uid" 0; put "supx_$uid" 0
               fi ;;
        *) echo "[$who] GEO ${ev} (${rid:0:8})  $(jq -c . <<<"$det")" ;;
      esac
    done < <(jq -r '.[] | [.user_id,.event,.region_id,(.detail|tostring),.created_at] | @tsv' <<<"$rows" 2>/dev/null)
  fi

  # ---- gym visit events ----
  rows=$(q gym_visit_events "user_id=${USERS}&created_at=gt.${TS_GVE}&order=created_at.asc&select=user_id,event,detail,created_at")
  if ok_array "$rows"; then
    while IFS=$'\t' read -r uid ev det ts; do
      [ -z "$ts" ] && continue; TS_GVE="${ts%%+*}"; who=$(nm "$uid")
      case "$ev" in
        stream_tick) ;;
        confirmed_inside) now=$(date +%s); last=$(get "conf_$uid"); last=${last:-0}
             [ $(( now - last )) -ge 300 ] && { echo "[$who] inside ok  $(jq -c '{stage,accuracy_m,distance_m,auth,proven:.proven}' <<<"$det" 2>/dev/null)"; put "conf_$uid" "$now"; } ;;
        *) echo "[$who] VISIT ${ev}  $(jq -c . <<<"$det")" ;;
      esac
    done < <(jq -r '.[] | [.user_id,.event,(.detail|tostring),.created_at] | @tsv' <<<"$rows" 2>/dev/null)
  fi

  # ---- gym_visits signature diff (status mutates in place) ----
  rows=$(q gym_visits "user_id=${USERS}&created_at=gte.$(date -u +%Y-%m-%d)&select=user_id,status,announced_at,claimed_at,upgraded_at,ended_at,close_reason,completed_push_at,last_proven_at,last_confirmed_at")
  if ok_array "$rows"; then
    while IFS=$'\t' read -r uid sig; do
      [ -z "$uid" ] && continue
      [ "$(get "vis_$uid")" != "$sig" ] && { echo "[$(nm "$uid")] ** VISIT ** ${sig}"; put "vis_$uid" "$sig"; }
    done < <(jq -r '.[] | [.user_id, ("status="+.status+" announced="+((.announced_at//"-")|tostring)+" claimed="+((.claimed_at//"-")|tostring)+" upgraded="+((.upgraded_at//"-")|tostring)+" ended="+((.ended_at//"-")|tostring)+" reason="+((.close_reason//"-")|tostring)+" donepush="+((.completed_push_at//"-")|tostring)+" proven="+((.last_proven_at//"-")|tostring)+" confirmed="+((.last_confirmed_at//"-")|tostring))] | @tsv' <<<"$rows" 2>/dev/null)
  fi

  # ---- activity_sessions signature diff (duration grows in place — that progression IS the duration test) ----
  rows=$(q activity_sessions "user_id=${USERS}&created_at=gte.$(date -u +%Y-%m-%d)&select=id,user_id,type,duration_sec,verification,started_at,ended_at")
  if ok_array "$rows"; then
    while IFS=$'\t' read -r id uid sig; do
      [ -z "$id" ] && continue; prev=$(get "as_${id}")
      if [ -z "$prev" ]; then echo "[$(nm "$uid")] SESSION NEW ${sig}"
      elif [ "$prev" != "$sig" ]; then echo "[$(nm "$uid")] SESSION UPD ${prev} -> ${sig}"; fi
      put "as_${id}" "$sig"
    done < <(jq -r '.[] | [.id, .user_id, (.type+" dur="+(.duration_sec|tostring)+"s verif="+(.verification//"-")+" start="+((.started_at//"-")|tostring)+" end="+((.ended_at//"-")|tostring))] | @tsv' <<<"$rows" 2>/dev/null)
  fi

  # ---- user_streaks signature diff ----
  rows=$(q user_streaks "user_id=${USERS}&select=user_id,current_streak,longest_streak,last_activity_date")
  if ok_array "$rows"; then
    while IFS=$'\t' read -r uid sig; do
      [ -z "$uid" ] && continue; prev=$(get "stk_$uid")
      [ -n "$prev" ] && [ "$prev" != "$sig" ] && echo "[$(nm "$uid")] STREAK ${prev} -> ${sig}"
      put "stk_$uid" "$sig"
    done < <(jq -r '.[] | [.user_id, ((.current_streak|tostring)+"/"+(.longest_streak|tostring)+" last="+(.last_activity_date//"-"))] | @tsv' <<<"$rows" 2>/dev/null)
  fi

  # ---- points ----
  rows=$(q point_transactions "user_id=${USERS}&created_at=gt.${TS_PT}&order=created_at.asc&select=user_id,amount,type,description,created_at")
  if ok_array "$rows"; then
    while IFS=$'\t' read -r uid amt typ desc ts; do
      [ -z "$ts" ] && continue; TS_PT="${ts%%+*}"
      echo "[$(nm "$uid")] *** POINTS ${typ} +${amt} — ${desc} (${ts}Z) ***"
    done < <(jq -r '.[] | [.user_id,.amount,.type,.description,.created_at] | @tsv' <<<"$rows" 2>/dev/null)
  fi

  # ---- push sends: surface, flag duplicate sends, queue display-receipt tracking ----
  rows=$(q push_send_log "user_id=${USERS}&created_at=gt.${TS_PS}&order=created_at.asc&select=id,user_id,type,status,skip_reason,error,title,transport,delivered_at,created_at")
  if ok_array "$rows"; then
    while IFS=$'\t' read -r pid uid typ st skip err ttl tr dlv ts; do
      [ -z "$ts" ] && continue; TS_PS="${ts%%+*}"; who=$(nm "$uid")
      [ "$typ" = "fence_refresh" ] && continue   # wake-loop noise; sweeps already prove the device answered
      now=$(date +%s)
      extra=""; [ "$skip" != "null" ] && [ -n "$skip" ] && extra=" skip=${skip}"
      [ "$err" != "null" ] && [ -n "$err" ] && extra="${extra} err=${err}"
      dup=""; last=$(get "lp_${uid}_${typ}"); last=${last:-0}
      [ $(( now - last )) -lt 180 ] && dup="DUPLICATE-SEND?! "
      put "lp_${uid}_${typ}" "$now"
      echo "[$who] ${dup}PUSH ${typ} status=${st} via=${tr}${extra}  \"${ttl}\" (${ts}Z)"
      if [ "$tr" = "fcm_direct" ] && [ "$st" = "accepted" ] && { [ "$dlv" = "null" ] || [ -z "$dlv" ]; }; then
        echo "${pid}|${who}|${typ}|${now}" >> "$S/pending"
      fi
    done < <(jq -r '.[] | [.id,.user_id,.type,.status,(.skip_reason|tostring),(.error|tostring),(.title|tostring),(.transport|tostring),(.delivered_at|tostring),.created_at] | @tsv' <<<"$rows" 2>/dev/null)
  fi

  # ---- display-receipt chase: did the banner actually draw? ----
  if [ -s "$S/pending" ]; then
    ids=$(cut -d'|' -f1 "$S/pending" | paste -sd, -)
    drows=$(q push_send_log "id=in.(${ids})&select=id,delivered_at")
    if ok_array "$drows"; then
      now=$(date +%s); : > "$S/pending2"
      while IFS='|' read -r pid who typ ep; do
        [ -z "$pid" ] && continue
        dlv=$(jq -r --arg id "$pid" '.[] | select(.id==$id) | .delivered_at // empty' <<<"$drows")
        if [ -n "$dlv" ]; then echo "[$who] PUSH DISPLAYED ${typ} +$(( now - ep ))s after send (device receipt)"
        elif [ $(( now - ep )) -gt 300 ]; then echo "[$who] PUSH NO-DISPLAY-RECEIPT ${typ} after 300s — sent but never drew?!"
        else echo "${pid}|${who}|${typ}|${ep}" >> "$S/pending2"; fi
      done < "$S/pending"
      mv "$S/pending2" "$S/pending"
    fi
  fi

  # ---- 15-min heartbeat: proof of life + OTA check ----
  now=$(date +%s)
  if [ $(( now - HB_LAST )) -ge 900 ]; then
    HB_LAST=$now; since=$(date -u -v-15M +%FT%T)
    pts=$(q point_transactions "user_id=${USERS}&created_at=gte.$(date -u +%Y-%m-%d)&select=user_id,amount" | jq -r --arg a "$A" '[.[] | select(.user_id==$a) | .amount] | add // 0' 2>/dev/null)
    ptsb=$(q point_transactions "user_id=${USERS}&created_at=gte.$(date -u +%Y-%m-%d)&select=user_id,amount" | jq -r --arg b "$B" '[.[] | select(.user_id==$b) | .amount] | add // 0' 2>/dev/null)
    geo=$(q geofence_region_events "user_id=${USERS}&created_at=gte.${since}&select=id" | jq -r 'length' 2>/dev/null)
    ota=$(q user_push_tokens "user_id=${USERS}&select=user_id,ota_update_id" | jq -r --arg a "$A" --arg ax "$AND_OTA" --arg b "$B" --arg bx "$IOS_OTA" \
      'map((.ota_update_id // "embedded") as $o | if .user_id==$a then (if $o==$ax then "AND=fixed" else "AND=STALE-OTA("+$o[0:8]+")" end) else (if $o==$bx then "iOS=fixed" else "iOS=STALE-OTA("+$o[0:8]+")" end) end) | join(" ")' 2>/dev/null)
    echo "-- heartbeat: pts today AND=${pts:-?} iOS=${ptsb:-?} | geo evts 15m=${geo:-?} | ${ota} --"
  fi

  sleep 30
done
