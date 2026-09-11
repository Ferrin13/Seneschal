#!/usr/bin/env bash
# Box-side install for the scraper agent. Run as root on the agent host after
# the artifact has been extracted to /opt/browser/app/agent (deploy-agent.sh
# and the agent pipeline's SSM step both call this). Idempotent.
#
# Why this exists: the EC2 box was launched from an older cloud-init whose
# scraper-agent unit had `Requires=chrome.service`, and Terraform ignores
# user_data changes post-launch. Anything the box needs to *stay* correct has
# to ship with the artifact, so this script:
#   1. installs the systemd unit without the legacy Chrome dependency,
#   2. disables + masks the legacy on-box browser stack (Chrome/Xvfb/VNC) so
#      nothing can put a Linux Chrome back on port 9222,
#   3. installs the root tunnel helper + the sudoers rule that lets the agent
#      call it (this powers "Rebuild tunnel" in the web UI),
#   4. restarts the agent.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "install.sh must run as root" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEGACY_UNITS=(chrome.service xvfb.service x11vnc.service novnc.service)

echo "==> Installing tunnel helper"
install -o root -g root -m 0755 "$HERE/tunnel-ctl.sh" /usr/local/sbin/seneschal-tunnel-ctl

echo "==> Installing sudoers rule for the agent user"
SUDOERS=/etc/sudoers.d/seneschal-browser
printf 'browser ALL=(root) NOPASSWD: /usr/local/sbin/seneschal-tunnel-ctl\n' > "$SUDOERS.tmp"
chmod 0440 "$SUDOERS.tmp"
if visudo -cf "$SUDOERS.tmp" >/dev/null; then
  mv "$SUDOERS.tmp" "$SUDOERS"
else
  rm -f "$SUDOERS.tmp"
  echo "sudoers rule failed validation; aborting" >&2
  exit 1
fi

echo "==> Installing scraper-agent unit (no legacy Chrome dependency)"
install -o root -g root -m 0644 "$HERE/scraper-agent.service" /etc/systemd/system/scraper-agent.service
# A previous attempt tried to clear Requires= via a drop-in; systemd can't
# reset dependency lists that way, so remove it to avoid confusion.
rm -rf /etc/systemd/system/scraper-agent.service.d

echo "==> Retiring legacy on-box browser stack"
systemctl stop "${LEGACY_UNITS[@]}" 2>/dev/null || true
systemctl disable "${LEGACY_UNITS[@]}" 2>/dev/null || true
for u in "${LEGACY_UNITS[@]}"; do
  # mask refuses if a real unit file sits at the path; remove it first.
  rm -f "/etc/systemd/system/$u"
done
systemctl daemon-reload
systemctl mask "${LEGACY_UNITS[@]}" >/dev/null 2>&1 || true

echo "==> Restarting scraper-agent"
systemctl daemon-reload
systemctl enable scraper-agent.service >/dev/null 2>&1 || true
systemctl restart scraper-agent.service

echo "==> Port 9222 holders after install:"
/usr/local/sbin/seneschal-tunnel-ctl status
echo "Agent installed and restarted."
