/**
 * index.ts
 *
 * Cloudflare Worker entry point.
 *
 * Routes:
 *   GET /              → HTML configuration UI
 *   GET /embed         → iframe-friendly HTML configuration UI
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

const MAX_REDIRECTS = 5;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_ICS_BYTES = 2_000_000;

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

    if (path === "/" || path === "" || path === "/embed") {
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
  const requestUrl = new URL(request.url);
  const workerBase = requestUrl.origin;
  const defaultTz = env.DEFAULT_TZ ?? "Europe/Berlin";
  const embedded = requestUrl.pathname === "/embed" || requestUrl.searchParams.get("embed") === "1";
  const html = renderUi({ workerUrl: workerBase, defaultTz, embedded });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Content-Security-Policy": "frame-ancestors *",
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
    upstreamResponse = await fetchUpstreamCalendar(sourceUrl);
  } catch (err) {
    if (err instanceof UpstreamError) {
      return errorResponse(err.status, err.message);
    }
    return errorResponse(
      502,
      `Failed to fetch upstream calendar: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!upstreamResponse.ok) {
    return errorResponse(
      502,
      `Upstream server returned ${upstreamResponse.status} ${upstreamResponse.statusText}`
    );
  }

  const contentLength = upstreamResponse.headers.get("Content-Length");
  if (contentLength !== null) {
    const bytes = Number(contentLength);
    if (Number.isFinite(bytes) && bytes > MAX_ICS_BYTES) {
      return errorResponse(413, "Upstream calendar is too large to process.");
    }
  }

  // ── Parse and validate the upstream content ──────────────────────────────
  let icsText: string;
  try {
    icsText = await upstreamResponse.text();
  } catch (err) {
    return errorResponse(502, `Failed to read upstream response body: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (new TextEncoder().encode(icsText).length > MAX_ICS_BYTES) {
    return errorResponse(413, "Upstream calendar is too large to process.");
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

class UpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function fetchUpstreamCalendar(sourceUrl: URL): Promise<Response> {
  let currentUrl = sourceUrl;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(currentUrl.toString(), {
        headers: {
          "User-Agent": "CloudflareOutlookCalendarWorker/1.0",
          Accept: "text/calendar, */*",
        },
        cf: {
          cacheTtl: 0,
          cacheEverything: false,
        } as RequestInitCfProperties,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new UpstreamError(504, "Upstream calendar request timed out.");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get("Location");
    if (!location) {
      return response;
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      throw new UpstreamError(502, "Upstream server returned an invalid redirect URL");
    }

    try {
      validateSourceUrl(nextUrl.toString());
    } catch (err) {
      throw new UpstreamError(400, String(err instanceof Error ? err.message : err));
    }

    if (i === MAX_REDIRECTS) {
      throw new UpstreamError(502, "Too many redirects from upstream server");
    }

    currentUrl = nextUrl;
  }

  throw new UpstreamError(502, "Too many redirects from upstream server");
}

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
