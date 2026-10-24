#!/usr/bin/env bash
# Deploys Expensly to Vercel. Run from the project folder: npm run deploy
# First run: logs you in to Vercel (opens the browser) and creates the project.
# Copies the Supabase and Anthropic settings from .env.local to Vercel without printing them.
set -uo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then echo "No .env.local found. Fill it in first (see .env.example)."; exit 1; fi

VERCEL="npx --yes vercel@latest"

echo "→ Checking Vercel login…"
$VERCEL whoami >/dev/null 2>&1 || $VERCEL login

echo "→ Linking this folder to a Vercel project…"
[ -f .vercel/project.json ] || $VERCEL link --yes --project kosh

echo "→ Copying environment variables to Vercel production (values are not shown)…"
for NAME in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY ANTHROPIC_API_KEY ANTHROPIC_MODEL OPENAI_API_KEY GEMINI_API_KEY GROQ_API_KEY OPENROUTER_API_KEY AI_MODEL AI_ALLOWED_EMAILS AI_DAILY_LIMIT AI_PER_MINUTE AI_MONTHLY_TOKENS AI_DAILY_LIMIT_OWN AI_PER_MINUTE_OWN AUTH_GOOGLE NEXT_PUBLIC_VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT CRON_SECRET OWNER_EMAIL CONTACT_EMAIL; do
  # Accepts NAME=value and NAME = value, with or without quotes.
  VALUE="$(grep -E "^[[:space:]]*${NAME}[[:space:]]*=" .env.local | tail -1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
  if [ -z "$VALUE" ]; then continue; fi
  $VERCEL env rm "$NAME" production --yes </dev/null >/dev/null 2>&1 || true
  if printf '%s' "$VALUE" | $VERCEL env add "$NAME" production >/dev/null 2>&1; then
    echo "   ✓ $NAME"
  else
    echo "   ! couldn't copy $NAME (set it in Vercel → Settings → Environment Variables)"
  fi
done

echo "→ Building and deploying (takes 1–2 minutes)…"
URL="$($VERCEL deploy --prod --yes)" || { echo; echo "✗ Deploy failed. Copy the lines above and send them to Claude."; exit 1; }
echo
echo "✅ Expensly is live: $URL"
echo
echo "One last step in Supabase (Authentication → URL Configuration):"
echo "   Site URL:       your production domain, e.g. https://expensly-abc.vercel.app (shown under Domains on the Vercel project page)"
echo "   Redirect URLs:  add  <that domain>/**   and keep  http://localhost:3000/**"
