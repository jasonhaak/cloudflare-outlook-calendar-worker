# cloudflare-outlook-calendar-worker
[![Release](https://img.shields.io/github/v/release/jasonhaak/cloudflare-outlook-calendar-worker)](https://github.com/jasonhaak/cloudflare-outlook-calendar-worker/releases/latest)
[![Tests](https://img.shields.io/badge/tests-75%20passing-282828)](#testing)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-282828?logo=typescript)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare)](https://workers.cloudflare.com/)

A Cloudflare Worker that acts as an iCal proxy and timezone normalization
service for Microsoft Outlook calendar feeds. It fetches an Outlook ICS
subscription URL, rewrites problematic date-time values, and returns a corrected
ICS feed that can be subscribed to from Google Calendar or other calendar
clients.

The Worker also serves a lightweight HTML UI for generating and validating
corrected ICS subscription links. The UI can be used standalone or embedded in
another site through an iframe-friendly route.

## Table of Contents
- [Features](#features)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
  - [Variable Descriptions](#variable-descriptions)
  - [Example Configuration](#example-configuration)
- [Endpoints](#endpoints)
- [Iframe Usage](#iframe-usage)
- [How it Works](#how-it-works)
- [Installation & Development](#installation--development)
- [Testing](#testing)
- [Limitations](#limitations)
- [Future Improvements](#future-improvements)
- [Author & Licence](#author--licence)

## Features
- **Outlook ICS Proxy**: Fetches a public or signed Outlook ICS subscription URL and returns a corrected calendar feed.
- **Timezone Normalization**: Converts UTC timestamps and annotates floating timestamps with a target timezone.
- **Three Conversion Modes**: Supports `force`, `shift`, and `passthrough` modes.
- **DST-Aware Conversion**: Uses the runtime `Intl` API for IANA timezone conversion in `force` mode.
- **Fixed UTC Offset Support**: The UI can generate `shift` mode links from a fixed UTC offset when no IANA timezone should be used.
- **Embedded VTIMEZONE**: Inserts a matching `VTIMEZONE` block for `force` mode.
- **Generated Link Validation**: The UI checks that the generated `/calendar` URL returns a valid iCalendar feed before showing it as usable.
- **Iframe-Friendly UI**: Provides `/embed` and `/?embed=1` for embedding the generator in another site.
- **SSRF Mitigation**: Blocks non-HTTP(S) URLs, private IPv4 ranges, common local hostnames, common IPv6 local ranges, and cloud metadata endpoints.
- **Redirect Revalidation**: Follows upstream redirects manually and validates each redirect target.
- **Fetch Guardrails**: Applies redirect limits, request timeout handling, and a maximum ICS size.
- **Zero Runtime Dependencies**: Runs as pure Cloudflare Workers TypeScript.

## Quick Start
You will deploy the Worker to Cloudflare, open the built-in UI, paste an Outlook
ICS subscription URL, and generate a corrected ICS link that can be used in your
calendar app.

### 1. Prepare the Codebase
Cloudflare needs a code source to deploy a Worker. Choose one of the following:
- **Git (recommended)**: Fork this repository into your own GitHub/GitLab account.
- **ZIP (manual upload)**: Download the repository as a ZIP file and upload it through Cloudflare.

### 2. Add a Worker in Cloudflare
- Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
- Navigate to **Workers & Pages -> Workers**.
- Create a new Worker named `cloudflare-outlook-calendar-worker`.

### 3. Configure the Default Timezone
Set `DEFAULT_TZ` to the timezone that should be used when no `tz` query
parameter is provided.

The default in this repository is:

```toml
DEFAULT_TZ = "Europe/Berlin"
```

### 4. Deploy
Deploy with Wrangler:

```bash
npm install
npm run deploy
```

After deployment, open:

```text
https://<your-worker>.<your-subdomain>.workers.dev/
```

Paste your Outlook ICS URL, choose a target timezone or fixed UTC offset, and
generate the corrected ICS subscription link.

## Environment Variables
This Worker only requires one optional environment variable.

### Variable Descriptions
| Variable | Required | Default | Description |
|---|---:|---|---|
| `DEFAULT_TZ` | No | `Europe/Berlin` | IANA timezone used when the request does not include a `tz` parameter. |

### Example Configuration
In `wrangler.toml`:

```toml
name = "cloudflare-outlook-calendar-worker"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[vars]
DEFAULT_TZ = "Europe/Berlin"
```

For private deployments, you can also set variables in the Cloudflare Dashboard
under **Worker -> Settings -> Variables & Secrets**.

## Endpoints
| Route | Description |
|---|---|
| `GET /` | Full HTML configuration UI. |
| `GET /?embed=1` | Iframe-friendly UI variant without footer or outer page chrome. |
| `GET /embed` | Iframe-friendly UI route. |
| `GET /calendar?url=...&tz=...&mode=...` | Fetches, validates, transforms, and returns the corrected ICS feed. |
| `GET /health` | JSON health check. |

### `/calendar` Query Parameters
| Parameter | Required | Default | Description |
|---|---:|---|---|
| `url` | Yes | - | Source Outlook ICS subscription URL. Must be `http://` or `https://`. |
| `tz` | No | `DEFAULT_TZ` | IANA timezone used by `force` mode. Use `UTC` with `shift` mode for fixed-offset generation. |
| `mode` | No | `force` | One of `force`, `shift`, or `passthrough`. |
| `offset` | No | Auto | UTC offset in minutes. Used only by `shift` mode. Valid range is `-840` to `840`. |

### Example URLs
Force TZID mode for Europe/Berlin:

```text
https://your-worker.workers.dev/calendar?url=https%3A%2F%2Foutlook.office365.com%2F...&tz=Europe%2FBerlin&mode=force
```

Shift mode with explicit UTC+1 offset:

```text
https://your-worker.workers.dev/calendar?url=https%3A%2F%2Foutlook.office365.com%2F...&tz=UTC&mode=shift&offset=60
```

Passthrough mode:

```text
https://your-worker.workers.dev/calendar?url=https%3A%2F%2Foutlook.office365.com%2F...&mode=passthrough
```

## Iframe Usage
Use `/embed` or `/?embed=1` when embedding the generator in another page.

```html
<iframe
  src="https://your-worker.workers.dev/embed"
  style="width: 100%; height: 760px; border: 0;"
></iframe>
```

The embed view removes the footer, outer spacing, shadow, and rounded outer
frame. The UI response also sends:

```text
Content-Security-Policy: frame-ancestors *
```

Adjust this header before production use if you only want specific domains to
embed the UI.

## How it Works
Outlook ICS feeds can produce shifted event times in Google Calendar when
timestamps are emitted as UTC values that represent local wall-clock time, or
when timestamps are floating values without `TZID` metadata.

This Worker supports three modes:

| Mode | Behavior | Best Use |
|---|---|---|
| `force` | Converts UTC timestamps to local wall-clock time in the target IANA timezone, annotates floating timestamps with `TZID`, and injects `VTIMEZONE`. | Default and recommended mode. |
| `shift` | Adds a fixed minute offset to UTC timestamps and emits floating timestamps. | Troubleshooting or fixed-offset calendars. Not DST-aware. |
| `passthrough` | Returns the upstream ICS feed unchanged. | Debugging source URL reachability. |

### Timestamp Handling
| Input Type | Example | `force` Mode Result |
|---|---|---|
| UTC timestamp | `DTSTART:20240615T100000Z` | Converted to local wall-clock time and emitted with `TZID`. |
| Floating timestamp | `DTSTART:20240615T120000` | Time is preserved and emitted with `TZID`. |
| Existing `TZID` timestamp | `DTSTART;TZID=America/New_York:20240615T120000` | Left unchanged. |
| All-day date | `DTSTART;VALUE=DATE:20240615` | Left unchanged. |

### UI Validation
When the user generates a link through the UI, the browser immediately requests
the generated `/calendar` URL. The result is shown only if the response is
successful, has a `text/calendar` content type, and contains `BEGIN:VCALENDAR`.
Otherwise, the UI displays a red error message and does not show the generated
link as usable.

## Installation & Development
### Prerequisites
- Node.js 18+
- npm
- A Cloudflare account
- Wrangler CLI, installed through this repository's dev dependencies

### Install Dependencies
```bash
npm install
```

### Run Locally
```bash
npm run dev
```

Open the local Wrangler URL, usually:

```text
http://localhost:8787/
```

### Type Check
```bash
npm run type-check
```

### Deploy
```bash
npm run deploy
```

## Testing
Run the unit test suite:

```bash
npm test
```

Run TypeScript checks:

```bash
npm run type-check
```

Run a local Wrangler bundle check without deploying:

```bash
XDG_CONFIG_HOME=/tmp/wrangler-config npx wrangler deploy --dry-run
```

Current local verification:
- `npm test`: 75 tests passing
- `npm run type-check`: passing
- `npx wrangler deploy --dry-run`: passing when Wrangler's config/log path is writable

## Limitations
| Area | Notes |
|---|---|
| Recurrence rules | `RRULE` values are not rewritten. `RECURRENCE-ID`, `EXDATE`, and `RDATE` are transformed when they carry date-time values. |
| DST boundaries | `force` mode uses `Intl` timezone data, but ambiguous local times around DST transitions can still be tricky for calendar clients. |
| VTIMEZONE coverage | Common European and US zones use hand-written rules. Other zones use a probed approximation unless the calendar client resolves the IANA timezone itself. |
| Protected feeds | Password-protected Outlook feeds are not supported. Outlook's public/signed subscription URLs are the expected input. |
| SSRF | The Worker blocks common private/local targets and revalidates redirects, but DNS rebinding cannot be fully mitigated at the Worker code layer alone. |
| Large feeds | Upstream ICS responses larger than the configured size limit are rejected. |

## Future Improvements
- Store named presets in Cloudflare KV and expose short stable URLs.
- Add scheduled background refresh and cache warming through Cron Triggers.
- Support merging multiple source calendars into one ICS feed.
- Replace approximate fallback `VTIMEZONE` generation with bundled tzdata.
- Add GitHub Actions and coverage publishing if public CI is desired.

## Author & Licence
Copyright (c) 2026 Jason Haak.

Released under the [MIT License](LICENSE).
