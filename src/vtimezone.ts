/**
 * vtimezone.ts
 *
 * Build VTIMEZONE blocks suitable for insertion into an ICS feed.
 *
 * A VTIMEZONE component tells calendar clients how to interpret TZID-annotated
 * timestamps.  Google Calendar and most modern clients also look up the TZID in
 * their own IANA database, so the VTIMEZONE block mainly serves older or offline
 * clients.  We nevertheless generate a correct RRULE-based block so the ICS is
 * self-contained.
 *
 * Strategy:
 *   1.  We probe January (standard) and July (likely daylight) to discover the
 *       UTC offsets for a given IANA tzid using the Intl API.
 *   2.  When the two offsets differ (i.e. DST exists) we use well-known
 *       hand-crafted transition rules for the most common European/Western
 *       timezones, falling back to a generic probe for others.
 *   3.  When there is no DST we emit a simplified STANDARD-only block.
 */

/** Format a signed UTC offset in minutes as ±HHMM (e.g. 60 → "+0100"). */
export function formatOffsetMinutes(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60).toString().padStart(2, "0");
  const m = (abs % 60).toString().padStart(2, "0");
  return `${sign}${h}${m}`;
}

/**
 * Return the UTC-offset in minutes for a given IANA timezone at a specific
 * moment.  Positive = east of UTC.
 *
 * We compute this by comparing the wall-clock time reported by Intl for the
 * target timezone against UTC.
 */
export function getOffsetMinutesAt(date: Date, tzid: string): number {
  // We format the date in the target timezone and also in UTC, then compute
  // the difference.  We use numeric fields to avoid locale-dependent strings.
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
    timeZone: tzid,
  };

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", opts).formatToParts(date).map((p) => [p.type, p.value])
  );

  // Build a UTC Date from the wall-clock components reported by Intl
  const localMs = Date.UTC(
    parseInt(parts["year"] ?? "0"),
    parseInt(parts["month"] ?? "1") - 1,
    parseInt(parts["day"] ?? "1"),
    // Intl hour12:false can return "24" for midnight; normalise to 0
    parseInt(parts["hour"] ?? "0") % 24,
    parseInt(parts["minute"] ?? "0"),
    parseInt(parts["second"] ?? "0")
  );

  return Math.round((localMs - date.getTime()) / 60000);
}

/**
 * Known DST configurations for common IANA timezones.
 * Each entry provides:
 *   stdOffset  — standard (winter) offset in minutes
 *   dstOffset  — daylight (summer) offset in minutes
 *   stdName    — abbreviation for standard time
 *   dstName    — abbreviation for daylight time
 *   dstStart   — RRULE part for DST-start transition (DTSTART is always 19700101T000000)
 *   dstEnd     — RRULE part for DST-end transition
 *   dstDtstart — local wall-clock time when DST starts (floating DTSTART inside DAYLIGHT block)
 *   stdDtstart — local wall-clock time when STD starts (floating DTSTART inside STANDARD block)
 */
interface TzConfig {
  stdOffset: number;
  dstOffset: number;
  stdName: string;
  dstName: string;
  dstRrule: string;
  stdRrule: string;
  dstDtstart: string;
  stdDtstart: string;
}

const KNOWN_TZ_CONFIGS: Record<string, TzConfig> = {
  // Central European Time / Central European Summer Time
  "Europe/Berlin": {
    stdOffset: 60, dstOffset: 120,
    stdName: "CET", dstName: "CEST",
    dstRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    dstDtstart: "19700329T020000",
    stdDtstart: "19701025T030000",
  },
  "Europe/Amsterdam": {
    stdOffset: 60, dstOffset: 120,
    stdName: "CET", dstName: "CEST",
    dstRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    dstDtstart: "19700329T020000",
    stdDtstart: "19701025T030000",
  },
  "Europe/Paris": {
    stdOffset: 60, dstOffset: 120,
    stdName: "CET", dstName: "CEST",
    dstRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    dstDtstart: "19700329T020000",
    stdDtstart: "19701025T030000",
  },
  "Europe/Rome": {
    stdOffset: 60, dstOffset: 120,
    stdName: "CET", dstName: "CEST",
    dstRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    dstDtstart: "19700329T020000",
    stdDtstart: "19701025T030000",
  },
  "Europe/Madrid": {
    stdOffset: 60, dstOffset: 120,
    stdName: "CET", dstName: "CEST",
    dstRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    dstDtstart: "19700329T020000",
    stdDtstart: "19701025T030000",
  },
  "Europe/Vienna": {
    stdOffset: 60, dstOffset: 120,
    stdName: "CET", dstName: "CEST",
    dstRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    dstDtstart: "19700329T020000",
    stdDtstart: "19701025T030000",
  },
  // Eastern European Time
  "Europe/Helsinki": {
    stdOffset: 120, dstOffset: 180,
    stdName: "EET", dstName: "EEST",
    dstRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    dstDtstart: "19700329T030000",
    stdDtstart: "19701025T040000",
  },
  "Europe/Kyiv": {
    stdOffset: 120, dstOffset: 180,
    stdName: "EET", dstName: "EEST",
    dstRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    dstDtstart: "19700329T030000",
    stdDtstart: "19701025T040000",
  },
  "Europe/Athens": {
    stdOffset: 120, dstOffset: 180,
    stdName: "EET", dstName: "EEST",
    dstRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    dstDtstart: "19700329T030000",
    stdDtstart: "19701025T040000",
  },
  // Western European Time / British Summer Time
  "Europe/London": {
    stdOffset: 0, dstOffset: 60,
    stdName: "GMT", dstName: "BST",
    dstRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    dstDtstart: "19700329T010000",
    stdDtstart: "19701025T020000",
  },
  "Europe/Dublin": {
    stdOffset: 0, dstOffset: 60,
    stdName: "GMT", dstName: "IST",
    dstRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    dstDtstart: "19700329T010000",
    stdDtstart: "19701025T020000",
  },
  // US Eastern
  "America/New_York": {
    stdOffset: -300, dstOffset: -240,
    stdName: "EST", dstName: "EDT",
    dstRrule: "FREQ=YEARLY;BYDAY=2SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=1SU;BYMONTH=11",
    dstDtstart: "19700308T020000",
    stdDtstart: "19701101T020000",
  },
  // US Central
  "America/Chicago": {
    stdOffset: -360, dstOffset: -300,
    stdName: "CST", dstName: "CDT",
    dstRrule: "FREQ=YEARLY;BYDAY=2SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=1SU;BYMONTH=11",
    dstDtstart: "19700308T020000",
    stdDtstart: "19701101T020000",
  },
  // US Mountain
  "America/Denver": {
    stdOffset: -420, dstOffset: -360,
    stdName: "MST", dstName: "MDT",
    dstRrule: "FREQ=YEARLY;BYDAY=2SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=1SU;BYMONTH=11",
    dstDtstart: "19700308T020000",
    stdDtstart: "19701101T020000",
  },
  // US Pacific
  "America/Los_Angeles": {
    stdOffset: -480, dstOffset: -420,
    stdName: "PST", dstName: "PDT",
    dstRrule: "FREQ=YEARLY;BYDAY=2SU;BYMONTH=3",
    stdRrule: "FREQ=YEARLY;BYDAY=1SU;BYMONTH=11",
    dstDtstart: "19700308T020000",
    stdDtstart: "19701101T020000",
  },
  // Australian Eastern Time
  "Australia/Sydney": {
    stdOffset: 600, dstOffset: 660,
    stdName: "AEST", dstName: "AEDT",
    dstRrule: "FREQ=YEARLY;BYDAY=1SU;BYMONTH=10",
    stdRrule: "FREQ=YEARLY;BYDAY=1SU;BYMONTH=4",
    dstDtstart: "19701004T020000",
    stdDtstart: "19700405T030000",
  },
};

/**
 * Build a VTIMEZONE block string (CRLF line endings) for the given IANA tzid.
 *
 * If the timezone is in KNOWN_TZ_CONFIGS we emit a full RRULE-based block.
 * Otherwise we probe the current offsets and emit either a DST block (using a
 * generic "last Sunday" rule) or a simple STANDARD-only block.
 */
export function generateVTimezone(tzid: string): string {
  const lines: string[] = [];
  const push = (...ls: string[]) => lines.push(...ls);

  // Helper: join with CRLF
  const crlf = (arr: string[]) => arr.join("\r\n");

  const known = KNOWN_TZ_CONFIGS[tzid];
  if (known) {
    const { stdOffset, dstOffset, stdName, dstName, dstRrule, stdRrule, dstDtstart, stdDtstart } = known;
    push(
      "BEGIN:VTIMEZONE",
      `TZID:${tzid}`,
      "BEGIN:DAYLIGHT",
      `TZOFFSETFROM:${formatOffsetMinutes(stdOffset)}`,
      `TZOFFSETTO:${formatOffsetMinutes(dstOffset)}`,
      `TZNAME:${dstName}`,
      `DTSTART:${dstDtstart}`,
      `RRULE:${dstRrule}`,
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      `TZOFFSETFROM:${formatOffsetMinutes(dstOffset)}`,
      `TZOFFSETTO:${formatOffsetMinutes(stdOffset)}`,
      `TZNAME:${stdName}`,
      `DTSTART:${stdDtstart}`,
      `RRULE:${stdRrule}`,
      "END:STANDARD",
      "END:VTIMEZONE"
    );
    return crlf(lines);
  }

  // Unknown timezone: probe current offsets
  const now = new Date();
  const janDate = new Date(now.getFullYear(), 0, 15, 12, 0, 0); // January  — likely standard
  const julDate = new Date(now.getFullYear(), 6, 15, 12, 0, 0); // July     — likely DST

  const janOffset = getOffsetMinutesAt(janDate, tzid);
  const julOffset = getOffsetMinutesAt(julDate, tzid);

  if (janOffset === julOffset) {
    // No DST — emit a simple STANDARD-only block
    push(
      "BEGIN:VTIMEZONE",
      `TZID:${tzid}`,
      "BEGIN:STANDARD",
      `TZOFFSETFROM:${formatOffsetMinutes(janOffset)}`,
      `TZOFFSETTO:${formatOffsetMinutes(janOffset)}`,
      `TZNAME:${tzid}`,
      "DTSTART:19700101T000000",
      "END:STANDARD",
      "END:VTIMEZONE"
    );
  } else {
    // DST exists — use the probed offsets with a generic "last Sunday" rule.
    // This is an approximation; correct transitions require tzdata.
    const stdOffset = janOffset < julOffset ? janOffset : julOffset;
    const dstOffset = janOffset < julOffset ? julOffset : janOffset;
    const northernHemisphere = julOffset > janOffset;

    push(
      "BEGIN:VTIMEZONE",
      `TZID:${tzid}`,
      "BEGIN:DAYLIGHT",
      `TZOFFSETFROM:${formatOffsetMinutes(stdOffset)}`,
      `TZOFFSETTO:${formatOffsetMinutes(dstOffset)}`,
      `TZNAME:${tzid} (DST)`,
      // Northern hemisphere: clocks go forward in spring (month 3 or 10)
      `DTSTART:${northernHemisphere ? "19700329T020000" : "19701025T020000"}`,
      `RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=${northernHemisphere ? "3" : "10"}`,
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      `TZOFFSETFROM:${formatOffsetMinutes(dstOffset)}`,
      `TZOFFSETTO:${formatOffsetMinutes(stdOffset)}`,
      `TZNAME:${tzid}`,
      `DTSTART:${northernHemisphere ? "19701025T030000" : "19700329T020000"}`,
      `RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=${northernHemisphere ? "10" : "3"}`,
      "END:STANDARD",
      "END:VTIMEZONE"
    );
  }

  return crlf(lines);
}
