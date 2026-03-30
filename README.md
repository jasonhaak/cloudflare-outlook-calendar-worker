# cloudflare-outlook-calendar-worker

A production-ready Cloudflare Worker that acts as an **iCal proxy and timezone
normalization service** for Microsoft Outlook calendar feeds.

## The Problem

Outlook ICS subscription links sometimes cause events to appear shifted by 1–2
hours in Google Calendar. This happens because:

1. Outlook may emit timestamps as **UTC** (`DTSTART:20240315T120000Z`), where the
   `Z` suffix means absolute UTC time. If the event was created at 12:00 in a
   UTC+1 timezone, it should have been emitted as `11:00Z`, but Outlook sometimes
   gets this wrong — or Google Calendar's interpretation diverges.
2. Outlook may emit **floating timestamps** (`DTSTART:20240315T120000`, no `Z`,
   no `TZID`), which have no timezone annotation. Google Calendar interprets
   these as UTC, shifting them by the user's UTC offset.

This Worker fetches any Outlook ICS feed and re-emits it with proper
**TZID-annotated timestamps** and an embedded `VTIMEZONE` block, so the events
appear at the correct local time in Google Calendar and other clients.

---

## Features

- 🔄 **Proxy any Outlook ICS URL** via a single `?url=` query parameter
- 🕐 **Three transformation modes**: `force` (DST-aware TZID), `shift` (fixed offset), `passthrough`
- 🌍 **DST-aware conversion** using the Intl API — no timezone library required
- 🛡️ **SSRF prevention** — blocks private IP ranges and non-HTTP(S) URLs
- 📱 **Lightweight HTML UI** served by the Worker itself
- ✅ **71 unit tests** covering all transformation modes and edge cases
- 🚀 **Zero runtime dependencies** — pure Cloudflare Workers TypeScript

---

## Endpoints

| Route | Description |
|---|---|
| `GET /` | HTML configuration UI |
| `GET /calendar?url=…&tz=…&mode=…` | Returns the corrected ICS feed |
| `GET /health` | JSON health-check |

### `/calendar` query parameters

| Parameter | Required | Default | Description |
|---|---|---|---|
| `url` | ✅ | — | Outlook ICS source URL |
| `tz` | | `Europe/Berlin` | IANA timezone (e.g. `America/New_York`) |
| `mode` | | `force` | `force` \| `shift` \| `passthrough` |
| `offset` | | auto | Manual UTC offset in minutes (used in `shift` mode) |

### Example URLs

```
# Force TZID mode for Europe/Berlin (recommended)
https://your-worker.workers.dev/calendar?url=https%3A%2F%2Foutlook.office365.com%2F...&tz=Europe%2FBerlin&mode=force

# Shift mode with explicit +60-minute offset
https://your-worker.workers.dev/calendar?url=https%3A%2F%2Foutlook.office365.com%2F...&tz=Europe%2FBerlin&mode=shift&offset=60

# Passthrough — proxy without modifying
https://your-worker.workers.dev/calendar?url=https%3A%2F%2Foutlook.office365.com%2F...&mode=passthrough
```

---

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### Local development

```bash
# Install dependencies
npm install

# Run the Worker locally (hot-reload)
npm run dev

# Run tests
npm test

# TypeScript type check
npm run type-check
```

### Deploy to Cloudflare Workers

```bash
# Authenticate with Cloudflare (first time only)
npx wrangler login

# Deploy
npm run deploy
```

The Worker will be available at `https://cloudflare-outlook-calendar-worker.<your-subdomain>.workers.dev`.

---

## Timezone Normalization Strategy

### Background: three timestamp types in RFC 5545

| Type | Example | Interpretation |
|---|---|---|
| **UTC** (absolute) | `DTSTART:20240315T110000Z` | 11:00 UTC exactly. Clients display in user's local time. |
| **Floating** (local) | `DTSTART:20240315T120000` | 12:00 in "some" local time — ambiguous. Google uses UTC. |
| **TZID-based** | `DTSTART;TZID=Europe/Berlin:20240315T120000` | 12:00 in Europe/Berlin. Unambiguous. ✅ |

### Chosen strategy: `force` mode (TZID injection)

**Why**: The most correct fix is to turn all timestamps into unambiguous
TZID-based form, which every modern calendar client supports. This avoids
global string replacement and properly handles DST transitions.

**How it works**:
1. Unfold RFC 5545 folded lines.
2. For each date-time property (`DTSTART`, `DTEND`, `EXDATE`, `RDATE`, etc.):
   - **UTC timestamps (`Z`)**: Convert wall-clock time to the target timezone
     using `Intl.DateTimeFormat` (which is DST-aware), strip the `Z`, add
     `TZID=<tzid>` parameter.
   - **Floating timestamps**: Add `TZID=<tzid>` parameter, keep the time value
     (we trust the event creator intended that wall-clock time in that timezone).
   - **TZID-annotated timestamps**: Leave untouched.
   - **All-day (`VALUE=DATE`)**: Leave untouched.
3. Remove existing `VTIMEZONE` blocks and inject a fresh, correct one.
4. Re-fold output lines and return with `text/calendar` content type.

### Example: before / after

**Before** (UTC timestamp, shows 1 hour late in Europe/Berlin):
```
DTSTART:20240615T100000Z
DTEND:20240615T110000Z
```

**After** (`force` mode, `tz=Europe/Berlin`):
```
DTSTART;TZID=Europe/Berlin:20240615T120000
DTEND;TZID=Europe/Berlin:20240615T130000
```
(June → CEST = UTC+2, so 10:00Z becomes 12:00 local)

**Before** (floating timestamp, Google Calendar misinterprets as UTC):
```
DTSTART:20240115T120000
```

**After** (`force` mode, `tz=Europe/Berlin`):
```
DTSTART;TZID=Europe/Berlin:20240115T120000
```
(Time value preserved, TZID annotation added)

**Before** (all-day event — should never be modified):
```
DTSTART;VALUE=DATE:20240315
```

**After** (unchanged ✅):
```
DTSTART;VALUE=DATE:20240315
```

---

## Limitations

| Area | Notes |
|---|---|
| **Recurrence rules** | `RRULE` properties are not modified. `RECURRENCE-ID` and `EXDATE` are transformed consistently with `DTSTART`. DST ambiguity at transition boundaries could affect one-off recurrence exceptions. |
| **DST transitions** | The Intl API is authoritative but the exact DST transition moment (e.g. 02:00 local → 03:00) can make times near the boundary ambiguous. This affects at most ~1 hour per year. |
| **Malformed ICS** | Feeds that deviate significantly from RFC 5545 (e.g. missing `BEGIN:VCALENDAR`) are rejected with a clear error. Minor deviations (e.g. LF-only line endings) are tolerated. |
| **SSRF** | Private IP ranges and non-HTTP(S) schemes are blocked. DNS rebinding attacks are not fully mitigatable at the Worker layer; a Cloudflare Gateway policy is recommended for production. |
| **Timezone coverage** | The `force` mode uses the Intl API for conversion, which covers all IANA timezones. The VTIMEZONE block uses hand-crafted data for ~15 common European/US zones and a probed approximation for others. |
| **Credential-protected feeds** | Outlook ICS subscription URLs are typically public/signed and do not require authentication. Password-protected feeds are not supported. |

---

## Possible Future Improvements

- **Preset storage**: Store named configurations (URL + timezone + mode) in
  Cloudflare KV so users can share short links like `/preset/my-work-cal`.
- **Permanent share links**: Generate a stable hash of the configuration
  and serve it as a short URL, e.g. `/c/abc123` → ICS output.
- **Background refresh**: Use Cloudflare Cron Triggers to pre-fetch and cache
  ICS feeds, improving latency for subscribers and reducing load on Outlook.
- **Multiple calendar merge**: Accept multiple `url=` parameters and merge the
  ICS feeds into a single output calendar.
- **VTIMEZONE completeness**: Bundle a full `tzdata` snapshot (via
  `@touch4it/ical-timezones` or similar) for perfect VTIMEZONE generation for
  any IANA timezone.