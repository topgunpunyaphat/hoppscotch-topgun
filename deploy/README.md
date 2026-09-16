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

## HTTPS is not optional

Desktop sign-in opens the system browser, the browser posts the tokens back to
a loopback listener inside the app, and Chrome only permits that when **both**
of these hold:

- the page is a **secure context** — so the server needs a real hostname and a
  real certificate; a bare IP over http will not do, and neither will a
  self-signed cert
- the listener answers the preflight with
  `Access-Control-Allow-Private-Network: true` — `src-tauri/src/server.rs` does
  this, and the layer that adds it must wrap `CorsLayer`, which otherwise
  answers the preflight itself and never calls inward

Miss either and sign-in fails with "Login Error" while the app looks healthy
and the listener never records a request. Google sign-in has the same
prerequisite from the other direction: Google rejects a redirect URI that is
`http://` or that names an IP address.

If a company hostname is slow to arrive, `<dashed-ip>.nip.io` resolves to that
IP and is a real enough domain for Let's Encrypt and for Google. It is a
third-party DNS service and its name lands in public Certificate Transparency
logs, so treat it as a bridge for a pilot, not a destination.

---

## Why the client needs no setup step

On a machine that has never run it, the app has no saved instances, so
`loadRecent()` falls through to `loadVendoredInstance()` and runs the web
bundle compiled into the binary. `deploy/build-client.sh` compiles that bundle
from the production `.env`, so it is already pointed at our backend. Install,
open, sign in.

`VITE_INSTANCE_SWITCHING_ENABLED=false` then hides the instance switcher, so
the app cannot be pointed anywhere else.

The product name has to stay alphanumeric. tauri-plugin-appload registers that
vendored bundle under `lowercase(productName)` but looks it up through a
sanitizer that rewrites every non-alphanumeric character to an underscore, so a
name containing spaces or dashes registers under one key and is fetched under
another — the window opens empty. `VITE_INSTANCE_SWITCHING_ENABLED` aside, this
is also why `WHITELISTED_ORIGINS` must list `app://<lowercase productName>`:
that is the origin the client sends from, and renaming the app moves it.

---

## Server, once

**1. Host and DNS.** A VM that stays on — 2 vCPU / 4 GB is enough to start.
Point an A record at it. Open 443, and open **80 to the whole internet**:
Let's Encrypt validates from addresses that cannot be predicted, so narrowing
it to an office range means no certificate. Nothing else needs to leave the
box.

Give it **40 GB**. Building the images on the host needs roughly 15 GB of
working space, far past the 8 GB an Ubuntu AMI defaults to, and a build that
runs out of room fails late and confusingly. On a host too small to build —
or to avoid installing a toolchain on it at all — build on a workstation of
the same architecture and ship the result:

```bash
docker save <image> | gzip | ssh <host> 'sudo docker load'
```

That works because the AIO image injects every `VITE_*` value at container
start rather than baking them in, so one image serves any environment.

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

**4. TLS.** The Caddyfile inside the AIO image binds a bare port, not a
hostname, so Caddy there never requests a certificate. Put a second Caddy in
front to terminate TLS and map the subpaths onto the AIO's ports — that also
avoids rebuilding the image on a host with little disk:

```
<host> {
    handle_path /backend*             { reverse_proxy hoppscotch-aio:3170 }
    handle_path /desktop-app-server*  { reverse_proxy hoppscotch-aio:3200 }
    handle_path /admin*               { reverse_proxy hoppscotch-aio:3100 }
    handle                            { reverse_proxy hoppscotch-aio:3000 }
}
```

With that in place the AIO's own ports never need publishing to the host.

**5. Start.**

```bash
docker compose -f docker-compose.prod.yml up -d
./deploy/bootstrap.sh
```

`bootstrap.sh` is not optional. `VITE_ALLOWED_AUTH_PROVIDERS` and the
`MAILER_*` values are excluded from env sync, so a fresh instance ignores them
in `.env` and sits with no way to sign in until onboarding is posted. Keep the
recovery token it prints.

Run it **before anyone signs in**. Onboarding may only be re-run while the
instance has no users at all (`canReRunOnboarding` is `usersCount === 0`), so
once someone has logged in the script refuses and sign-in settings have to be
changed from the admin dashboard, or through the `updateInfraConfigs` and
`enableAndDisableSSO` mutations, by a user who is already an admin.

Expect the backend to restart itself once or twice on the first boot after a
config change: it derives the OAuth callback URLs from `VITE_BACKEND_API_URL`
and restarts to pick them up. Requests fail during that window. It settles.

**6. First admin.** Sign in once with your own account, then:

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

One thing to set before the first real release:

- `src-tauri/tauri.conf.json` → `plugins.updater.endpoints` must be
  `https://<host>/download/latest.json`. It ships pointing at
  releases.hoppscotch.com, which we do not control.

The signing key lives at `~/.tauri/topgun-desktop.key` and its public half is
already in the three tauri configs. Back the private key up: every installed
client trusts only this key, so losing it means no client can ever be updated
again, and anyone holding it can publish an update those clients will install.

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

**Backups — set this up on day one.** Everything anyone creates lives in one
database, and a `DELETE` against it takes collections and environments with it
through the cascade. There is no undo.

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

---

## When something looks broken

Each of these cost real time to diagnose; the symptom rarely names the cause.

**The app window opens but stays blank.** The vendored bundle was registered
under one name and fetched under another. Check that
`VENDORED_INSTANCE_CONFIG.bundleName` still equals `productName` from
`tauri.conf.json`, and that the name is alphanumeric. The app log shows the
mismatch directly: files cached under one key, `Cache entry not found` for
another.

**The app opens and the workspace never loads.** Its origin is not in
`WHITELISTED_ORIGINS`. That origin is `app://<lowercase productName>`, so
renaming the app moves it. The list is exact-match and takes no wildcards.

**Sign-in ends at "Login Error".** The browser blocked the hand-back to the
app's loopback listener. See *HTTPS is not optional* above. Chrome's network
panel shows the request with only provisional headers — it never left the
browser, so the app's log will show nothing at all.

**Requests to external APIs fail from the browser but work in the app.** That
is CORS, and it is the target API's decision, not ours. The desktop client
routes through a native relay and is not subject to it. From a browser, either
the target has to send the header, or use the Hoppscotch extension or a
self-hosted proxy. Do not test this with a site that never sends CORS headers,
such as google.com — it can only fail.

**Team invitations produce no email.** `MAILER_SMTP_ENABLE` is not `true`.
`sendEmail` returns silently in that case, so the invitation row is created and
the UI reports success while nothing is sent. The invite is still usable: hand
the recipient `<base>/join-team?id=<invitation id>`.

**A setting changed in `.env` has no effect.** Most values are read from the
database after first boot; `.env` only seeds them. The exceptions are the keys
in `SYNC_ONLY_VARIABLES`, which are re-read on every restart —
`GOOGLE_ALLOWED_DOMAINS` is one of them, deliberately, so that who may sign in
travels with the deployment rather than being editable from a browser session.
