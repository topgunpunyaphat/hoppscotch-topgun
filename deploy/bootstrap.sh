#!/usr/bin/env bash
# Finish the one part of setup that .env cannot do.
#
# VITE_ALLOWED_AUTH_PROVIDERS and the MAILER_* values are excluded from env
# sync, so a fresh instance ignores them in .env and sits at ONBOARDING_COMPLETED
# = false with no way to sign in. This posts them to the onboarding endpoint,
# which is what the setup wizard does.
#
# Safe to re-run: it reports and exits if onboarding is already complete.
#
#   ./deploy/bootstrap.sh                      # uses ./.env
#   ./deploy/bootstrap.sh /path/to/.env
set -euo pipefail

ENV_FILE="${1:-.env}"
[[ -f "$ENV_FILE" ]] || { echo "No env file at $ENV_FILE" >&2; exit 1; }

set -a; . "$ENV_FILE"; set +a

API="${VITE_BACKEND_API_URL:?VITE_BACKEND_API_URL missing from $ENV_FILE}"

echo "Backend: $API"

status=$(curl -sf --max-time 15 "$API/onboarding/status" || true)
[[ -n "$status" ]] || { echo "Backend is not answering. Is the stack up?" >&2; exit 1; }

if grep -q '"onboardingCompleted":true' <<<"$status"; then
  echo "Onboarding already complete — nothing to do."
  echo "To change sign-in later, use the admin dashboard at ${VITE_ADMIN_URL:-/admin}."
  exit 0
fi

providers="${VITE_ALLOWED_AUTH_PROVIDERS:?set VITE_ALLOWED_AUTH_PROVIDERS in $ENV_FILE}"

# Only send the keys for the providers actually in use; the endpoint rejects a
# provider whose own settings are incomplete.
payload=$(ENV_PROVIDERS="$providers" python3 - <<'PY'
import json, os

providers = os.environ["ENV_PROVIDERS"]
body = {"VITE_ALLOWED_AUTH_PROVIDERS": providers}

def put(*names):
    for n in names:
        v = os.environ.get(n, "")
        if v != "":
            body[n] = v

if "GOOGLE" in providers:
    put("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL", "GOOGLE_SCOPE")
if "GITHUB" in providers:
    put("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_CALLBACK_URL", "GITHUB_SCOPE")
if "MICROSOFT" in providers:
    put("MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_CALLBACK_URL",
        "MICROSOFT_SCOPE", "MICROSOFT_TENANT")

put("MAILER_SMTP_ENABLE", "MAILER_USE_CUSTOM_CONFIGS", "MAILER_ADDRESS_FROM",
    "MAILER_SMTP_URL", "MAILER_SMTP_HOST", "MAILER_SMTP_PORT", "MAILER_SMTP_SECURE",
    "MAILER_SMTP_USER", "MAILER_SMTP_PASSWORD", "MAILER_TLS_REJECT_UNAUTHORIZED",
    "MAILER_SMTP_IGNORE_TLS")

print(json.dumps(body))
PY
)

echo "Configuring sign-in: $providers"
response=$(curl -sf --max-time 30 -X POST "$API/onboarding/config" \
  -H "Content-Type: application/json" -d "$payload") || {
    echo "Onboarding rejected the request. A provider is usually missing one of" >&2
    echo "its required settings — check the *_CLIENT_ID/SECRET/CALLBACK_URL/SCOPE" >&2
    echo "values for each provider named in VITE_ALLOWED_AUTH_PROVIDERS." >&2
    exit 1
  }

token=$(python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' <<<"$response")

cat <<EOF

Done. The backend restarts itself to pick this up (about 10 seconds).

  Recovery token: $token

Store that token — it is what lets you re-run onboarding to change sign-in
settings later. It is not shown again.
EOF
