/**
 * validate.ts
 *
 * URL validation and SSRF prevention.
 *
 * SSRF (Server-Side Request Forgery) mitigation:
 * We block requests to private/loopback IP ranges and non-HTTP(S) schemes so
 * the Worker cannot be used as a proxy to reach internal infrastructure.
 * Note: DNS rebinding attacks are not fully mitigatable here because we
 * resolve DNS at fetch time. For production use, a firewall rule or Cloudflare
 * Gateway policy should be added as an extra layer.
 */

/** Allowed URL schemes for calendar source URLs. */
const ALLOWED_SCHEMES = new Set(["https:", "http:"]);

/**
 * Private/reserved IPv4 CIDRs that must not be reachable by the Worker.
 * Represented as [base (as 32-bit int), prefix-length] pairs.
 */
const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [0x7f000000, 8],  // 127.0.0.0/8  — loopback
  [0x0a000000, 8],  // 10.0.0.0/8   — RFC 1918
  [0xac100000, 12], // 172.16.0.0/12 — RFC 1918
  [0xc0a80000, 16], // 192.168.0.0/16 — RFC 1918
  [0xa9fe0000, 16], // 169.254.0.0/16 — link-local
  [0x00000000, 8],  // 0.0.0.0/8    — this network
  [0xe0000000, 4],  // 224.0.0.0/4  — multicast
  [0xf0000000, 4],  // 240.0.0.0/4  — reserved
];

/** Hostnames that are always blocked regardless of resolved IP. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

/**
 * Parse an IPv4 address string to a 32-bit unsigned integer.
 * Returns null when the string is not a valid IPv4 address.
 */
function ipv4ToInt(addr: string): number | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (isNaN(n) || n < 0 || n > 255 || p.trim() !== p) return null;
    result = (result << 8) | n;
  }
  // Coerce to unsigned 32-bit integer
  return result >>> 0;
}

/**
 * Returns true when the IPv4 address falls within any private/reserved range.
 */
function isPrivateIPv4(addr: string): boolean {
  const ip = ipv4ToInt(addr);
  if (ip === null) return false;
  for (const [base, prefix] of PRIVATE_IPV4_RANGES) {
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    if ((ip & mask) === (base & mask)) return true;
  }
  return false;
}

/**
 * Returns true when the host looks like an IPv6 loopback/link-local address.
 * We cannot perform a full IPv6 range check without a dedicated library, but
 * we catch the most common cases.
 */
function isSuspiciousIPv6(host: string): boolean {
  // Strip brackets that wrap IPv6 in URLs: [::1]
  const h = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  const lower = h.toLowerCase();
  return (
    lower === "::1" ||               // loopback
    lower.startsWith("fc") ||        // fc00::/7 unique local
    lower.startsWith("fd") ||
    lower.startsWith("fe80") ||      // link-local
    lower.startsWith("ff")           // multicast
  );
}

/**
 * Validate and sanitise a calendar source URL.
 *
 * @returns A fully-parsed URL object on success.
 * @throws  An Error with a user-facing message on failure.
 */
export function validateSourceUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL: could not parse the provided calendar URL.");
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new Error(
      `Invalid URL scheme "${url.protocol}". Only http:// and https:// are allowed.`
    );
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`Blocked hostname "${hostname}".`);
  }

  if (isPrivateIPv4(hostname)) {
    throw new Error(
      "The URL points to a private or reserved IP address. Only public addresses are allowed."
    );
  }

  if (isSuspiciousIPv6(hostname)) {
    throw new Error(
      "The URL points to a private or loopback IPv6 address. Only public addresses are allowed."
    );
  }

  // Block access to the metadata/IMDS endpoints commonly used in cloud providers
  if (
    hostname === "169.254.169.254" ||
    hostname === "metadata.google.internal" ||
    hostname === "metadata.internal"
  ) {
    throw new Error("Access to cloud metadata endpoints is not permitted.");
  }

  return url;
}

/**
 * Validate a target timezone string.
 * Uses the Intl API to check whether the IANA tzid is recognised.
 *
 * @throws An Error when the tzid is not a recognised IANA timezone.
 */
export function validateTimezone(tzid: string): string {
  if (!tzid || typeof tzid !== "string") {
    throw new Error("Timezone must be a non-empty string.");
  }
  if (tzid.length > 64) {
    throw new Error("Timezone string is too long.");
  }
  // Only allow characters valid in IANA timezone names
  if (!/^[A-Za-z0-9/_+-]+$/.test(tzid)) {
    throw new Error(`Invalid timezone identifier "${tzid}".`);
  }
  try {
    // If the tzid is unknown, Intl will throw a RangeError
    Intl.DateTimeFormat(undefined, { timeZone: tzid });
  } catch {
    throw new Error(`Unknown timezone "${tzid}". Use an IANA timezone name such as "Europe/Berlin".`);
  }
  return tzid;
}

/**
 * Parse and validate a manual UTC offset expressed as minutes.
 * Accepts strings like "+60", "-120", "60", "0".
 * Valid range: -840 to +840 (±14 hours).
 */
export function validateOffsetMinutes(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  if (!/^[+-]?\d+$/.test(raw)) {
    throw new Error(
      "Invalid UTC offset. Provide an integer between -840 and 840 (minutes)."
    );
  }
  const n = Number(raw);
  if (isNaN(n) || Math.abs(n) > 840) {
    throw new Error(
      "Invalid UTC offset. Provide an integer between -840 and 840 (minutes)."
    );
  }
  return n;
}

/** Allowed mode values. */
export type TransformMode = "passthrough" | "force" | "shift";

/** Parse and validate the transformation mode query parameter. */
export function validateMode(raw: string | null): TransformMode {
  if (raw === null || raw === "") return "force";
  if (raw === "passthrough" || raw === "force" || raw === "shift") return raw;
  throw new Error(
    `Unknown mode "${raw}". Valid modes are: passthrough, force, shift.`
  );
}
