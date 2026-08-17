# Deploying WMIT on netcup

This guide puts the WMIT hosted server on a netcup VPS with HTTPS, automatic
nightly backups, and mail through your netcup domain mailbox.

**Important:** netcup *Webhosting* plans (including Webhosting 4000) are PHP
shared hosting and cannot run WMIT. Keep Webhosting 4000 for your website and
mailboxes; run WMIT on a netcup **VPS** (the smallest plan is enough) and point
a subdomain such as `app.yourdomain.ph` at it.

## What you need

- A netcup VPS (SCP → Products → VPS, e.g. VPS 200 ARM) with **Ubuntu 24.04**
- Your domain's DNS access (netcup CCP → Domains → DNS)
- The WMIT repository on your working machine (it deploys with git or scp)

## 1. Prepare the VPS

Sign in over SSH as root, then:

```bash
apt update && apt -y upgrade
apt -y install curl git
# PDF support for supplier tariff uploads: poppler-utils (pdftotext) and
# Python 3 + pdfplumber (table extraction for rate matrices). Without them
# text extraction falls back to pdfplumber-only / table parsing is skipped.
apt -y install poppler-utils python3 python3-pip
pip3 install --break-system-packages pdfplumber  # omit --break-system-packages on older Debian/Ubuntu
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs
node -v   # must print v22 or newer
```

Create the service user and folders:

```bash
adduser --disabled-password --gecos "" wmit
mkdir -p /home/wmit/app /home/wmit/data
chown -R wmit:wmit /home/wmit
```

## 2. Install Caddy (automatic HTTPS)

```bash
apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt -y install caddy
```

## 3. Point DNS at the VPS

In the netcup CCP, open your domain's DNS settings and add:

| Type | Host | Value |
|---|---|---|
| A | app | `<your VPS IPv4>` |
| AAAA | app | `<your VPS IPv6>` (optional) |

Wait a few minutes, then edit `/etc/caddyfile` to:

```
app.yourdomain.ph {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
systemctl reload caddy
```

Caddy now obtains and renews a Let's Encrypt certificate automatically.

## 4. Deploy the code

From your working machine:

```bash
scp -r D:\Codex\WMIT wmit@<vps-ip>:/home/wmit/app
```

(or clone your git remote on the VPS — recommended once you push the
repository somewhere private)

On the VPS, install the app as a service. Create
`/etc/systemd/system/wmit.service`:

```ini
[Unit]
Description=WMIT Operations Server
After=network.target

[Service]
User=wmit
WorkingDirectory=/home/wmit/app
Environment=WMIT_ENV=production
Environment=WMIT_DATA_DIR=/home/wmit/data
Environment=WMIT_PORT=3000
Environment=WMIT_BASE_URL=https://app.yourdomain.ph
Environment=WMIT_ENFORCE_SESSIONS=true
ExecStart=/usr/bin/node scripts/run-server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now wmit
systemctl status wimit   # typo guard: it is `systemctl status wmit`
journalctl -u wmit -n 20 --no-pager
```

You should see `WMIT hosted server (production) listening on 0.0.0.0:3000`.

**First sign-in:** on the VPS run

```bash
cat /home/wmit/data/initial-admin-password.txt
```

This file exists only on first boot and contains the generated `admin`
password. Sign in at `https://app.yourdomain.ph`, change the password, create
your staff accounts, then delete the file: `rm /home/wmit/data/initial-admin-password.txt`.

## 5. Configure email (netcup mailbox)

Create a mailbox in the netcup CCP (Webhosting → Mail), for example
`wmit@yourdomain.ph`. Then store its SMTP credentials in a file the service
reads — create `/home/wmit/app/.env` (owner-only):

```bash
install -m 600 /dev/null /home/wmit/app/.env
nano /home/wmit/app/.env
```

```ini
WMIT_SMTP_HOST=mail.yourdomain.ph
WMIT_SMTP_PORT=587
WMIT_SMTP_MODE=starttls
WMIT_SMTP_USER=wmit@yourdomain.ph
WMIT_SMTP_PASSWORD=<mailbox password>
WMIT_SMTP_FROM=wmit@yourdomain.ph
WMIT_SMTP_FROM_NAME=WMIT Operations
WMIT_DIGEST_TO=owner@yourdomain.ph
```

(The exact outgoing server name is shown in the netcup CCP next to the
mailbox; commonly `mail.<yourdomain>` or `mail.netcup.net`.)

```bash
systemctl restart wmit
```

Until SMTP is configured, every outgoing email (including the daily digest) is
written as a reviewable `.eml` draft under `/home/wmit/data/outbox/`.

## 6. Backups (automatic) and restore (rehearsed)

- The server creates a verified SQLite backup every night at 01:15 Manila time
  under `/home/wmit/data/backups/` and keeps the last 30.
- Every backup is automatically *rehearsed*: it is opened read-only and checked
  (integrity, record counts, audit hash chain) before being trusted.
- Manual backup: `sudo -u wmit node /home/wmit/app/scripts/backup.js`
- Restore (stops the server first):

```bash
systemctl stop wmit
cd /home/wmit/app
sudo -u wmit node scripts/restore.js /home/wmit/data/backups/<file>.sqlite3
systemctl start wmit
```

The current database is always kept as a dated `.before-restore-…` copy.

For off-site safety, copy backups out periodically, e.g. from your machine:

```bash
scp -r wmit@<vps-ip>:/home/wmit/data/backups D:\WMIT-Backups
```

## 7. Staging on the same server (optional)

Run a second instance with its own database on port 3001:

```bash
WMIT_ENV=staging WMIT_PORT=3001 WMIT_DATA_DIR=/home/wmit/data-staging node scripts/run-server.js
```

Staging seeds synthetic records, so you can rehearse workflows and train staff
without touching production data. Do not expose staging publicly; use an SSH
tunnel from your machine: `ssh -L 3001:127.0.0.1:3001 wmit@<vps-ip>` and open
`http://127.0.0.1:3001`.

## 8. Updating

```bash
systemctl stop wmit
# copy/checkout the new code into /home/wmit/app (keep .env and data/)
npm test            # run the suite first when possible
systemctl start wmit
```

## 9. Health and troubleshooting

- `https://app.yourdomain.ph/api/health` — environment, scheduler jobs, and
  the latest heartbeat result. This endpoint is public **by design** and leaks
  no business data.
- 401 on every page → sign-in expired; sessions last six hours.
- `journalctl -u wmit -f` — live logs.
- Site down after a change → `systemctl restart wmit`; if the database was
  touched, verify with the restore rehearsal before panicking: the audit chain
  will tell you if data was altered.
- Heartbeat shows DEGRADED → check `/api/health` detail; anything mentioning
  `audit_chain` means the audit log was edited outside the system.

## Security checklist before real client data

- [ ] `WMIT_ENFORCE_SESSIONS=true` (default in production)
- [ ] Admin password changed; `initial-admin-password.txt` deleted
- [ ] Staff accounts use strong unique passwords
- [ ] HTTPS works (Caddy) — never use plain HTTP
- [ ] `.env` permissions are 600 and it is never committed
- [ ] A backup was copied off the VPS at least once
