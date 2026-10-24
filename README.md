# Expensly

Know what's safe to spend today. A budget tracker built for India: import a bank or card statement, and Expensly sorts every rupee, tells you how much you can spend per day, and warns you before a budget runs out. Installable on iPhone from Safari.

Built with Next.js 15 (App Router, React 19), Supabase (Postgres, auth, row-level security) and Vercel.

## Features

- **Overview**: safe-to-spend gauge, money in vs out, where it went, a daily spending calendar (with past months), cash flow, upcoming bills, and an AI morning brief
- **Activity**: search, filters, swipe right to approve and left to delete, tap to edit. Fixing one transaction re-files the others from the same payee (matched by UPI ID)
- **Import**: bank and card statements as CSV or PDF (including password-protected), read in the browser. A column-aware PDF reader checks the running balance on every row. Pasted bank SMS and quick add (`coke 70, auto 60, rent 12k`) work too. Duplicates and card bill payments (including CRED) are caught
- **Categorisation**: rules, a large list of Indian brands, UPI-ID memory, everyday item words, and the AI for whatever's left. AI answers go in a shared, anonymous merchant cache
- **Budgets**: per-category limits with a pace marker, and "Plan with AI" from your last three months
- **Insights**: health score, needs/wants/savings split against your income, trends, unusual charges and fees
- **Ask AI**: a chat that answers questions about your own money with charts. Uses the cheapest models only, with per-user daily limits, and automatically falls back to a second provider
- **Reminders**: budget warnings, bills due tomorrow and a Monday summary, sent as notifications (web push) and shown under the bell
- **Your data**: CSV and full JSON export, one-step account deletion, and a plain-language [privacy page](app/privacy/page.tsx)
- **App health** (owner only): errors from the server, browsers, the AI and the daily job, with a morning summary

## Run it locally

You need Node 20.9 or newer.

```bash
npm install
cp .env.example .env.local   # then fill it in, see below
npm run setup-push           # creates the reminder (web push) keys and cron secret
npm run dev
```

### Supabase

1. Create a project at [supabase.com](https://supabase.com) (the Mumbai region is closest for Indian users).
2. In **SQL Editor**, run every file in `supabase/migrations/` in order (`0001` → `0010`).
3. In **Authentication → Sign In / Providers**, keep Email on and turn **Confirm email** off. Expensly uses email + password and sends no emails.
4. In **Authentication → URL Configuration**, set the Site URL to your deployed address and add `<your address>/**` and `http://localhost:3000/**` as redirect URLs.
5. Copy the Project URL, the anon key and the service role key into `.env.local`.

### Environment variables

| Name | What it's for |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only: sign-up without email, account deletion, reminders, shared caches |
| `GEMINI_API_KEY` | Main AI provider (free tier works) |
| `GROQ_API_KEY` | Optional backup AI, used automatically when the first one is out of quota or down |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | Other supported providers. The first key set is used |
| `AI_DAILY_LIMIT`, `AI_PER_MINUTE`, `AI_MONTHLY_TOKENS` | Per-user AI limits (defaults: 30 / 5 / 1.5M) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push for reminders (`npm run setup-push`) |
| `CRON_SECRET` | Protects the daily reminder job (`npm run setup-push`) |
| `OWNER_EMAIL` | Gets the daily error report and sees Settings → App health |
| `CONTACT_EMAIL` | Optional, shown on the privacy page |

Never put the service role key, AI keys or VAPID private key in a variable starting with `NEXT_PUBLIC_`.

## Deploy

```bash
npm run deploy
```

This logs in to Vercel if needed, copies the variables above from `.env.local` to the production environment (without printing them), and deploys. `vercel.json` schedules the reminder job daily at 9:00 IST.

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | Local development |
| `npm test` | Unit tests (Vitest): parsers, categoriser, finance maths, reminders |
| `npm run typecheck` | TypeScript |
| `npm run deploy` | Deploy to Vercel |
| `npm run setup-push` | Generate web-push keys and the cron secret into `.env.local` |
| `npm run reset-password` | Set a user's password (admin) |

## Project layout

```
app/            pages, server actions and API routes (ask, export, ingest, cron, notifications)
components/     UI: home, activity, budgets, insights, wealth, settings, ask, charts
lib/ingest/     statement, SMS and quick-add parsing; categoriser and merchant list
lib/ai/         AI providers, tools, limits and fallback
lib/            finance maths, analytics, reminders, push, Supabase clients
supabase/       database migrations
public/sw.js    service worker for reminders
```
