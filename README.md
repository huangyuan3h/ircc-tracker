# IRCC Tracker Checker

Personal IRCC Application Status Tracker toolkit:

1. **Bash CLI** — macOS double-click / cron friendly
2. **Next.js SPA** — login with UCI + password, view a designed HTML report (Vercel Hobby ready)

## Features

- Cognito login + `get-profile-summary` / `get-application-details`
- HTML report with security timeline, IMM letter dictionary, Express Entry draw notes
- Bash: `.env` config, `jq` parsing, append-only `StatusCheck.txt`
- Web: glassmorphic login SPA, sticky report toolbar, dark-mode friendly

## Web SPA (Vercel)

Stack: **Next.js 16** · **React 19** · **Tailwind CSS v4** · **TypeScript 5.9**

### Local development

```bash
npm install
npm run dev
# open http://localhost:3000
```

On the login page, enter:

- **UCI** (same as Tracker username)
- **Tracker password**

Flow:

1. `POST /api/ircc/list` — validates credentials, returns applications
2. Navigate to `/report`
3. `POST /api/ircc/check` — auto-picks the first `APP_NUMBER`, fetches details, returns HTML
4. Report is shown in an iframe (`srcDoc`) using the TypeScript port of [`lib/render-report.jq`](lib/render-report.jq) ([`lib/render-report.ts`](lib/render-report.ts) + [`lib/ircc-events.json`](lib/ircc-events.json))

Password is kept in `sessionStorage` for the browser session only and is never written into the HTML report.

### Deploy to Vercel (Hobby / free)

Hobby is free for personal non-commercial use (hard monthly caps; app pauses if exceeded). See [Vercel Hobby](https://vercel.com/docs/plans/hobby).

```bash
npm i -g vercel
vercel
```

Or connect the GitHub repo in the Vercel dashboard.

[`vercel.json`](vercel.json) sets API `maxDuration` to **60s** (Hobby maximum).

**Security notes for a public Hobby URL**

- Anyone with the URL can hit `/api/ircc/*`
- Only use for yourself; do not share the deployment URL
- Do not commit real credentials

### API

| Endpoint | Body | Result |
|---|---|---|
| `POST /api/ircc/list` | `{ uci, password }` | `{ apps: [...] }` |
| `POST /api/ircc/check` | `{ uci, password, appNumber? }` | `{ appNumber, html }` |

Errors: `{ error, code }` where `code` is `auth` \| `query` \| `parse` \| `config` \| `usage`.

### Web tests

```bash
npm test
npm run build
```

## Bash CLI

### Requirements

- macOS with Bash, `curl`, Homebrew
- `jq` (required)
- Optional: `bats-core`, `shellcheck`

```bash
brew bundle
# or
brew install jq
```

### Setup

```bash
cp .env.example .env
chmod 600 .env
```

| Variable | Description |
|---|---|
| `TRACKER_USERNAME` | Cognito username (often your UCI) |
| `TRACKER_PASSWORD` | Cognito password |
| `APP_NUMBER` | Application number (or run `--list`) |
| `UCI_NUMBER` | UCI number |
| `LOG_PATH` | Optional log path (default: `./StatusCheck.txt`) |

### Usage

```bash
./ircc-check.sh
./ircc-check.sh --list
./ircc-check.sh --parse-file ./tests/fixtures/application-details.json
./ircc-check.sh --render-json /path/to/details.json
open StatusReport.html
```

Double-click [`ircc-check.command`](ircc-check.command) on macOS.

### Bash tests

```bash
bats tests/ircc-check.bats
# or
npm run test:bash
```

## Architecture

```text
Browser SPA  ->  /api/ircc/list|check  ->  Cognito + IRCC API
                                      ->  lib/render-report.ts + ircc-events.json

ircc-check.command -> ircc-check.sh -> jq + lib/render-report.jq
```

## Security

- Keep `.env` mode `600`; never commit passwords/tokens
- Status logs / HTML reports exclude credentials and bearer tokens
- Query your own Tracker account only; avoid aggressive polling

## Possible next steps

- Vercel Cron for daily checks + notifications
- Historical diff via Blob storage
- Optional app picker when an account has multiple applications
