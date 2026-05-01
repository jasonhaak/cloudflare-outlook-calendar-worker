/**
 * ics.ts
 *
 * ICS (iCalendar, RFC 5545) parsing and timezone-normalization logic.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Background: The three timestamp types in RFC 5545
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. UTC (absolute) timestamps  — end with the letter "Z"
 *      DTSTART:20240315T110000Z
 *    These represent a precise instant in time. Calendar clients display them
 *    in the user's local timezone.  Outlook sometimes emits these even when the
 *    event was created in a non-UTC timezone.  Google Calendar respects the Z,
 *    so an 11:00Z event appears as 12:00 in UTC+1 / Europe/Berlin — correct.
 *    The problem arises when Outlook emits 12:00Z for an event that was really
 *    scheduled at 12:00 local time (UTC+1); Google then shows it at 13:00.
 *
 * 2. Floating (local) timestamps  — no Z, no TZID
 *      DTSTART:20240315T120000
 *    These have no timezone annotation; they are interpreted as "the local time
 *    wherever the client is".  Google Calendar treats these as UTC, which
 *    causes the same kind of 1-2 hour shift for European users.
 *
 * 3. TZID-based timestamps  — TZID parameter + no Z
 *      DTSTART;TZID=Europe/Berlin:20240315T120000
 *    The most correct form.  The time value is wall-clock time in the named
 *    timezone.  Both Outlook and Google Calendar handle these correctly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Transformation modes
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * passthrough — Return the ICS unchanged.  Useful for debugging.
 *
 * force       — (recommended)
 *   • UTC timestamps (Z):      convert wall-clock time to the target IANA tzid
 *                              using the Intl API (DST-aware), then emit as
 *                              TZID-annotated timestamps.
 *   • Floating timestamps:     annotate with the target TZID without changing
 *                              the time value (we trust that the event creator
 *                              intended the given wall-clock time in that tz).
 *   • TZID timestamps:         left untouched (already correctly annotated).
 *   • A VTIMEZONE block for the target tzid is inserted into the calendar.
 *
 * shift       — Simple fixed-offset approach (no DST awareness).
 *   • UTC timestamps (Z):      add the manual offsetMinutes, strip the Z, emit
 *                              as floating time.
 *   • Floating timestamps:     left untouched.
 *   • TZID timestamps:         left untouched.
 *   Useful when the Intl API is unavailable or when the user knows the exact
 *   fixed offset to apply.  Does not insert a VTIMEZONE block.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generateVTimezone } from "./vtimezone.js";
import type { TransformMode } from "./validate.js";

export interface TransformOptions {
  /** IANA timezone ID, e.g. "Europe/Berlin" */
  tzid: string;
  /** Manual UTC offset in minutes (used by the "shift" mode). */
  offsetMinutes: number | null;
  /** Transformation mode. */
  mode: TransformMode;
}

// ─── Line folding / unfolding ─────────────────────────────────────────────────

/**
 * Unfold RFC 5545 folded content lines.
 *
 * Long lines (>75 octets) may be split across multiple physical lines by
 * inserting a CRLF followed by a single whitespace character (space or tab).
 * This function joins those split lines back into logical lines.
 *
 * We also normalise CRLF / CR / LF to a single LF for easier processing and
 * re-introduce CRLF at output time.
 */
export function unfoldLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n") // CRLF → LF
    .replace(/\r/g, "\n")   // lone CR → LF
    .replace(/\n[ \t]/g, "") // unfold: remove CRLF + leading whitespace
    .split("\n")
    .filter((l) => l.length > 0);
}

/**
 * Fold a logical line per RFC 5545: lines longer than 75 octets are split
 * with CRLF + SPACE, with continuation lines starting with a space.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const chunks: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  let limit = 75;

  for (const char of Array.from(line)) {
    const charBytes = encoder.encode(char).length;
    if (chunk !== "" && chunkBytes + charBytes > limit) {
      chunks.push(chunks.length === 0 ? chunk : ` ${chunk}`);
      chunk = char;
      chunkBytes = charBytes;
      limit = 74;
    } else {
      chunk += char;
      chunkBytes += charBytes;
    }
  }

  if (chunk !== "") {
    chunks.push(chunks.length === 0 ? chunk : ` ${chunk}`);
  }

  return chunks.join("\r\n");
}

// ─── Property parsing / serialisation ────────────────────────────────────────

export interface ParsedProp {
  /** Upper-cased property name, e.g. "DTSTART" */
  name: string;
  /** Key → value map of parameters (keys upper-cased). */
  params: Record<string, string>;
  /** Raw property value after the first colon. */
  value: string;
}

function indexOfUnquoted(input: string, needle: string): number {
  let insideQuote = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      insideQuote = !insideQuote;
    } else if (char === needle && !insideQuote) {
      return i;
    }
  }

  return -1;
}

function splitUnquoted(input: string, delimiter: string): string[] {
  const result: string[] = [];
  let insideQuote = false;
  let segmentStart = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      insideQuote = !insideQuote;
    } else if (char === delimiter && !insideQuote) {
      result.push(input.slice(segmentStart, i));
      segmentStart = i + 1;
    }
  }

  result.push(input.slice(segmentStart));
  return result;
}

/**
 * Parse an unfolded ICS property line into its constituent parts.
 *
 * Format:  PROPNAME[;PARAM=VALUE]...:propvalue
 * Example: DTSTART;TZID=Europe/Berlin:20240315T120000
 *          → { name: "DTSTART", params: { TZID: "Europe/Berlin" }, value: "20240315T120000" }
 */
export function parsePropLine(line: string): ParsedProp | null {
  const colonIdx = indexOfUnquoted(line, ":");
  if (colonIdx === -1) return null;

  const nameAndParams = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);

  const segments = splitUnquoted(nameAndParams, ";");
  const name = (segments[0] ?? "").toUpperCase();
  const params: Record<string, string> = {};

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i] ?? "";
    const eqIdx = indexOfUnquoted(seg, "=");
    if (eqIdx !== -1) {
      params[seg.slice(0, eqIdx).toUpperCase()] = seg.slice(eqIdx + 1);
    }
  }

  return { name, params, value };
}

/**
 * Serialize a ParsedProp back to a canonical ICS property line.
 */
export function serializeProp(prop: ParsedProp): string {
  const paramParts = Object.entries(prop.params).map(([k, v]) => `${k}=${v}`);
  const prefix = paramParts.length > 0
    ? `${prop.name};${paramParts.join(";")}`
    : prop.name;
  return `${prefix}:${prop.value}`;
}

// ─── Timestamp classification helpers ────────────────────────────────────────

/** Match a UTC ICS date-time value: 8 digits + T + 6 digits + Z */
const RE_UTC = /^\d{8}T\d{6}Z$/;

/** Match a floating ICS date-time value: 8 digits + T + 6 digits (no Z) */
const RE_FLOAT = /^\d{8}T\d{6}$/;

/** Match an ICS DATE value (all-day): exactly 8 digits */
const RE_DATE_ONLY = /^\d{8}$/;

/** Returns true when the single timestamp value is UTC (ends with Z). */
export function isUtcTimestamp(v: string): boolean {
  return RE_UTC.test(v);
}

/** Returns true when the single timestamp value is floating (no Z, no TZID). */
export function isFloatingTimestamp(v: string): boolean {
  return RE_FLOAT.test(v);
}

/** Returns true when the value is a DATE-only (all-day) value. */
export function isDateOnly(v: string): boolean {
  return RE_DATE_ONLY.test(v);
}

// ─── Timestamp conversion ─────────────────────────────────────────────────────

/**
 * Convert a UTC ICS timestamp string to wall-clock time in the given IANA
 * timezone using the Intl API (DST-aware).
 *
 * Input:  "20240315T110000Z"  tzid = "Europe/Berlin" (UTC+1 in winter)
 * Output: "20240315T120000"
 *
 * Note: the Intl API is available in both Cloudflare Workers (V8) and Node.js.
 * It correctly handles DST transitions because it uses the IANA timezone data
 * bundled with the V8 engine.
 */
export function convertUtcToLocal(utcTimestamp: string, tzid: string): string {
  // Strip the trailing Z and parse the UTC components
  const ts = utcTimestamp.endsWith("Z")
    ? utcTimestamp.slice(0, -1)
    : utcTimestamp;

  const year = ts.slice(0, 4);
  const month = ts.slice(4, 6);
  const day = ts.slice(6, 8);
  const hour = ts.slice(9, 11);
  const min = ts.slice(11, 13);
  const sec = ts.slice(13, 15);

  const date = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);

  // Format the Date in the target timezone.
  // sv-SE locale uses "YYYY-MM-DD HH:MM:SS" format which is easy to parse.
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tzid,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const formatted = formatter.format(date);
  // sv-SE format: "2024-03-15 12:00:00"
  const [datePart, timePart] = formatted.split(" ");
  if (!datePart || !timePart) {
    throw new Error(`Unexpected Intl.DateTimeFormat output: "${formatted}"`);
  }
  const [y, mo, d] = datePart.split("-");
  const [h, mi, s] = timePart.split(":");
  return `${y}${mo}${d}T${h}${mi}${s}`;
}

/**
 * Shift a UTC timestamp by a fixed number of minutes and return a floating
 * (timezone-unspecified) ICS timestamp.
 *
 * This is the "shift" mode conversion: no DST awareness, simple arithmetic.
 *
 * Input:  "20240315T110000Z"  offsetMinutes = 60
 * Output: "20240315T120000"
 */
export function shiftUtcByOffset(
  utcTimestamp: string,
  offsetMinutes: number
): string {
  const ts = utcTimestamp.endsWith("Z")
    ? utcTimestamp.slice(0, -1)
    : utcTimestamp;

  const year = parseInt(ts.slice(0, 4), 10);
  const month = parseInt(ts.slice(4, 6), 10) - 1;
  const day = parseInt(ts.slice(6, 8), 10);
  const hour = parseInt(ts.slice(9, 11), 10);
  const min = parseInt(ts.slice(11, 13), 10);
  const sec = parseInt(ts.slice(13, 15), 10);

  const ms =
    Date.UTC(year, month, day, hour, min, sec) + offsetMinutes * 60_000;
  const shifted = new Date(ms);

  const pad = (n: number) => n.toString().padStart(2, "0");
  const y = shifted.getUTCFullYear().toString().padStart(4, "0");
  const mo = pad(shifted.getUTCMonth() + 1);
  const d = pad(shifted.getUTCDate());
  const h = pad(shifted.getUTCHours());
  const mi = pad(shifted.getUTCMinutes());
  const s = pad(shifted.getUTCSeconds());

  return `${y}${mo}${d}T${h}${mi}${s}`;
}

// ─── Properties whose timestamps should be transformed ───────────────────────

/**
 * ICS properties that carry date-time values eligible for transformation.
 *
 * RRULE is intentionally excluded — it describes recurrence patterns, not
 * specific timestamps.  DURATION is excluded for the same reason.
 * X-* extended properties are excluded to avoid breaking vendor extensions.
 */
const DATETIME_PROPS = new Set([
  "DTSTART",
  "DTEND",
  "DUE",
  "RECURRENCE-ID",
  "EXDATE",
  "RDATE",
]);

// ─── Per-property transformation ─────────────────────────────────────────────

/**
 * Transform a single date-time property value according to the chosen mode.
 *
 * Some properties (EXDATE, RDATE) allow comma-separated multiple values —
 * we process each value individually.
 *
 * Returns the mutated ParsedProp, or the original if no change is needed.
 */
function transformDateProp(
  prop: ParsedProp,
  opts: TransformOptions
): ParsedProp {
  const { tzid, offsetMinutes, mode } = opts;

  // All-day events use VALUE=DATE; never touch them (RFC 5545: parameter values are case-insensitive)
  const valueParam = prop.params["VALUE"];
  if (typeof valueParam === "string" && valueParam.toUpperCase() === "DATE") return prop;

  // If the property already carries a TZID parameter, leave it alone
  // (the event already has explicit timezone info — we won't rebase it)
  if (prop.params["TZID"] !== undefined) return prop;

  // Handle comma-separated multi-values (EXDATE, RDATE)
  const rawValues = prop.value.split(",");
  const singleValue = rawValues[0] ?? "";

  // DATE-only value in the bare property (no VALUE=DATE param but still a date)
  if (isDateOnly(singleValue)) return prop;

  const newValues = rawValues.map((v) => {
    if (mode === "force") {
      if (isUtcTimestamp(v)) {
        return convertUtcToLocal(v, tzid);
      }
      if (isFloatingTimestamp(v)) {
        // Floating: we trust the wall-clock value, just annotate with TZID
        return v;
      }
    } else if (mode === "shift") {
      if (isUtcTimestamp(v)) {
        const offset =
          offsetMinutes !== null
            ? offsetMinutes
            : getDefaultOffset(tzid);
        return shiftUtcByOffset(v, offset);
      }
    }
    return v; // passthrough or unchanged
  });

  if (mode === "force" && (isUtcTimestamp(singleValue) || isFloatingTimestamp(singleValue))) {
    // Add TZID parameter; the Z is stripped inside convertUtcToLocal / value kept for floating
    return {
      ...prop,
      params: { ...prop.params, TZID: tzid },
      value: newValues.join(","),
    };
  }

  if (mode === "shift" && isUtcTimestamp(singleValue)) {
    // Remove the Z and keep as floating
    return { ...prop, value: newValues.join(",") };
  }

  return prop;
}

/**
 * Get the current UTC offset (in minutes) for a timezone as a fallback when
 * no manual offset is provided and mode is "shift".
 */
function getDefaultOffset(tzid: string): number {
  const now = new Date();
  // Format "now" in UTC and in the target TZ, compute difference
  const utcMs = now.getTime();
  const localStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tzid,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  const [datePart, timePart] = localStr.split(" ");
  if (!datePart || !timePart) return 0;
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi, s] = timePart.split(":").map(Number);
  if (y === undefined || mo === undefined || d === undefined ||
      h === undefined || mi === undefined || s === undefined) return 0;
  const localMs = Date.UTC(y, mo - 1, d, h % 24, mi, s);
  return Math.round((localMs - utcMs) / 60_000);
}

// ─── VTIMEZONE injection ──────────────────────────────────────────────────────

/**
 * Insert a VTIMEZONE block for `tzid` into `lines` immediately after the
 * VCALENDAR header lines (VERSION, PRODID) and before the first VEVENT/VTODO.
 *
 * If a VTIMEZONE block for the same tzid already exists in the lines array
 * we do not add a duplicate.
 */
function injectVTimezone(lines: string[], tzid: string): string[] {
  // Check if a matching VTIMEZONE already exists
  const existing = lines.some(
    (l) => l.startsWith("TZID:") && l.slice(5) === tzid
  );
  if (existing) return lines;

  const vtimezone = generateVTimezone(tzid);
  const vtLines = vtimezone.split("\r\n");

  // Find the insertion point: after VCALENDAR / VERSION / PRODID / CALSCALE /
  // METHOD but before the first VEVENT, VTODO, or VFREEBUSY block.
  const insertBefore = lines.findIndex(
    (l) =>
      l.startsWith("BEGIN:VEVENT") ||
      l.startsWith("BEGIN:VTODO") ||
      l.startsWith("BEGIN:VFREEBUSY") ||
      l.startsWith("BEGIN:VJOURNAL")
  );

  const idx = insertBefore === -1 ? lines.length : insertBefore;
  return [...lines.slice(0, idx), ...vtLines, ...lines.slice(idx)];
}

// ─── Main transform entry point ───────────────────────────────────────────────

/**
 * Transform a complete ICS text according to the given options.
 *
 * @param icsText  Raw ICS content (any line ending).
 * @param opts     Transformation options.
 * @returns        A normalised ICS string with CRLF line endings.
 */
export function transformIcs(icsText: string, opts: TransformOptions): string {
  if (opts.mode === "passthrough") {
    // Preserve as-is; just normalise line endings and ensure trailing CRLF
    const normalised = icsText
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const lines = normalised.endsWith("\n")
      ? normalised.slice(0, -1).split("\n")
      : normalised.split("\n");
    return lines.join("\r\n") + "\r\n";
  }

  const unfolded = unfoldLines(icsText);
  let lines = unfolded;

  // Transform each date-time property line
  lines = lines.map((line) => {
    const parsed = parsePropLine(line);
    if (!parsed) return line;
    if (!DATETIME_PROPS.has(parsed.name)) return line;

    const transformed = transformDateProp(parsed, opts);
    if (transformed === parsed) return line; // unchanged
    return serializeProp(transformed);
  });

  // Inject VTIMEZONE block for "force" mode
  if (opts.mode === "force") {
    lines = injectVTimezone(lines, opts.tzid);
  }

  // Re-fold lines and join with CRLF
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
