# Internal deployment

Running this fork as an internal API testing tool: one hostname, sign in with
a company Google account, and a desktop client that works the moment it is
installed — nobody types a URL or a port.

```
                    https://apitool.example.com
                              │
        ┌─────────────────────┼─────────────────────┐
        │  Caddy (subpath access, one port)         │
        │    /                → web app             │
        │    /admin           → admin dashboard     │
        │    /backend         → API + GraphQL       │
        │    /desktop-app-server → client bundles   │
        │    /download        → installers          │
        └─────────────────────┬─────────────────────┘
                              │
                    Postgres (named volume)
```

## Why the client needs no setup step

On a machine that has never run it, the app has no saved instances, so
`loadRecent()` falls through to `loadVendoredInstance()` and runs the web
bundle compiled into the binary. `deploy/build-client.sh` compiles that bundle
from the production `.env`, so it is already pointed at our backend. Install,
open, sign in.

`VITE_INSTANCE_SWITCHING_ENABLED=false` then hides the instance switcher, so
the app cannot be pointed anywhere else.

---

## Server, once

**1. Host and DNS.** A VM that stays on — 2 vCPU / 4 GB / 40 GB is enough to
start. Point an A record at it. Open 80 and 443 only; no other port needs to
leave the box.

**2. Configure.**

```bash
git clone <this repo> && cd hoppscotch-topgun
cp deploy/.env.production.example .env
$EDITOR .env      # replace __HOPP_HOST__, generate the two secrets
```

Back up `DATA_ENCRYPTION_KEY` somewhere durable before going further. Every
encrypted config value and every team vault secret is unreadable without it.

**3. Google sign-in.** In Google Cloud Console create an OAuth client:

- Authorized redirect URI: `https://<host>/backend/v1/auth/google/callback`
- Consent screen user type **Internal** if you have Google Workspace — Google
  then refuses non-company accounts before the request ever reaches us

Put the client id and secret in `.env`, and set `GOOGLE_ALLOWED_DOMAINS` to
your company domain. That second one is the backstop: leave it empty and any
Google account that reaches the login page can register itself.

**4. Start.**

```bash
docker compose -f docker-compose.prod.yml up -d
./deploy/bootstrap.sh
```

`bootstrap.sh` is not optional. `VITE_ALLOWED_AUTH_PROVIDERS` and the
`MAILER_*` values are excluded from env sync, so a fresh instance ignores them
in `.env` and sits with no way to sign in until onboarding is posted. Keep the
recovery token it prints — it is what lets you change sign-in settings later.

**5. First admin.** Sign in once with your own account, then:

```bash
docker compose -f docker-compose.prod.yml exec hoppscotch-db \
  psql -U postgres -d hoppscotch \
  -c "UPDATE \"User\" SET \"isAdmin\"=true WHERE email='you@example.com';"
```

`https://<host>/admin` works from then on.

---

## Client, once per release

```bash
export TAURI_SIGNING_PRIVATE_KEY=~/.tauri/topgun.key
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=...
./deploy/build-client.sh
BASE_URL=https://<host>/download ./deploy/make-release.sh 26.8.1 ./release
```

Copy `./release/` to wherever the server serves `/download`, then add to the
Caddyfile:

```
handle_path /download* {
    root * /srv/download
    file_server browse
}
```

Two things to set before the first real release:

- `src-tauri/tauri.conf.json` → `plugins.updater.endpoints` must be
  `https://<host>/download/latest.json`. It ships pointing at
  releases.hoppscotch.com, which we do not control.
- Generate a signing key with a password
  (`pnpm tauri signer generate -w ~/.tauri/topgun.key`) and keep it in CI, not
  on a laptop. Losing it means clients can no longer be updated.

Build per architecture: Apple Silicon and Intel Macs need separate builds
(`rustup target add x86_64-apple-darwin`), and Windows must be built on
Windows. `.github/workflows/build-hoppscotch-desktop.yml` does all of them.

---

## What a teammate does

```bash
curl -O https://apitool.example.com/download/Hoppscotch_26.8.1_aarch64.dmg
```

Open it, drag to Applications, launch, sign in with Google. That is the whole
flow.

**Download with `curl`, not a browser.** macOS attaches
`com.apple.quarantine` to anything a browser, Slack, or AirDrop writes, and
Gatekeeper then blocks an app we have not notarized. `curl`, MDM, and a
mounted share do not set it. Distributing through Jamf or Intune avoids the
question entirely; paying Apple $99/yr and notarizing is the other way out.

---

## Operating it

**Backups.** Everything anyone creates lives in one database.

```bash
docker compose -f docker-compose.prod.yml exec -T hoppscotch-db \
  pg_dump -U postgres hoppscotch | gzip > hoppscotch-$(date +%F).sql.gz
```

Put that on a schedule, and keep `DATA_ENCRYPTION_KEY` with it — a dump
without the key cannot be restored into a working instance.

**Upgrades.** `git pull && docker compose -f docker-compose.prod.yml up -d --build`.
Migrations run automatically before the app starts. Take a dump first.

**Changing config.** Most values are edited in the admin dashboard and take
effect on a restart the app performs itself. `GOOGLE_ALLOWED_DOMAINS` is the
exception in the other direction: it is read from `.env` on every restart, so
edit the file and restart.

**Secrets to protect:** `DATA_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`,
`GOOGLE_CLIENT_SECRET`, the Tauri signing key, and the onboarding recovery
token. `GOOGLE_ALLOWED_DOMAINS` is not a secret.
