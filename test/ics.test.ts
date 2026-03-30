/**
 * ics.test.ts
 *
 * Unit tests for the ICS transformation logic.
 *
 * Test cases are documented with "before" and "after" examples so they serve
 * as living documentation of the normalization strategy.
 */

import { describe, it, expect } from "vitest";
import {
  unfoldLines,
  foldLine,
  parsePropLine,
  serializeProp,
  isUtcTimestamp,
  isFloatingTimestamp,
  isDateOnly,
  convertUtcToLocal,
  shiftUtcByOffset,
  transformIcs,
} from "../src/ics.js";

// ─── unfoldLines ──────────────────────────────────────────────────────────────

describe("unfoldLines", () => {
  it("handles plain lines without folding", () => {
    const input = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR";
    expect(unfoldLines(input)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "END:VCALENDAR",
    ]);
  });

  it("unfolds RFC 5545 folded lines (CRLF + space)", () => {
    const input = "DESCRIPTION:This is a very long descri\r\n ption that is folded";
    expect(unfoldLines(input)).toEqual([
      "DESCRIPTION:This is a very long description that is folded",
    ]);
  });

  it("unfolds lines folded with a tab", () => {
    const input = "SUMMARY:Meeting\r\n\t with team";
    expect(unfoldLines(input)).toEqual(["SUMMARY:Meeting with team"]);
  });

  it("handles LF-only line endings", () => {
    const input = "BEGIN:VCALENDAR\nVERSION:2.0\n";
    expect(unfoldLines(input)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0"]);
  });

  it("filters out empty lines produced by normalisation", () => {
    expect(unfoldLines("\r\n\r\nBEGIN:VCALENDAR\r\n")).toEqual([
      "BEGIN:VCALENDAR",
    ]);
  });
});

// ─── foldLine ─────────────────────────────────────────────────────────────────

describe("foldLine", () => {
  it("returns short lines unchanged", () => {
    const line = "DTSTART:20240315T120000Z";
    expect(foldLine(line)).toBe(line);
  });

  it("folds lines longer than 75 characters", () => {
    const line = "X-SOME-PROPERTY:ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz";
    const folded = foldLine(line);
    const physicalLines = folded.split("\r\n");
    expect(physicalLines[0]!.length).toBeLessThanOrEqual(75);
    physicalLines.slice(1).forEach((l) => {
      expect(l.startsWith(" ")).toBe(true);
      expect(l.length).toBeLessThanOrEqual(75);
    });
    // Reassembling should give back the original
    const reassembled = physicalLines
      .join("")
      .replace(/^ /gm, "")
      .replace(/\n /g, "");
    // The original is recoverable after unfolding
    const unfolded = unfoldLines(folded);
    expect(unfolded).toEqual([line]);
  });
});

// ─── parsePropLine ────────────────────────────────────────────────────────────

describe("parsePropLine", () => {
  it("parses a simple property", () => {
    const result = parsePropLine("VERSION:2.0");
    expect(result).toEqual({ name: "VERSION", params: {}, value: "2.0" });
  });

  it("parses a property with a single parameter", () => {
    const result = parsePropLine("DTSTART;TZID=Europe/Berlin:20240315T120000");
    expect(result).toEqual({
      name: "DTSTART",
      params: { TZID: "Europe/Berlin" },
      value: "20240315T120000",
    });
  });

  it("parses a property with VALUE=DATE parameter", () => {
    const result = parsePropLine("DTSTART;VALUE=DATE:20240315");
    expect(result).toEqual({
      name: "DTSTART",
      params: { VALUE: "DATE" },
      value: "20240315",
    });
  });

  it("returns null for a line without a colon", () => {
    expect(parsePropLine("BEGIN")).toBeNull();
  });

  it("preserves the value after the first colon even if it contains colons", () => {
    const result = parsePropLine("URL:https://example.com/calendar?foo=bar");
    expect(result).not.toBeNull();
    expect(result!.value).toBe("https://example.com/calendar?foo=bar");
  });

  it("upper-cases the property name", () => {
    const result = parsePropLine("dtstart:20240315T120000Z");
    expect(result!.name).toBe("DTSTART");
  });
});

// ─── serializeProp ────────────────────────────────────────────────────────────

describe("serializeProp", () => {
  it("serializes a prop with no parameters", () => {
    expect(serializeProp({ name: "VERSION", params: {}, value: "2.0" })).toBe(
      "VERSION:2.0"
    );
  });

  it("serializes a prop with a TZID parameter", () => {
    expect(
      serializeProp({
        name: "DTSTART",
        params: { TZID: "Europe/Berlin" },
        value: "20240315T120000",
      })
    ).toBe("DTSTART;TZID=Europe/Berlin:20240315T120000");
  });
});

// ─── Timestamp classification helpers ────────────────────────────────────────

describe("isUtcTimestamp", () => {
  it("returns true for a valid UTC timestamp", () => {
    expect(isUtcTimestamp("20240315T110000Z")).toBe(true);
  });
  it("returns false for a floating timestamp", () => {
    expect(isUtcTimestamp("20240315T110000")).toBe(false);
  });
  it("returns false for a date-only value", () => {
    expect(isUtcTimestamp("20240315")).toBe(false);
  });
});

describe("isFloatingTimestamp", () => {
  it("returns true for a floating timestamp", () => {
    expect(isFloatingTimestamp("20240315T110000")).toBe(true);
  });
  it("returns false for a UTC timestamp", () => {
    expect(isFloatingTimestamp("20240315T110000Z")).toBe(false);
  });
  it("returns false for a date-only value", () => {
    expect(isFloatingTimestamp("20240315")).toBe(false);
  });
});

describe("isDateOnly", () => {
  it("returns true for a date-only value", () => {
    expect(isDateOnly("20240315")).toBe(true);
  });
  it("returns false for a datetime value", () => {
    expect(isDateOnly("20240315T120000")).toBe(false);
  });
});

// ─── convertUtcToLocal ────────────────────────────────────────────────────────

describe("convertUtcToLocal", () => {
  /**
   * Test Case 1: UTC → Europe/Berlin in winter (UTC+1)
   * Before: DTSTART:20240315T110000Z  (11:00 UTC)
   * After:  DTSTART;TZID=Europe/Berlin:20240315T120000  (12:00 CET = UTC+1)
   *
   * 2024-03-15 is before DST (last Sunday of March 2024 = March 31).
   */
  it("converts a UTC winter timestamp to Europe/Berlin (UTC+1)", () => {
    const result = convertUtcToLocal("20240115T110000Z", "Europe/Berlin");
    // January → CET (UTC+1) → 12:00
    expect(result).toBe("20240115T120000");
  });

  /**
   * Test Case 2: UTC → Europe/Berlin in summer (UTC+2)
   * Before: DTSTART:20240615T100000Z  (10:00 UTC)
   * After:  DTSTART;TZID=Europe/Berlin:20240615T120000  (12:00 CEST = UTC+2)
   */
  it("converts a UTC summer timestamp to Europe/Berlin (UTC+2, CEST)", () => {
    const result = convertUtcToLocal("20240615T100000Z", "Europe/Berlin");
    // June → CEST (UTC+2) → 12:00
    expect(result).toBe("20240615T120000");
  });

  it("handles midnight correctly", () => {
    // 23:00 UTC → 00:00 next day in CET (UTC+1)
    const result = convertUtcToLocal("20240115T230000Z", "Europe/Berlin");
    expect(result).toBe("20240116T000000");
  });

  it("converts UTC to UTC (no change)", () => {
    const result = convertUtcToLocal("20240315T120000Z", "UTC");
    expect(result).toBe("20240315T120000");
  });
});

// ─── shiftUtcByOffset ────────────────────────────────────────────────────────

describe("shiftUtcByOffset", () => {
  /**
   * Test Case 3: Shift mode UTC+1 (60 minutes)
   * Before: DTSTART:20240315T110000Z
   * After:  DTSTART:20240315T120000
   */
  it("shifts a UTC timestamp by +60 minutes", () => {
    expect(shiftUtcByOffset("20240315T110000Z", 60)).toBe("20240315T120000");
  });

  it("shifts a UTC timestamp by -300 minutes (UTC-5)", () => {
    expect(shiftUtcByOffset("20240315T170000Z", -300)).toBe("20240315T120000");
  });

  it("handles day overflow correctly", () => {
    expect(shiftUtcByOffset("20240315T230000Z", 120)).toBe("20240316T010000");
  });

  it("handles day underflow correctly", () => {
    expect(shiftUtcByOffset("20240315T010000Z", -120)).toBe("20240314T230000");
  });

  it("returns a floating timestamp (no Z)", () => {
    const result = shiftUtcByOffset("20240315T110000Z", 60);
    expect(result.endsWith("Z")).toBe(false);
  });
});

// ─── transformIcs ─────────────────────────────────────────────────────────────

/**
 * Minimal ICS feed used as test fixture.
 */
const SAMPLE_ICS_UTC = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN",
  "BEGIN:VEVENT",
  "DTSTART:20240315T110000Z",
  "DTEND:20240315T120000Z",
  "SUMMARY:Team meeting",
  "UID:abc123@outlook.com",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const SAMPLE_ICS_FLOATING = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN",
  "BEGIN:VEVENT",
  "DTSTART:20240315T120000",
  "DTEND:20240315T130000",
  "SUMMARY:Floating event",
  "UID:float456@outlook.com",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const SAMPLE_ICS_ALLDAY = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20240315",
  "DTEND;VALUE=DATE:20240316",
  "SUMMARY:All-day event",
  "UID:allday789@outlook.com",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const SAMPLE_ICS_TZID = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN",
  "BEGIN:VEVENT",
  "DTSTART;TZID=America/New_York:20240315T120000",
  "DTEND;TZID=America/New_York:20240315T130000",
  "SUMMARY:Already has TZID",
  "UID:tzid001@outlook.com",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("transformIcs — passthrough mode", () => {
  it("returns the ICS with CRLF line endings unchanged", () => {
    const result = transformIcs(SAMPLE_ICS_UTC, {
      tzid: "Europe/Berlin",
      offsetMinutes: null,
      mode: "passthrough",
    });
    expect(result).toContain("DTSTART:20240315T110000Z");
    expect(result).toContain("DTEND:20240315T120000Z");
  });
});

describe("transformIcs — force mode", () => {
  /**
   * Test Case 1 (full ICS): UTC timestamps are converted to TZID-annotated
   * local times.  The VTIMEZONE block for Europe/Berlin is injected.
   *
   * Before:
   *   DTSTART:20240315T110000Z      (11:00 UTC = 12:00 CET)
   *   DTEND:20240315T120000Z        (12:00 UTC = 13:00 CET)
   *
   * After:
   *   DTSTART;TZID=Europe/Berlin:20240315T120000
   *   DTEND;TZID=Europe/Berlin:20240315T130000
   */
  it("converts UTC timestamps to TZID-annotated local times (winter)", () => {
    const result = transformIcs(SAMPLE_ICS_UTC, {
      tzid: "Europe/Berlin",
      offsetMinutes: null,
      mode: "force",
    });
    // The Z should be gone
    expect(result).not.toContain("T110000Z");
    expect(result).not.toContain("T120000Z");
    // TZID annotation should be present
    expect(result).toContain("DTSTART;TZID=Europe/Berlin:");
    expect(result).toContain("DTEND;TZID=Europe/Berlin:");
    // VTIMEZONE block should be injected
    expect(result).toContain("BEGIN:VTIMEZONE");
    expect(result).toContain("TZID:Europe/Berlin");
  });

  /**
   * Test Case 2 (full ICS): Floating timestamps get TZID annotation but the
   * time value is preserved unchanged.
   *
   * Before:  DTSTART:20240315T120000
   * After:   DTSTART;TZID=Europe/Berlin:20240315T120000
   */
  it("annotates floating timestamps with TZID without changing the time value", () => {
    const result = transformIcs(SAMPLE_ICS_FLOATING, {
      tzid: "Europe/Berlin",
      offsetMinutes: null,
      mode: "force",
    });
    expect(result).toContain("DTSTART;TZID=Europe/Berlin:20240315T120000");
    expect(result).toContain("DTEND;TZID=Europe/Berlin:20240315T130000");
  });

  /**
   * Test Case 3: All-day events (VALUE=DATE) must NOT be modified.
   *
   * Before:  DTSTART;VALUE=DATE:20240315
   * After:   DTSTART;VALUE=DATE:20240315  (unchanged)
   */
  it("leaves all-day (DATE) events completely unchanged", () => {
    const result = transformIcs(SAMPLE_ICS_ALLDAY, {
      tzid: "Europe/Berlin",
      offsetMinutes: null,
      mode: "force",
    });
    expect(result).toContain("DTSTART;VALUE=DATE:20240315");
    expect(result).toContain("DTEND;VALUE=DATE:20240316");
    // All-day events should NOT have a spurious TZID added
    expect(result).not.toMatch(/DTSTART;.*TZID.*:20240315$/m);
  });

  it("does not modify events that already have a TZID", () => {
    const result = transformIcs(SAMPLE_ICS_TZID, {
      tzid: "Europe/Berlin",
      offsetMinutes: null,
      mode: "force",
    });
    // Original TZID should be preserved
    expect(result).toContain("DTSTART;TZID=America/New_York:20240315T120000");
    expect(result).toContain("DTEND;TZID=America/New_York:20240315T130000");
  });

  it("outputs CRLF line endings", () => {
    const result = transformIcs(SAMPLE_ICS_UTC, {
      tzid: "Europe/Berlin",
      offsetMinutes: null,
      mode: "force",
    });
    expect(result).toContain("\r\n");
  });

  it("preserves the VCALENDAR structure (BEGIN/END wrappers)", () => {
    const result = transformIcs(SAMPLE_ICS_UTC, {
      tzid: "Europe/Berlin",
      offsetMinutes: null,
      mode: "force",
    });
    expect(result).toContain("BEGIN:VCALENDAR");
    expect(result).toContain("END:VCALENDAR");
    expect(result).toContain("BEGIN:VEVENT");
    expect(result).toContain("END:VEVENT");
  });

  it("injects the VTIMEZONE block before the first VEVENT", () => {
    const result = transformIcs(SAMPLE_ICS_UTC, {
      tzid: "Europe/Berlin",
      offsetMinutes: null,
      mode: "force",
    });
    const vtStart = result.indexOf("BEGIN:VTIMEZONE");
    const veventStart = result.indexOf("BEGIN:VEVENT");
    expect(vtStart).toBeGreaterThan(-1);
    expect(vtStart).toBeLessThan(veventStart);
  });

  it("does not inject duplicate VTIMEZONE blocks when already present", () => {
    // Add a VTIMEZONE for Europe/Berlin before transforming
    const withVtz = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//EN",
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Berlin",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0100",
      "TZNAME:CET",
      "DTSTART:19701025T030000",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "DTSTART:20240115T110000Z",
      "DTEND:20240115T120000Z",
      "SUMMARY:Test",
      "UID:dup-test@test",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const result = transformIcs(withVtz, {
      tzid: "Europe/Berlin",
      offsetMinutes: null,
      mode: "force",
    });
    // Exactly one VTIMEZONE block
    const count = (result.match(/BEGIN:VTIMEZONE/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe("transformIcs — shift mode", () => {
  /**
   * Test Case (shift): UTC +60 minutes.
   *
   * Before:  DTSTART:20240315T110000Z
   * After:   DTSTART:20240315T120000   (floating, shifted by +60 min)
   */
  it("shifts UTC timestamps by the given offset", () => {
    const result = transformIcs(SAMPLE_ICS_UTC, {
      tzid: "Europe/Berlin",
      offsetMinutes: 60,
      mode: "shift",
    });
    expect(result).toContain("DTSTART:20240315T120000");
    expect(result).toContain("DTEND:20240315T130000");
    // Z suffix should be gone
    expect(result).not.toContain("T110000Z");
    expect(result).not.toContain("T120000Z");
  });

  it("does not modify floating timestamps in shift mode", () => {
    const result = transformIcs(SAMPLE_ICS_FLOATING, {
      tzid: "Europe/Berlin",
      offsetMinutes: 60,
      mode: "shift",
    });
    expect(result).toContain("DTSTART:20240315T120000");
  });

  it("does not inject a VTIMEZONE block in shift mode", () => {
    const result = transformIcs(SAMPLE_ICS_UTC, {
      tzid: "Europe/Berlin",
      offsetMinutes: 60,
      mode: "shift",
    });
    expect(result).not.toContain("BEGIN:VTIMEZONE");
  });
});

// ─── EXDATE multi-value transformation ───────────────────────────────────────

describe("transformIcs — EXDATE with multiple UTC values", () => {
  const ICS_WITH_EXDATE = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    "BEGIN:VEVENT",
    "DTSTART:20240115T110000Z",
    "DTEND:20240115T120000Z",
    "RRULE:FREQ=WEEKLY",
    "EXDATE:20240122T110000Z,20240129T110000Z",
    "SUMMARY:Recurring with exceptions",
    "UID:recur@test",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("transforms each comma-separated EXDATE value in force mode", () => {
    const result = transformIcs(ICS_WITH_EXDATE, {
      tzid: "Europe/Berlin",
      offsetMinutes: null,
      mode: "force",
    });
    // Both EXDATE values should be converted (11:00Z → 12:00 in CET/UTC+1)
    expect(result).toContain("EXDATE;TZID=Europe/Berlin:");
    expect(result).toContain("20240122T120000");
    expect(result).toContain("20240129T120000");
  });
});

// ─── validate.ts ─────────────────────────────────────────────────────────────

import {
  validateSourceUrl,
  validateTimezone,
  validateOffsetMinutes,
  validateMode,
} from "../src/validate.js";

describe("validateSourceUrl", () => {
  it("accepts a valid https URL", () => {
    expect(() =>
      validateSourceUrl(
        "https://outlook.office365.com/owa/calendar/abc/reachcalendar.ics"
      )
    ).not.toThrow();
  });

  it("rejects an invalid URL", () => {
    expect(() => validateSourceUrl("not-a-url")).toThrow();
  });

  it("rejects a file:// URL", () => {
    expect(() => validateSourceUrl("file:///etc/passwd")).toThrow();
  });

  it("rejects localhost", () => {
    expect(() => validateSourceUrl("http://localhost/calendar.ics")).toThrow();
  });

  it("rejects private IPv4 range 192.168.x.x", () => {
    expect(() =>
      validateSourceUrl("http://192.168.1.100/calendar.ics")
    ).toThrow();
  });

  it("rejects private IPv4 range 10.x.x.x", () => {
    expect(() =>
      validateSourceUrl("http://10.0.0.1/calendar.ics")
    ).toThrow();
  });

  it("rejects loopback 127.0.0.1", () => {
    expect(() =>
      validateSourceUrl("http://127.0.0.1/calendar.ics")
    ).toThrow();
  });

  it("rejects IPv6 loopback", () => {
    expect(() =>
      validateSourceUrl("http://[::1]/calendar.ics")
    ).toThrow();
  });
});

describe("validateTimezone", () => {
  it("accepts a valid IANA timezone", () => {
    expect(validateTimezone("Europe/Berlin")).toBe("Europe/Berlin");
  });

  it("accepts UTC", () => {
    expect(validateTimezone("UTC")).toBe("UTC");
  });

  it("rejects an unknown timezone", () => {
    expect(() => validateTimezone("Fake/Timezone")).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => validateTimezone("")).toThrow();
  });
});

describe("validateOffsetMinutes", () => {
  it("returns null for null input", () => {
    expect(validateOffsetMinutes(null)).toBeNull();
  });

  it("returns 60 for '60'", () => {
    expect(validateOffsetMinutes("60")).toBe(60);
  });

  it("returns -300 for '-300'", () => {
    expect(validateOffsetMinutes("-300")).toBe(-300);
  });

  it("throws for out-of-range offset", () => {
    expect(() => validateOffsetMinutes("900")).toThrow();
  });
});

describe("validateMode", () => {
  it("defaults to 'force' for null input", () => {
    expect(validateMode(null)).toBe("force");
  });

  it("accepts 'passthrough'", () => {
    expect(validateMode("passthrough")).toBe("passthrough");
  });

  it("accepts 'shift'", () => {
    expect(validateMode("shift")).toBe("shift");
  });

  it("throws for unknown mode", () => {
    expect(() => validateMode("invalid")).toThrow();
  });
});

// ─── vtimezone.ts ─────────────────────────────────────────────────────────────

import { generateVTimezone, formatOffsetMinutes } from "../src/vtimezone.js";

describe("formatOffsetMinutes", () => {
  it("formats +60 as +0100", () => {
    expect(formatOffsetMinutes(60)).toBe("+0100");
  });
  it("formats -300 as -0500", () => {
    expect(formatOffsetMinutes(-300)).toBe("-0500");
  });
  it("formats 0 as +0000", () => {
    expect(formatOffsetMinutes(0)).toBe("+0000");
  });
  it("formats +120 as +0200", () => {
    expect(formatOffsetMinutes(120)).toBe("+0200");
  });
});

describe("generateVTimezone", () => {
  it("generates a VTIMEZONE block for Europe/Berlin with DST rules", () => {
    const vtz = generateVTimezone("Europe/Berlin");
    expect(vtz).toContain("BEGIN:VTIMEZONE");
    expect(vtz).toContain("TZID:Europe/Berlin");
    expect(vtz).toContain("BEGIN:DAYLIGHT");
    expect(vtz).toContain("BEGIN:STANDARD");
    expect(vtz).toContain("END:VTIMEZONE");
    // Should reference CET and CEST
    expect(vtz).toContain("TZNAME:CET");
    expect(vtz).toContain("TZNAME:CEST");
  });

  it("generates a VTIMEZONE block for UTC (no DST)", () => {
    const vtz = generateVTimezone("UTC");
    expect(vtz).toContain("BEGIN:VTIMEZONE");
    expect(vtz).toContain("TZID:UTC");
    expect(vtz).toContain("END:VTIMEZONE");
    expect(vtz).not.toContain("BEGIN:DAYLIGHT");
  });
});
