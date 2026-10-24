# Testing Expensly

Four layers, from fastest to most real.

| Layer | Where | Run with | What it proves |
| --- | --- | --- | --- |
| Unit tests | `lib/**/__tests__`, `app/**/__tests__`, `tests/` | `npm test` | The money maths, parsers, categoriser, AI plumbing, reminders and push work |
| Type check | the whole project | `npm run typecheck` | Nothing is wired up wrongly |
| Database security | `supabase/tests/security.sql` | Supabase SQL editor | Users can only ever reach their own data |
| Smoke tests | `scripts/smoke.mjs` | `npm run smoke` | The live site is up and refuses signed-out access |

GitHub Actions runs the type check and unit tests on every push and pull request (`.github/workflows/ci.yml`), and the smoke tests against production every morning (`smoke.yml`).

## Unit tests (Vitest)

```bash
npm test              # run once
npm run test:watch    # re-run on save
npx vitest run lib/ingest   # one folder
```

| Area | Files | Covers |
| --- | --- | --- |
| Money & dates | `money`, `dates` | Paise conversion, Indian number format (₹1,23,456, ₹1.2L), India-time "today", month maths, leap years |
| Data integrity | `taxonomy` | Every brand, keyword, item word and bank label points at a real category and subcategory; ids are unique; database seed matches |
| Spending maths | `finance`, `money-flows`, `income` | Net spend after refunds and paybacks, money in by kind, budgets carrying forward, safe-to-spend, cash flow, net worth |
| Analytics | `analytics`, `analytics-edge` | Weekday patterns (ignoring one-offs and days before your first transaction), unusual and double charges, fees, needs/wants, streaks, merchant profiles, health score bounds |
| Search | `search`, `search-more` | `swiggy >300 oct`, `is:in`, `is:refund`, categories, subcategories, months |
| Statement import | `ingest/*` | PDF table reading (wrapped and centred rows), balance check and sign repair, CSV variants (preambles, signed amounts, Cr/Dr), Indian date and amount formats, bank SMS from HDFC, ICICI, SBI and others, quick add, merchant cleaning, duplicate hashes |
| Categorising | `classify`, `payee`, `quick` | Brands, refunds, people, UPI-ID memory, gateway IDs ignored, everyday items for typed entries only |
| Export | `export` | CSV quoting, Excel byte-order mark, protection against formula injection |
| AI | `ai/provider`, `ai/gate`, `ai/tools` | Cheapest models only, provider order, streaming, tool calls, Gemini-safe schemas, model fallback, switching to the backup on quota/outage (and not on bad requests), allowlist, JSON parsing, every data tool |
| Reminders & push | `reminders`, `reminders-more`, `push`, `tests/service-worker` | Budget/bill/weekly rules, once-only keys, edge dates, VAPID signatures verified with the public key, push status handling, the service worker showing and opening notifications |
| API access | `app/api/__tests__/cron-auth` | The daily job refuses calls without the right secret |

Tests never touch the network or the database: `fetch` is stubbed with recorded-style responses (`tests/sse.ts`), and `server-only` is aliased to a stub in `vitest.config.ts`.

## Database security tests

`supabase/tests/security.sql` creates two throwaway users inside a transaction, acts as one of them through the `authenticated` role, and checks:

- you can't read, change or delete another user's transactions, budgets, notifications or devices
- you can't insert rows on someone else's behalf
- notifications can only be marked read, never written or rewritten
- server-only tables (`app_errors`, `merchant_ai_cache`) and functions are closed to users
- AI usage can't be written or reset, and the daily AI limit is enforced by the database
- signed-out visitors see nothing

It ends with `rollback`, so nothing is kept. Paste it into the Supabase SQL editor and run it; any failure stops with a message naming the broken rule.

## Smoke tests

```bash
npm run smoke                          # production
npm run smoke -- http://localhost:3000 # local
```

17 checks: public pages load; private pages redirect to sign-in; export, notifications, AI chat, the daily job and SMS ingest all refuse unauthenticated calls; the service worker, manifest, icons and PDF worker are served; and no secrets appear in page source.

## End-to-end journey (Playwright)

`e2e/journey.spec.ts` walks through Expensly as one new person, signed in: sign up → quick add →
give an uncategorised spend a category → import the sample statement → make a category with a
budget → Insights, Month in review, Wealth, iPhone capture setup → export → delete the account.

```bash
npm install --no-save @playwright/test@1.56.0 && npx playwright install chromium
E2E_BASE_URL=https://your-deployment.vercel.app npx playwright test
```

It signs up a throwaway `e2e-…@expensly.test` account. Those accounts never use AI, are left out of
the usage numbers and reminders, and the daily job deletes any older than two hours that a failed run
left behind.

## Automatic deploys

Every push to `main` runs typecheck, unit tests and a production build. If those pass and the
`VERCEL_TOKEN` repository secret is set, CI then:

1. builds for production and deploys it **without taking traffic**,
2. runs the end-to-end journey against that exact deployment,
3. only then points the live domain at it (`vercel promote`), and
4. smoke-tests the live site.

A failing step stops the release and the live site keeps the previous version. If Vercel deployment
protection is on, also add `VERCEL_AUTOMATION_BYPASS_SECRET`. `npm run deploy` still works for a manual
deploy from your Mac.
