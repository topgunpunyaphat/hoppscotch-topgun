# Topgun - API Tool

An internal API testing tool for Topgun, built on a fork of
[Hoppscotch](https://github.com/hoppscotch/hoppscotch).

Everything upstream does — REST, GraphQL, WebSocket, SSE, Socket.IO, MQTT,
collections, environments, scripting, the collection runner, mock servers,
published docs, the CLI — works here unchanged. This README covers what is
different and how to run it; for the product itself the
[Hoppscotch documentation](https://docs.hoppscotch.io) still applies.

**Deploying it is documented separately in [`deploy/README.md`](deploy/README.md).**

---

## What this fork changes

**Sign-in is restricted to company domains.** Upstream creates an account for
any address the identity provider returns, so an instance reachable from the
internet is open registration. `GOOGLE_ALLOWED_DOMAINS` gates that before the
lookup, so a rejected address never probes for or creates an account. Leave it
empty and behaviour is unchanged.

**Team environments can share secret values.** Upstream keeps secret variable
values on each member's own machine, so a team cannot share a credential at
all. With `TEAM_SECRET_VAULT_ENABLED=true` a secret's value is stored
server-side, encrypted at rest, and shared with every member of the team. The
server is the authority: while the vault is off it strips secrets on both read
and write, so turning it off hides stored secrets without destroying them.
Writes are always audited with the actor and the secret key names — never the
values.

**Workspaces have shareable join links.** Upstream invites one email address at
a time. An owner can now generate a link and paste it into chat; anyone who can
sign in and opens it joins with the role the link carries. What keeps a
forwarded link inside the company is the sign-in gate above.

**The desktop client ships preconfigured.** `deploy/build-client.sh` compiles
the server URLs into the bundle the app runs on a fresh machine, so installing
it is the whole setup — no hostname to type, no instance to add. It is signed
with our own updater key, not the upstream one.

**Deployment is scripted.** [`deploy/`](deploy) carries a production compose
file, an onboarding bootstrap that covers settings `.env` cannot reach, a
client build script, and a release-manifest generator for auto-update.

---

## Installing the client

Fetch it from the server the app talks to:

```bash
curl -O https://<host>/download/Topgun-API-Tool.dmg
shasum -a 256 Topgun-API-Tool.dmg    # compare against the published checksum
```

Open it, drag to Applications, sign in. There is nothing else to configure —
the server URL is compiled into the build.

**Download with `curl`, not a browser.** macOS attaches
`com.apple.quarantine` to anything a browser, Slack, or AirDrop writes, and
Gatekeeper then refuses to open an app that is not notarised. `curl`, `scp`,
and MDM do not set it. Distributing through Jamf or Intune sidesteps the
question; notarising through an Apple Developer account is the other way out.

Whoever is downloading needs to reach the host, so their address has to be in
the server's security group. Builds are per-architecture — an Apple Silicon
`.dmg` will not run on an Intel Mac.

`deploy/make-release.sh` assembles the installers and the manifest the
auto-updater polls; [`deploy/README.md`](deploy/README.md) covers publishing.

---

## Repository layout

Upstream's packages, unchanged in structure:

| Package | What it is |
| --- | --- |
| `hoppscotch-backend` | NestJS + GraphQL + Prisma. Teams, auth, the vault. |
| `hoppscotch-common` | The Vue app every client shares. |
| `hoppscotch-selfhost-web` | The web build and its platform bindings. |
| `hoppscotch-sh-admin` | Admin dashboard. |
| `hoppscotch-desktop` | Tauri shell for the desktop client. |
| `hoppscotch-cli` | `hopp test` for CI. |
| `hoppscotch-relay` | Native request relay — how the desktop client escapes CORS. |

---

## Working on it

```bash
pnpm install
pnpm dev
```

Tests and checks, per package:

```bash
pnpm --dir packages/hoppscotch-backend test
pnpm --dir packages/hoppscotch-common test
pnpm --dir packages/hoppscotch-backend exec tsc --noEmit -p tsconfig.json
```

Two things bite on a fresh checkout:

- Several packages build artifacts other packages import. If a build fails
  resolving `@hoppscotch/data`, `@hoppscotch/kernel` or
  `@hoppscotch/codemirror-lang-graphql`, build that package first.
- `vue-tsc` 2.2.0 does not run against this repo's TypeScript. Type errors in
  `.vue` files surface at build time instead.

---

## Keeping up with upstream

This fork tracks `hoppscotch/hoppscotch`. Changes are kept narrow and
explained in their commit messages so a merge conflict is readable rather than
archaeological.

---

## License

MIT, inherited from Hoppscotch — see [`LICENSE`](LICENSE). The upstream project
and its [contributors](https://github.com/hoppscotch/hoppscotch/graphs/contributors)
did the work this is built on.
