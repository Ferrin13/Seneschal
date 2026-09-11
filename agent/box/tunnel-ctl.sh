#!/usr/bin/env bash
# seneschal-tunnel-ctl -- root helper for the tunneled-browser path.
#
# Installed to /usr/local/sbin/seneschal-tunnel-ctl by box/install.sh and
# allowed for the `browser` user via a narrow NOPASSWD sudoers rule. It is the
# only privileged thing the scraper agent can invoke.
#
#   status   Print JSON describing who holds the listening sockets on port
#            9222: {"ipv4": "sshd"|"chrome"|<comm>|null, "ipv6": ..., 
#            "legacyChromeActive": bool}. "sshd" means the operator's reverse
#            tunnel is bound; "chrome" means the legacy on-box Chrome is
#            squatting on the port (the agent then talks to the wrong browser).
#
#   rebuild  Stop the legacy on-box browser stack if present, drop every sshd
#            process holding a 9222 forward so the operator's keep-alive
#            script (infra/local/fb-agent-tunnel.ps1) reconnects and rebinds
#            both loopbacks, wait up to 30s for a fresh sshd listener, then
#            print `status`.
set -euo pipefail

PORT="${TUNNEL_PORT:-9222}"
LEGACY_UNITS=(chrome.service xvfb.service x11vnc.service novnc.service)

# Print the command name of the process owning the listener on $1 (an address
# like 127.0.0.1 or [::1]), or nothing if no listener.
#
# "No listener" is a normal answer, so every filter here must exit 0 on no
# match (sed -n ...p rather than grep) or `set -o pipefail` would abort us.
holder_of() {
  local addr="$1"
  ss -ltnpH "sport = :$PORT" 2>/dev/null \
    | awk -v a="$addr:$PORT" '$4 == a' \
    | sed -nE 's/.*users:\(\("([^"]*)".*/\1/p' | head -n1
}

json_or_null() {
  if [ -z "$1" ]; then printf 'null'; else printf '"%s"' "$1"; fi
}

legacy_active() {
  local u
  for u in "${LEGACY_UNITS[@]}"; do
    if systemctl is-active --quiet "$u" 2>/dev/null; then
      printf 'true'
      return
    fi
  done
  printf 'false'
}

print_status() {
  local v4 v6
  v4="$(holder_of 127.0.0.1)"
  v6="$(holder_of '[::1]')"
  printf '{"ipv4": %s, "ipv6": %s, "legacyChromeActive": %s}\n' \
    "$(json_or_null "$v4")" "$(json_or_null "$v6")" "$(legacy_active)"
}

sshd_forward_pids() {
  ss -ltnpH "sport = :$PORT" 2>/dev/null \
    | sed -nE 's/.*users:\(\("sshd",pid=([0-9]+).*/\1/p' | sort -u
}

rebuild() {
  # 1. Legacy browser stack must not hold the port. Stop it (idempotent).
  systemctl stop "${LEGACY_UNITS[@]}" 2>/dev/null || true

  # 2. Bounce the reverse-forward session(s). The operator's script sees the
  #    connection drop and reconnects within seconds.
  local pid
  for pid in $(sshd_forward_pids); do
    kill "$pid" 2>/dev/null || true
  done

  # 3. Wait for a fresh sshd listener on IPv4 loopback (that's what the agent
  #    dials). Give up after 30s; the caller reports whatever state we're in.
  local i
  for i in $(seq 1 30); do
    if [ "$(holder_of 127.0.0.1)" = "sshd" ]; then break; fi
    sleep 1
  done
  print_status
}

case "${1:-}" in
  status) print_status ;;
  rebuild) rebuild ;;
  *)
    echo "usage: $0 {status|rebuild}" >&2
    exit 64
    ;;
esac
