# cloudflare-outlook-calendar-worker
[![Release](https://img.shields.io/github/v/release/jasonhaak/cloudflare-outlook-calendar-worker)](https://github.com/jasonhaak/cloudflare-outlook-calendar-worker/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/jasonhaak/cloudflare-outlook-calendar-worker/ci.yml?branch=main&logo=github)](https://github.com/jasonhaak/cloudflare-outlook-calendar-worker/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/github/jasonhaak/cloudflare-outlook-calendar-worker/graph/badge.svg)](https://codecov.io/github/jasonhaak/cloudflare-outlook-calendar-worker)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare)](https://workers.cloudflare.com/)

A Cloudflare Worker that acts as an iCal proxy and timezone normalization service for Microsoft Outlook calendar feeds. It fetches an Outlook ICS subscription URL, rewrites problematic date-time values and returns a corrected ICS feed that can be subscribed to from calendar clients.

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
- [Author & Licence](#author--licence)

## Features
- **Outlook ICS Proxy**: Fetches a public or signed Outlook ICS subscription URL and returns a corrected calendar feed
- **Timezone Normalization**: Converts UTC timestamps and annotates floating timestamps with a target timezone
- **Conversion Modes**: Supports `force`, `shift` and `passthrough` modes for converting timestamps
- **Embedded VTIMEZONE**: Inserts a matching `VTIMEZONE` block for `force` mode to ensure proper timezone handling in calendar clients
- **Generated Link Validation**: The UI checks that the generated `/calendar` URL returns a valid iCalendar feed before showing it as usable
- **SSRF Mitigation**: Blocks non-HTTP(S) URLs, private IPv4 ranges, common local hostnames, common IPv6 local ranges and cloud metadata endpoints
- **Redirect Revalidation**: Follows upstream redirects manually and validates each redirect target
- **Fetch Guardrails**: Applies redirect limits, request timeout handling and a maximum ICS size

## Quick Start
You will learn how to deploy the worker to Cloudflare, open the built-in UI and generate a corrected ICS link that can be used in your calendar app.

### 1. Prepare the Codebase
Cloudflare always requires a code source (repository or ZIP) to deploy a Worker. Choose one of the following:
- **Git (recommended)**: Fork this repository into your own GitHub/GitLab account.
- **ZIP (manual upload)**: Download the code as a ZIP file and prepare it for upload.

### 2. Add a Worker in Cloudflare
- Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
- Navigate to **Workers & Pages -> Workers** and create a new Worker with the name `cloudflare-outlook-calendar-worker`.

### 3. Add Environment Variables
> **Note**: See the [Environment Variables](#environment-variables) section below for variable descriptions and an example configuration.

There are multiple ways to provide environment variables for your Worker:
- Set them directly in the Cloudflare Dashboard (**Worker -> Settings -> Variables & Secrets**). This keeps sensitive values out of your source code and version control.
- You can define them in your `wrangler.toml` file (not recommended for secrets or sensitive data if your repository is public).
- You can deliver them through your CI/CD pipeline or other deployment automation.

> **Important:** If you deploy using **GitHub/GitLab integration**, any variables set in the Cloudflare Dashboard as plain text or JSON will be **overwritten** during deployment.
> To prevent this:
> - Option 1: Add `--keep-vars` to your deployment command in **Settings -> Build -> Deploy command** (e.g. `npx wrangler deploy --keep-vars`).
> - Option 2: Set your variables as *secrets* in the Dashboard, which are always preserved.

### 4. Deploy
- **Git**: Connect your forked repository directly to your GitHub/GitLab account in the Cloudflare Dashboard. Cloudflare will build and deploy automatically.
- **ZIP**: Upload your prepared ZIP file using the Dashboard’s editor or deployment UI.
- **Wrangler**: Deploy from your local checkout with `npm run deploy`.

> **Important:** When using Cloudflare Git integration, go to **Settings -> Build -> Branch Control** in your Worker project. Make sure to **deactivate** (uncheck) the option for enabling builds for non-production branches. If this setting is active, any push to your `develop` (or other non-production) branch will trigger a deployment to your Worker, which may not be desired for production stability.

### 5. Open the UI and use the Service

Open:

```text
https://<your-worker>.<your-subdomain>.workers.dev/
```

Paste your Outlook ICS URL, choose a target timezone or fixed UTC offset, and generate the corrected ICS subscription link. Use the generated URL as the subscription link in your calendar app.

## Environment Variables
This Worker only requires one optional environment variable.

### Variable Descriptions
| Variable | Required | Default | Description |
|---|---|---|---|
| `DEFAULT_TZ` | No | `Europe/Berlin` | IANA timezone used when the request does not include a `tz` parameter. |

### Example Configuration
```toml
DEFAULT_TZ = "Europe/Berlin"
```

## Endpoints
| Route | Description |
|---|---|
| `GET /` | Full HTML configuration UI. |
| `GET /?embed=1` | Iframe-friendly UI variant without footer or outer page chrome. |
| `GET /embed` | Iframe-friendly UI route. |
| `GET /calendar?url=...&tz=...&mode=...` | Fetches, validates, transforms and returns the corrected ICS feed. |
| `GET /health` | JSON health check. |

### `/calendar` Query Parameters
| Parameter | Required | Default | Description |
|---|---:|---|---|
| `url` | Yes | - | Source Outlook ICS subscription URL. Must be `http://` or `https://`. |
| `tz` | No | `DEFAULT_TZ` | IANA timezone used by `force` mode. Use `UTC` with `shift` mode for fixed-offset generation. |
| `mode` | No | `force` | One of `force`, `shift` or `passthrough`. |
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

The embed view removes the footer, outer spacing, shadow and rounded outer frame. The UI response also sends:

```text
Content-Security-Policy: frame-ancestors *
```

Adjust this header before production use if you only want specific domains to embed the UI.

## How it Works
Outlook ICS feeds can produce shifted event times in a calendar when timestamps are emitted as UTC values that represent local wall-clock time or when timestamps are floating values without `TZID` metadata.

This Worker supports three modes:

| Mode | Behavior | Best Use |
|---|---|---|
| `force` | Converts UTC timestamps to local wall-clock time in the target IANA timezone, annotates floating timestamps with `TZID` and injects `VTIMEZONE`. | Default and recommended mode. |
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
When the user generates a link through the UI, the browser immediately requests the generated `/calendar` URL. The result is shown only if the response is successful, has a `text/calendar` content type and contains `BEGIN:VCALENDAR`. Otherwise, the UI displays a red error message and does not show the generated link as usable.

## Installation & Development
1. **Clone the Repository**
    ```bash
    git clone https://github.com/jasonhaak/cloudflare-outlook-calendar-worker.git
    cd cloudflare-outlook-calendar-worker
    ```
2. **Install Dependencies**
    ```bash
    npm install
    ```
3. **Configure Environment Variables**
    - You can set environment variables in your `wrangler.toml` file or via the Cloudflare dashboard.
4. **Deploy the Worker**
    ```bash
    npm run deploy
    ```

## Testing
This project uses **Vitest** for unit tests. Run the suite locally:

```bash
npm test
```

The test suite covers the core ICS transformation logic, timestamp parsing and conversion, VTIMEZONE generation, URL validation, timezone validation, offset validation, mode validation, and SSRF-related source URL checks. The `/calendar` fetch handler is currently verified through type checking and Wrangler dry-run bundling, not through dedicated request-level unit tests.

## Author & Licence
This code was written by Jason Haak and is licensed under the MIT licence.
