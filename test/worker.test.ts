import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";

const env = { DEFAULT_TZ: "Europe/Berlin" };

const SAMPLE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//EN",
  "BEGIN:VEVENT",
  "DTSTART:20240115T110000Z",
  "DTEND:20240115T120000Z",
  "SUMMARY:Test",
  "UID:test@example.com",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://worker.example.com${path}`, init);
}

async function responseText(response: Response): Promise<string> {
  return response.text();
}

describe("worker fetch handler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("rejects unsupported methods", async () => {
    const response = await worker.fetch(request("/", { method: "POST" }), env);

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("serves the UI with iframe-friendly headers", async () => {
    const response = await worker.fetch(request("/?embed=1"), env);
    const body = await responseText(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Content-Security-Policy")).toBe("frame-ancestors *");
    expect(body).toContain('<body class="embedded">');
  });

  it("serves the /embed UI route", async () => {
    const response = await worker.fetch(request("/embed"), env);
    const body = await responseText(response);

    expect(response.status).toBe(200);
    expect(body).toContain('<body class="embedded">');
  });

  it("serves the health check", async () => {
    const response = await worker.fetch(request("/health"), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown routes", async () => {
    const response = await worker.fetch(request("/missing"), env);

    expect(response.status).toBe(404);
    expect(await responseText(response)).toBe("Not Found");
  });
});

describe("calendar endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("requires a source URL", async () => {
    const response = await worker.fetch(request("/calendar"), env);

    expect(response.status).toBe(400);
    expect(await responseText(response)).toContain("Missing required parameter: url");
  });

  it("validates timezone, mode, and offset query parameters", async () => {
    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");

    const badTz = await worker.fetch(request(`/calendar?url=${source}&tz=Fake/Timezone`), env);
    const badMode = await worker.fetch(request(`/calendar?url=${source}&mode=invalid`), env);
    const badOffset = await worker.fetch(request(`/calendar?url=${source}&mode=shift&offset=60abc`), env);

    expect(badTz.status).toBe(400);
    expect(await responseText(badTz)).toContain("Unknown timezone");
    expect(badMode.status).toBe(400);
    expect(await responseText(badMode)).toContain("Unknown mode");
    expect(badOffset.status).toBe(400);
    expect(await responseText(badOffset)).toContain("Invalid UTC offset");
  });

  it("fetches, transforms, and returns an ICS feed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(SAMPLE_ICS, {
        status: 200,
        headers: { "Content-Type": "text/calendar" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const response = await worker.fetch(
      request(`/calendar?url=${source}&tz=Europe/Berlin&mode=force`),
      env
    );
    const body = await responseText(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/calendar");
    expect(response.headers.get("Content-Disposition")).toContain("calendar.ics");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("DTSTART;TZID=Europe/Berlin:20240115T120000");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://outlook.example.com/calendar.ics",
      expect.objectContaining({ redirect: "manual" })
    );
  });

  it("supports passthrough mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(SAMPLE_ICS, { status: 200 }))
    );

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}&mode=passthrough`), env);
    const body = await responseText(response);

    expect(response.status).toBe(200);
    expect(body).toContain("DTSTART:20240115T110000Z");
  });

  it("returns upstream failures as 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 503, statusText: "Unavailable" }))
    );

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}`), env);

    expect(response.status).toBe(502);
    expect(await responseText(response)).toContain(
      "The calendar URL returned an error (503 Unavailable)"
    );
  });

  it("explains Cloudflare upstream connection failures as likely URL problems", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 522, statusText: "<none>" }))
    );

    const source = encodeURIComponent("https://wrong.example.com/calendar.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}`), env);
    const body = await responseText(response);

    expect(response.status).toBe(502);
    expect(body).toContain("The calendar URL could not be reached (522)");
    expect(body).toContain("Please check that the pasted link is correct");
    expect(body).not.toContain("<none>");
  });

  it("explains private calendar URLs as access problems", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("private", { status: 403, statusText: "Forbidden" }))
    );

    const source = encodeURIComponent("https://outlook.example.com/private.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}`), env);
    const body = await responseText(response);

    expect(response.status).toBe(502);
    expect(body).toContain("not publicly accessible");
    expect(body).toContain("public subscription link");
  });

  it("rejects non-calendar upstream bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not an ics", { status: 200 })));

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}`), env);

    expect(response.status).toBe(422);
    expect(await responseText(response)).toContain("valid iCalendar");
  });

  it("rejects oversized upstream calendars by content length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(SAMPLE_ICS, {
          status: 200,
          headers: { "Content-Length": "2000001" },
        })
      )
    );

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}`), env);

    expect(response.status).toBe(413);
    expect(await responseText(response)).toContain("too large");
  });

  it("rejects oversized upstream calendars after reading the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(`BEGIN:VCALENDAR\r\n${"X".repeat(2_000_000)}\r\nEND:VCALENDAR`, {
          status: 200,
        })
      )
    );

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}`), env);

    expect(response.status).toBe(413);
    expect(await responseText(response)).toContain("too large");
  });

  it("follows and revalidates redirects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { Location: "https://outlook.example.com/final.ics" },
        })
      )
      .mockResolvedValueOnce(new Response(SAMPLE_ICS, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}`), env);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://outlook.example.com/final.ics",
      expect.objectContaining({ redirect: "manual" })
    );
  });

  it("blocks redirects to private targets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("", {
          status: 302,
          headers: { Location: "http://localhost/calendar.ics" },
        })
      )
    );

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}`), env);

    expect(response.status).toBe(400);
    expect(await responseText(response)).toContain("Blocked hostname");
  });

  it("handles invalid redirect locations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("", {
          status: 302,
          headers: { Location: "http://[::1" },
        })
      )
    );

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}`), env);

    expect(response.status).toBe(502);
    expect(await responseText(response)).toContain("invalid redirect URL");
  });

  it("returns a clear error for redirects without a Location header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 302, statusText: "Found" }))
    );

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}`), env);

    expect(response.status).toBe(502);
    expect(await responseText(response)).toContain(
      "The calendar URL returned an error (302 Found)"
    );
  });

  it("rejects redirect chains that exceed the limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { Location: "https://outlook.example.com/next.ics" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}`), env);

    expect(response.status).toBe(502);
    expect(await responseText(response)).toContain("Too many redirects");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("handles upstream body read failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        text: vi.fn().mockRejectedValue(new Error("cannot read body")),
      } as unknown as Response)
    );

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}`), env);

    expect(response.status).toBe(502);
    expect(await responseText(response)).toContain("cannot read body");
  });

  it("handles upstream fetch exceptions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const response = await worker.fetch(request(`/calendar?url=${source}`), env);

    expect(response.status).toBe(502);
    expect(await responseText(response)).toContain("network down");
  });

  it("returns a timeout error when the upstream request is aborted", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      })
    );

    const source = encodeURIComponent("https://outlook.example.com/calendar.ics");
    const pending = worker.fetch(request(`/calendar?url=${source}`), env);

    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;

    expect(response.status).toBe(504);
    expect(await responseText(response)).toContain("timed out");
  });
});
