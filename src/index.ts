/**
 * index.ts
 *
 * Cloudflare Worker entry point.
 *
 * Routes:
 *   GET /              → HTML configuration UI
 *   GET /calendar      → Fetch, transform, and return the corrected ICS feed
 *   GET /health        → Simple health-check endpoint
 *
 * Query parameters for /calendar:
 *   url     (required) Outlook ICS source URL
 *   tz      (optional) IANA timezone, default: Europe/Berlin
 *   mode    (optional) passthrough | force | shift, default: force
 *   offset  (optional) manual UTC offset in minutes (used in shift mode)
 */

import { renderUi } from "./html.js";
import { transformIcs } from "./ics.js";
import {
  validateSourceUrl,
  validateTimezone,
  validateOffsetMinutes,
  validateMode,
} from "./validate.js";

// ─── Environment bindings type ────────────────────────────────────────────────

interface Env {
  DEFAULT_TZ?: string;
}

// ─── Fetch handler ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Only allow GET and HEAD
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    const path = url.pathname;

    if (path === "/" || path === "") {
      return handleUi(request, env);
    }

    if (path === "/calendar") {
      return handleCalendar(request, env);
    }

    if (path === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};

// ─── UI handler ───────────────────────────────────────────────────────────────

function handleUi(request: Request, env: Env): Response {
  const workerBase = new URL(request.url).origin;
  const defaultTz = env.DEFAULT_TZ ?? "Europe/Berlin";
  const html = renderUi({ workerUrl: workerBase, defaultTz });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ─── Calendar proxy / transform handler ──────────────────────────────────────

async function handleCalendar(request: Request, env: Env): Promise<Response> {
  const reqUrl = new URL(request.url);
  const params = reqUrl.searchParams;

  // ── Validate inputs ──────────────────────────────────────────────────────
  let sourceUrl: URL;
  try {
    const rawUrl = params.get("url") ?? "";
    if (!rawUrl) {
      return errorResponse(400, "Missing required parameter: url");
    }
    sourceUrl = validateSourceUrl(rawUrl);
  } catch (err) {
    return errorResponse(400, String(err instanceof Error ? err.message : err));
  }

  const defaultTz = env.DEFAULT_TZ ?? "Europe/Berlin";
  let tzid: string;
  try {
    tzid = validateTimezone(params.get("tz") ?? defaultTz);
  } catch (err) {
    return errorResponse(400, String(err instanceof Error ? err.message : err));
  }

  let mode: ReturnType<typeof validateMode>;
  try {
    mode = validateMode(params.get("mode"));
  } catch (err) {
    return errorResponse(400, String(err instanceof Error ? err.message : err));
  }

  let offsetMinutes: number | null;
  try {
    offsetMinutes = validateOffsetMinutes(params.get("offset"));
  } catch (err) {
    return errorResponse(400, String(err instanceof Error ? err.message : err));
  }

  // ── Fetch the upstream ICS ───────────────────────────────────────────────
  let upstreamResponse: Response;
  try {
    // Follow redirects manually so each target can be re-validated to avoid SSRF.
    const maxRedirects = 5;
    let currentUrl = sourceUrl;

    for (let i = 0; i <= maxRedirects; i++) {
      upstreamResponse = await fetch(currentUrl.toString(), {
        headers: {
          // Identify ourselves; some servers require a User-Agent
          "User-Agent": "CloudflareOutlookCalendarWorker/1.0",
          Accept: "text/calendar, */*",
        },
        // CF-specific: don't cache the upstream to ensure freshness
        cf: {
          cacheTtl: 0,
          cacheEverything: false,
        } as RequestInitCfProperties,
        redirect: "manual",
      });

      // If not a redirect (3xx with Location), use this response as-is.
      if (upstreamResponse.status < 300 || upstreamResponse.status >= 400) {
        break;
      }

      const location = upstreamResponse.headers.get("Location");
      if (!location) {
        break;
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        return errorResponse(502, "Upstream server returned an invalid redirect URL");
      }

      // Re-validate each redirect target to maintain SSRF protections.
      try {
        validateSourceUrl(nextUrl.toString());
      } catch (err) {
        return errorResponse(400, String(err instanceof Error ? err.message : err));
      }

      currentUrl = nextUrl;

      if (i === maxRedirects) {
        return errorResponse(502, "Too many redirects from upstream server");
      }
    }
  } catch (err) {
    return errorResponse(502, `Failed to fetch upstream calendar: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!upstreamResponse.ok) {
    return errorResponse(
      502,
      `Upstream server returned ${upstreamResponse.status} ${upstreamResponse.statusText}`
    );
  }

  // ── Parse and validate the upstream content ──────────────────────────────
  let icsText: string;
  try {
    icsText = await upstreamResponse.text();
  } catch (err) {
    return errorResponse(502, `Failed to read upstream response body: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!icsText.includes("BEGIN:VCALENDAR")) {
    return errorResponse(
      422,
      "The URL does not appear to return a valid iCalendar (ICS) feed. " +
        "Make sure the URL points directly to a .ics subscription link."
    );
  }

  // ── Transform ────────────────────────────────────────────────────────────
  let transformed: string;
  try {
    transformed = transformIcs(icsText, { tzid, offsetMinutes, mode });
  } catch (err) {
    return errorResponse(500, `Transformation error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Return the corrected ICS ─────────────────────────────────────────────
  return new Response(transformed, {
    headers: {
      // Correct MIME type for iCalendar per RFC 5545
      "Content-Type": "text/calendar; charset=utf-8",
      // The filename hint helps calendar clients name the subscription
      "Content-Disposition": 'attachment; filename="calendar.ics"',
      // Allow subscription clients to cache for up to 15 minutes
      "Cache-Control": "public, max-age=900",
      // Prevent MIME sniffing
      "X-Content-Type-Options": "nosniff",
      // Allow calendar clients running from any origin to subscribe
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return a plain-text error response. */
function errorResponse(status: number, message: string): Response {
  return new Response(`Error ${status}: ${message}\n`, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
