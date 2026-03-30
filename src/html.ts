/**
 * html.ts
 *
 * Renders the lightweight HTML configuration UI.
 * No external CSS framework or JavaScript library is used.
 */

export interface UiParams {
  workerUrl: string;
  defaultTz?: string;
}

/** Returns the full HTML page for the configuration UI. */
export function renderUi(params: UiParams): string {
  const { workerUrl, defaultTz = "Europe/Berlin" } = params;

  // Common European IANA timezone options
  const tzOptions = [
    ["Europe/Berlin", "Europe/Berlin (CET/CEST, UTC+1/+2)"],
    ["Europe/London", "Europe/London (GMT/BST, UTC+0/+1)"],
    ["Europe/Paris", "Europe/Paris (CET/CEST, UTC+1/+2)"],
    ["Europe/Amsterdam", "Europe/Amsterdam (CET/CEST, UTC+1/+2)"],
    ["Europe/Rome", "Europe/Rome (CET/CEST, UTC+1/+2)"],
    ["Europe/Madrid", "Europe/Madrid (CET/CEST, UTC+1/+2)"],
    ["Europe/Vienna", "Europe/Vienna (CET/CEST, UTC+1/+2)"],
    ["Europe/Helsinki", "Europe/Helsinki (EET/EEST, UTC+2/+3)"],
    ["Europe/Athens", "Europe/Athens (EET/EEST, UTC+2/+3)"],
    ["America/New_York", "America/New_York (EST/EDT, UTC-5/-4)"],
    ["America/Chicago", "America/Chicago (CST/CDT, UTC-6/-5)"],
    ["America/Denver", "America/Denver (MST/MDT, UTC-7/-6)"],
    ["America/Los_Angeles", "America/Los_Angeles (PST/PDT, UTC-8/-7)"],
    ["UTC", "UTC"],
  ]
    .map(
      ([v, label]) =>
        `<option value="${esc(v!)}"${v === defaultTz ? " selected" : ""}>${esc(label!)}</option>`
    )
    .join("\n          ");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Outlook iCal Timezone Fixer</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                   Helvetica, Arial, sans-serif;
      background: #f5f6fa;
      color: #222;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem;
    }

    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 2px 16px rgba(0,0,0,.10);
      padding: 2rem 2.5rem;
      max-width: 680px;
      width: 100%;
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: .25rem;
      color: #1a1a2e;
    }

    .subtitle {
      color: #555;
      font-size: .9rem;
      margin-bottom: 1.75rem;
      line-height: 1.5;
    }

    label {
      display: block;
      font-size: .85rem;
      font-weight: 600;
      margin-bottom: .35rem;
      color: #333;
    }

    input[type="text"], input[type="url"], input[type="number"], select {
      width: 100%;
      padding: .55rem .75rem;
      border: 1.5px solid #d1d5db;
      border-radius: 7px;
      font-size: .95rem;
      outline: none;
      transition: border-color .15s;
      background: #fafafa;
    }

    input:focus, select:focus {
      border-color: #4f46e5;
      background: #fff;
    }

    .field { margin-bottom: 1.25rem; }

    .hint {
      font-size: .78rem;
      color: #6b7280;
      margin-top: .3rem;
    }

    .mode-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: .75rem;
      margin-bottom: 1.25rem;
    }

    .mode-card {
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      padding: .75rem 1rem;
      cursor: pointer;
      transition: border-color .15s, background .15s;
    }

    .mode-card input[type="radio"] {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
      margin: 0;
      padding: 0;
      pointer-events: none;
    }

    .mode-card.selected, .mode-card:has(input:checked) {
      border-color: #4f46e5;
      background: #eef2ff;
    }

    .mode-card:has(input:focus-visible) {
      outline: 3px solid #10b981;
      outline-offset: 2px;
    }
    .mode-card strong { font-size: .9rem; display: block; margin-bottom: .25rem; }
    .mode-card span   { font-size: .78rem; color: #555; line-height: 1.4; }

    button {
      width: 100%;
      padding: .7rem 1rem;
      background: #4f46e5;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background .15s;
      margin-top: .5rem;
    }

    button:hover { background: #4338ca; }

    #result {
      margin-top: 1.5rem;
      display: none;
    }

    #result label { margin-bottom: .4rem; }

    .result-url-wrap {
      display: flex;
      gap: .5rem;
    }

    #resultUrl {
      flex: 1;
      font-family: monospace;
      font-size: .82rem;
      padding: .5rem .75rem;
      border: 1.5px solid #d1d5db;
      border-radius: 7px;
      background: #f9fafb;
      word-break: break-all;
    }

    .copy-btn {
      width: auto;
      padding: .5rem .9rem;
      margin-top: 0;
      font-size: .85rem;
      flex-shrink: 0;
    }

    .info-box {
      margin-top: 1.25rem;
      background: #f0fdf4;
      border: 1px solid #86efac;
      border-radius: 8px;
      padding: .75rem 1rem;
      font-size: .82rem;
      color: #166534;
      line-height: 1.5;
    }

    .error-box {
      margin-top: 1rem;
      background: #fef2f2;
      border: 1px solid #fca5a5;
      border-radius: 8px;
      padding: .75rem 1rem;
      font-size: .85rem;
      color: #991b1b;
    }

    footer {
      margin-top: 2rem;
      font-size: .78rem;
      color: #9ca3af;
      text-align: center;
    }

    .advanced-toggle {
      font-size: .82rem;
      color: #4f46e5;
      cursor: pointer;
      user-select: none;
      margin-bottom: 1rem;
    }

    #advancedSection { display: none; }
    #advancedSection.open { display: block; }
  </style>
</head>
<body>
<div class="card">
  <h1>📅 Outlook iCal Timezone Fixer</h1>
  <p class="subtitle">
    Outlook calendar feeds sometimes appear with wrong times in Google Calendar
    because timezone data is missing or misinterpreted.  Paste your Outlook ICS
    URL below to generate a corrected feed you can subscribe to.
  </p>

  <form id="configForm" novalidate>
    <div class="field">
      <label for="icsUrl">Outlook ICS / iCal URL</label>
      <input
        type="url"
        id="icsUrl"
        name="url"
        placeholder="https://outlook.office365.com/owa/calendar/…/reachcalendar.ics"
        autocomplete="off"
        spellcheck="false"
      />
      <p class="hint">The public subscription URL from Outlook (Share → Publish / ICS link).</p>
    </div>

    <div class="field">
      <label for="timezone">Target timezone</label>
      <select id="timezone" name="tz">
          ${tzOptions}
      </select>
      <p class="hint">
        The timezone the events should be displayed in. Defaults to
        <code>Europe/Berlin</code>.
      </p>
    </div>

    <div class="field">
      <label>Conversion mode</label>
      <div class="mode-grid" id="modeGrid">
        <label class="mode-card selected">
          <input type="radio" name="mode" value="force" checked />
          <strong>Force TZID (recommended)</strong>
          <span>
            Converts UTC timestamps to the target timezone using DST-aware
            conversion, and annotates floating times with a TZID.  A correct
            VTIMEZONE block is added.
          </span>
        </label>
        <label class="mode-card">
          <input type="radio" name="mode" value="shift" />
          <strong>Shift by offset</strong>
          <span>
            Adds a fixed number of minutes to UTC timestamps.  Simple but not
            DST-aware.  Use when the "Force TZID" mode doesn't work for your
            client.
          </span>
        </label>
        <label class="mode-card">
          <input type="radio" name="mode" value="passthrough" />
          <strong>Passthrough</strong>
          <span>
            Returns the feed unchanged.  Useful for testing that the proxy
            itself is reachable.
          </span>
        </label>
      </div>
    </div>

    <span class="advanced-toggle" id="advancedToggle" role="button" tabindex="0">
      ▸ Advanced options
    </span>
    <div id="advancedSection">
      <div class="field">
        <label for="offsetMinutes">Manual UTC offset (minutes)</label>
        <input
          type="number"
          id="offsetMinutes"
          name="offset"
          placeholder="e.g. 60 for UTC+1, -300 for UTC-5"
          min="-840"
          max="840"
        />
        <p class="hint">
          Used only in <em>Shift by offset</em> mode.  Leave blank to
          auto-derive from the selected timezone.
        </p>
      </div>
    </div>

    <div id="formError" class="error-box" style="display:none;"></div>

    <button type="submit">Generate corrected ICS URL</button>
  </form>

  <div id="result">
    <label>Your corrected ICS subscription URL:</label>
    <div class="result-url-wrap">
      <input type="text" id="resultUrl" readonly />
      <button class="copy-btn" id="copyBtn" type="button">Copy</button>
    </div>
    <div class="info-box" id="infoBox"></div>
  </div>
</div>

<footer>
  Cloudflare Worker · Outlook iCal Proxy ·
  <a href="https://github.com/jasonhaak/cloudflare-outlook-calendar-worker"
     style="color:inherit" target="_blank" rel="noopener">GitHub</a>
</footer>

<script>
(function () {
  "use strict";

  const form = document.getElementById("configForm");
  const modeCards = document.querySelectorAll(".mode-card");
  const resultDiv = document.getElementById("result");
  const resultUrl = document.getElementById("resultUrl");
  const copyBtn = document.getElementById("copyBtn");
  const formError = document.getElementById("formError");
  const infoBox = document.getElementById("infoBox");
  const advToggle = document.getElementById("advancedToggle");
  const advSection = document.getElementById("advancedSection");

  // Highlight selected mode card
  modeCards.forEach(function (card) {
    card.addEventListener("click", function () {
      modeCards.forEach(function (c) { c.classList.remove("selected"); });
      card.classList.add("selected");
    });
  });

  // Toggle advanced section
  advToggle.addEventListener("click", function () {
    advSection.classList.toggle("open");
    advToggle.textContent = advSection.classList.contains("open")
      ? "▾ Advanced options"
      : "▸ Advanced options";
  });
  advToggle.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") advToggle.click();
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    formError.style.display = "none";
    resultDiv.style.display = "none";

    const icsUrl = document.getElementById("icsUrl").value.trim();
    const tz = document.getElementById("timezone").value;
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const offset = document.getElementById("offsetMinutes").value.trim();

    if (!icsUrl) {
      showError("Please enter an Outlook ICS URL.");
      return;
    }
    try { new URL(icsUrl); } catch (_) {
      showError("The ICS URL does not look valid. Make sure it starts with https://");
      return;
    }
    if (!icsUrl.startsWith("https://") && !icsUrl.startsWith("http://")) {
      showError("Only http:// and https:// URLs are supported.");
      return;
    }

    const base = ${JSON.stringify(workerUrl)};
    const params = new URLSearchParams({ url: icsUrl, tz: tz, mode: mode });
    if (offset !== "") params.set("offset", offset);

    const generated = base + "/calendar?" + params.toString();
    resultUrl.value = generated;
    resultDiv.style.display = "block";

    const modeDescriptions = {
      force: "The feed uses DST-aware TZID-annotated timestamps for " + tz + ". A VTIMEZONE block has been embedded.",
      shift: offset
        ? "UTC timestamps are shifted by " + offset + " minutes."
        : "UTC timestamps are shifted by the current offset of " + tz + ".",
      passthrough: "The feed is returned unchanged (passthrough mode).",
    };
    infoBox.textContent = modeDescriptions[mode] || "";
  });

  copyBtn.addEventListener("click", function () {
    resultUrl.select();
    try {
      navigator.clipboard.writeText(resultUrl.value).then(function () {
        copyBtn.textContent = "Copied!";
        setTimeout(function () { copyBtn.textContent = "Copy"; }, 2000);
      });
    } catch (_) {
      document.execCommand("copy");
      copyBtn.textContent = "Copied!";
      setTimeout(function () { copyBtn.textContent = "Copy"; }, 2000);
    }
  });

  function showError(msg) {
    formError.textContent = msg;
    formError.style.display = "block";
  }
})();
</script>
</body>
</html>`;
}

/** HTML-escape a string for safe insertion into attribute values / text. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
