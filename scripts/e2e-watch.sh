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
A="${WATCH_USER_A:-234d49f3-d189-44b1-a874-063e724e4380}"   # AND = powrcto (preview channel, build 19)
B="${WATCH_USER_B:-a2585666-5b7a-4622-8e43-6bd4fb8013f0}"   # iOS = jpowr (production channel, build 17)
USERS="in.(${A},${B})"
VENUE="${WATCH_VENUE:-7d865c3b}"   # POWR partner id prefix (radius 40m)
# 2026-08-18 ~08:5xZ: the 01ac7c7 bundles — the post-upgrade proof-stall fix.
# The proof clock now stamps the FIX'S OWN timestamp instead of now(), so a fix
# delivered late still proves the moment it was taken; the acquire rung reports a
# MEASURED age instead of a hardcoded 0 (it had never once reported a non-zero age
# in the history of the table); and the stream heartbeat spends the round-trip it
# was already making on a CONFIRM rather than a bare tick, which is the first
# device-side proof writer that does not sit downstream of a delivered push.
#
# Shipped in the load-bearing order: migration 20260818082412 FIRST (honest ages
# against the OLD server rule would have been rejected outright and Android
# durations would have COLLAPSED), then the OTA to both channels, then the beacon
# (v45 — its presence pass now gates on last_proven_at, so an unprovable confirm
# no longer buys another 5 minutes of silence).
#
# Superseded ~11:32Z by the 1273ad0 bundles: a late-resolved visit now confirms on
# PRESENT geometry rather than FRESH proof. Run 2 Android (pure background, visit
# ba6d432c) had 3 wakes and ZERO confirms 20 minutes in — the honest fix ages
# made provenInside false on every acquire replay and the old gate skipped the
# round-trip entirely. Every one of that visit's 3 confirms was a nonce wake.
# ⚠ Both phones were on the 08:54 bundles for BOTH 08-18 runs; they pick this one
# up on next foreground, so the first heartbeat after a reinstall/open reads
# STALE-OTA(01a01410|01a0140e) until then. That is the previous good bundle, not a
# fault — but do not start a run on it, the gate bug is in it.
# ⚠ Both phones were confirmed on these exact bundles at 08:54Z before the beacon
# went out, so the first heartbeat should read `AND=fixed iOS=fixed`. If it says
# STALE-OTA, the app has been reinstalled or rolled back — do NOT arm the fences
# until it flips.
#
# ⚠ WHAT THIS RUN CANNOT SHOW. Change 2 (the Android dwell stream) is NOT shipped:
# expo-location throws from its own JS-facing startLocationUpdatesAsync whenever
# the app is backgrounded and the options carry a foregroundService block, so the
# dwell switch still cannot land from a background check-in and Android's stream
# stays on distanceInterval 50. Expect near-silence on the Android stream and read
# it as "Change 2 still outstanding", NOT as background throttling — the
# discriminator is a `stream_start_failed {at:check_in, mode:dwell}` row, which
# this bundle emits for the first time.
AND_OTA="${WATCH_AND_OTA:-01a014a4-a650-70f4-bbe8-c79a2fa86de1}"   # preview / android
IOS_OTA="${WATCH_IOS_OTA:-01a014a6-0306-70e2-8393-31cae6497552}"   # production / ios

S=$(mktemp -d) || exit 1; trap 'rm -rf "$S"' EXIT
get() { cat "$S/$1" 2>/dev/null; }
put() { printf '%s' "$2" > "$S/$1"; }

# ⚠ CURSORS ARE INCLUSIVE (gte), DEDUPED PER ROW — never go back to `gt.`
# Rows written by ONE statement carry an IDENTICAL created_at to the microsecond,
# so an exclusive cursor parked on the first one drops its siblings FOREVER.
# Field-caught 2026-08-17: every `sweep` row shipped with the `wake_received` it
# answered (both at 08:30:10.298799) and the watcher showed only one of the pair —
# it read as "the wake reached JS but the sweep bailed before logging", a wake-path
# bug that did not exist. The same trap was primed on the points lines: an `earn`
# row and its `streak` row are written together, so a 15+30 award would have been
# reported as 15. Inclusive cursor + row hash = no drops, no repeats.
hash() {
  if command -v md5 >/dev/null 2>&1; then
    printf '%s' "$1" | (md5 -q 2>/dev/null || md5 | awk '{print $NF}')
  else
    printf '%s' "$1" | md5sum | cut -d' ' -f1
  fi
}
# true (0) when this exact row was already printed
seen() { local k; k=$(hash "$1"); [ -f "$S/seen_$k" ] && return 0; : > "$S/seen_$k"; return 1; }
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
  rows=$(q geofence_region_events "user_id=${USERS}&created_at=gte.${TS_GEO}&order=created_at.asc&select=user_id,region_id,event,detail,created_at")
  if ok_array "$rows"; then
    while IFS=$'\t' read -r uid ev rid det ts; do
      [ -z "$ts" ] && continue; TS_GEO="${ts%%+*}"
      seen "geo|${uid}|${ev}|${rid}|${det}|${ts}" && continue
      who=$(nm "$uid")
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
        # Already an AGGREGATE row (one per burst, by design) — but 2026-08-17 the
        # emitter re-flushed the SAME tally 17× in 3 s on the arrival arm, and 17
        # notification lines mid-check-in is how this monitor gets rate-limited off
        # exactly when the run matters. Tally them and print at most one line/2 min.
        exit_noise_suppressed)
               n=$(get "ensn_$uid"); n=$(( ${n:-0} + 1 )); put "ensn_$uid" "$n"
               now=$(date +%s); last=$(get "enst_$uid"); last=${last:-0}
               if [ $(( now - last )) -ge 120 ]; then
                 echo "[$who] exit-noise rows ×${n}  $(jq -c . <<<"$det")"
                 put "enst_$uid" "$now"; put "ensn_$uid" 0
               fi ;;
        exit_check) now=$(date +%s); last=$(get "exch_$uid"); last=${last:-0}
               [ $(( now - last )) -ge 120 ] && { echo "[$who] exit_check  $(jq -c . <<<"$det")"; put "exch_$uid" "$now"; } ;;
        # ⚠ THE DISCRIMINATOR FOR THIS RUN. Change 2 is not shipped, so a
        # backgrounded Android check-in still cannot start the dwell stream. This
        # row is the difference between "the switch was refused" (expected) and
        # "the switch landed and Android throttled us anyway" (a new finding).
        stream_start_failed|stream_switch_deferred)
               echo "[$who] >>> STREAM NOT STARTED ($ev)  $(jq -c . <<<"$det")" ;;
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
  rows=$(q gym_visit_events "user_id=${USERS}&created_at=gte.${TS_GVE}&order=created_at.asc&select=user_id,event,detail,created_at")
  if ok_array "$rows"; then
    while IFS=$'\t' read -r uid ev det ts; do
      [ -z "$ts" ] && continue; TS_GVE="${ts%%+*}"
      seen "gve|${uid}|${ev}|${det}|${ts}" && continue
      who=$(nm "$uid")
      case "$ev" in
        stream_tick) ;;
        # ⚠ TWO THROTTLES, DELIBERATELY (2026-08-18). Since the retrospective
        # stamp the interesting question is no longer "did a wake answer" but
        # "did the proof clock MOVE" — `stamped` is the server's answer to that,
        # and `proven_at` is where it moved to. The stream heartbeat is now a
        # proof writer too (stage:'stream'), and folding its rows into the wake
        # throttle would hide exactly the writer the 08-17 run lacked: on that
        # run Android logged ONE stream tick in 47 minutes. Separate counters, so
        # a silent stream is visible as a silence rather than as someone else's
        # confirm winning the 300 s window.
        confirmed_inside)
             stg=$(jq -r '.stage // "?"' <<<"$det" 2>/dev/null)
             if [ "$stg" = "stream" ]; then
               now=$(date +%s); last=$(get "sconf_$uid"); last=${last:-0}
               n=$(get "sconfn_$uid"); n=$(( ${n:-0} + 1 )); put "sconfn_$uid" "$n"
               if [ $(( now - last )) -ge 300 ]; then
                 echo "[$who] STREAM PROOF ×${n}  $(jq -c '{source,accuracy_m,distance_m,fix_age_s,proven,stamped,proven_at}' <<<"$det" 2>/dev/null)"
                 put "sconf_$uid" "$now"; put "sconfn_$uid" 0
               fi
             else
               now=$(date +%s); last=$(get "conf_$uid"); last=${last:-0}
               [ $(( now - last )) -ge 300 ] && { echo "[$who] inside ok  $(jq -c '{stage,accuracy_m,distance_m,fix_age_s,auth,proven,stamped}' <<<"$det" 2>/dev/null)"; put "conf_$uid" "$now"; }
             fi ;;
        # The acceptance criteria for this run live in one row. clamp_loss_s is
        # the time we FAILED TO BILL (target <300s; 08-17 was iOS 604 / AND 425);
        # clamp_anchor says which column the clamp landed on, which is what tells
        # "the proof clock stalled" apart from "the device never proved anything".
        exit) echo "[$who] >>> VISIT EXIT  $(jq -r '"clamp_loss_s=\(.clamp_loss_s // "?")s  proof_gap_s=\(.proof_gap_s // "null")  anchor=\(.clamp_anchor // "?")  writer=\(.proof_writer // "none")  clamped=\(.clamped)"' <<<"$det" 2>/dev/null)"
              echo "[$who]     raw: $(jq -c . <<<"$det")" ;;
        *) echo "[$who] VISIT ${ev}  $(jq -c . <<<"$det")" ;;
      esac
    done < <(jq -r '.[] | [.user_id,.event,(.detail|tostring),.created_at] | @tsv' <<<"$rows" 2>/dev/null)
  fi

  # ---- gym_visits signature diff (status mutates in place) ----
  # keyed by VISIT id, not user — a re-mint gives a user 2+ rows in a day, and a
  # per-user signature flaps between them, reprinting both rows on every poll
  rows=$(q gym_visits "user_id=${USERS}&created_at=gte.$(date -u +%Y-%m-%d)&select=id,user_id,status,announced_at,claimed_at,upgraded_at,ended_at,close_reason,completed_push_at,last_proven_at,last_confirmed_at")
  if ok_array "$rows"; then
    while IFS=$'\t' read -r vid uid sig; do
      [ -z "$vid" ] && continue
      [ "$(get "vis_$vid")" != "$sig" ] && { echo "[$(nm "$uid")] ** VISIT ${vid:0:8} ** ${sig}"; put "vis_$vid" "$sig"; }
    done < <(jq -r '.[] | [.id, .user_id, ("status="+.status+" announced="+((.announced_at//"-")|tostring)+" claimed="+((.claimed_at//"-")|tostring)+" upgraded="+((.upgraded_at//"-")|tostring)+" ended="+((.ended_at//"-")|tostring)+" reason="+((.close_reason//"-")|tostring)+" donepush="+((.completed_push_at//"-")|tostring)+" proven="+((.last_proven_at//"-")|tostring)+" confirmed="+((.last_confirmed_at//"-")|tostring))] | @tsv' <<<"$rows" 2>/dev/null)
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
  rows=$(q point_transactions "user_id=${USERS}&created_at=gte.${TS_PT}&order=created_at.asc&select=id,user_id,amount,type,description,created_at")
  if ok_array "$rows"; then
    while IFS=$'\t' read -r rid uid amt typ desc ts; do
      [ -z "$ts" ] && continue; TS_PT="${ts%%+*}"
      seen "pt|${rid}" && continue
      echo "[$(nm "$uid")] *** POINTS ${typ} +${amt} — ${desc} (${ts}Z) ***"
    done < <(jq -r '.[] | [.id,.user_id,.amount,.type,.description,.created_at] | @tsv' <<<"$rows" 2>/dev/null)
  fi

  # ---- push sends: surface, flag duplicate sends, queue display-receipt tracking ----
  rows=$(q push_send_log "user_id=${USERS}&created_at=gte.${TS_PS}&order=created_at.asc&select=id,user_id,type,status,skip_reason,error,title,transport,delivered_at,created_at")
  if ok_array "$rows"; then
    while IFS=$'\t' read -r pid uid typ st skip err ttl tr dlv ts; do
      [ -z "$ts" ] && continue; TS_PS="${ts%%+*}"
      seen "ps|${pid}" && continue
      who=$(nm "$uid")
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
