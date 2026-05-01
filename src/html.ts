/**
 * html.ts
 *
 * Renders the lightweight HTML configuration UI.
 * No external CSS framework or JavaScript library is used.
 */

export interface UiParams {
  workerUrl: string;
  defaultTz?: string;
  embedded?: boolean;
}

/** Returns the full HTML page for the configuration UI. */
export function renderUi(params: UiParams): string {
  const { workerUrl, defaultTz = "Europe/Berlin", embedded = false } = params;

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
    ["America/New_York", "America/New York (EST/EDT, UTC-5/-4)"],
    ["America/Chicago", "America/Chicago (CST/CDT, UTC-6/-5)"],
    ["America/Denver", "America/Denver (MST/MDT, UTC-7/-6)"],
    ["America/Los_Angeles", "America/Los Angeles (PST/PDT, UTC-8/-7)"],
    ["UTC", "UTC"],
    ["__other", "Other"],
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

    :root {
      --white: #FFFFFF;
      --logo-white: #F6F6F6;
      --light-gray: #8F8F8F;
      --gray: #282828;
      --dark-gray: #27292B;
      --black: #0A0A0A;
      --error: #B00020;
      --error-bg: #FFF5F6;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                   Helvetica, Arial, sans-serif;
      background: var(--logo-white);
      color: var(--black);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem;
    }

    main {
      background: var(--white);
      border: 1px solid var(--light-gray);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(10, 10, 10, .08);
      overflow: hidden;
      max-width: 720px;
      width: 100%;
    }

    body.embedded {
      background: transparent;
      min-height: auto;
      padding: 0;
    }

    body.embedded main {
      border-radius: 0;
      box-shadow: none;
      max-width: none;
    }

    body.embedded footer { display: none; }

    .header {
      background: var(--black);
      color: var(--white);
      padding: 1.6rem 2.5rem 1.45rem;
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: .5rem;
      color: var(--white);
    }

    .intro, .hint, .note, .mode-card span {
      color: var(--gray);
      line-height: 1.5;
    }

    .intro {
      color: var(--logo-white);
      font-size: .9rem;
      margin-bottom: 0;
      max-width: 58rem;
    }

    .content {
      padding: 1.65rem 2.5rem 2rem;
    }

    .note {
      background: var(--logo-white);
      border-left: 4px solid var(--black);
      border-radius: 0 7px 7px 0;
      font-size: .82rem;
      margin-bottom: 1.5rem;
      padding: .8rem .9rem;
    }

    label {
      display: block;
      font-size: .85rem;
      font-weight: 600;
      margin-bottom: .35rem;
      color: var(--dark-gray);
    }

    input[type="text"], input[type="url"], input[type="number"], select {
      width: 100%;
      padding: .55rem .75rem;
      border: 1.5px solid var(--light-gray);
      border-radius: 7px;
      font-size: .95rem;
      outline: none;
      transition: border-color .15s, box-shadow .15s;
      background: var(--white);
      color: var(--black);
    }

    input:focus, select:focus {
      border-color: var(--black);
      background: var(--white);
      box-shadow: 0 0 0 3px rgba(40, 40, 40, .12);
    }

    .field { margin-bottom: 1.25rem; }

    .hint {
      font-size: .78rem;
      margin-top: .3rem;
    }

    .other-panel {
      background: var(--logo-white);
      border: 1px solid var(--light-gray);
      border-radius: 7px;
      display: none;
      margin-top: .75rem;
      padding: .85rem;
    }

    .other-panel.open { display: block; }

    .choice-row {
      display: flex;
      align-items: center;
      gap: .5rem;
      font-size: .84rem;
      font-weight: 600;
      margin-bottom: .55rem;
    }

    .choice-row input { flex: 0 0 auto; }

    .choice-field {
      display: none;
      margin: .35rem 0 1rem 1.4rem;
    }

    .choice-field.open { display: block; }

    .mode-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: .75rem;
      margin-bottom: 1.25rem;
    }

    .mode-card {
      border: 2px solid var(--light-gray);
      border-radius: 8px;
      padding: .75rem 1rem;
      cursor: pointer;
      transition: border-color .15s, background .15s, box-shadow .15s;
    }

    .mode-card.disabled {
      background: var(--logo-white);
      border-color: var(--light-gray);
      cursor: not-allowed;
      opacity: .55;
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
      border-color: var(--black);
      background: var(--logo-white);
      box-shadow: inset 4px 0 0 var(--black);
    }

    .mode-card:has(input:focus-visible) {
      outline: 3px solid var(--gray);
      outline-offset: 2px;
    }
    .mode-card strong { font-size: .9rem; display: block; margin-bottom: .25rem; }
    .mode-card span   { font-size: .78rem; }

    button {
      width: 100%;
      padding: .7rem 1rem;
      background: var(--black);
      color: var(--white);
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background .15s, transform .15s;
      margin-top: .5rem;
    }

    button:hover { background: var(--gray); }
    button:active { transform: translateY(1px); }
    button:disabled {
      background: var(--light-gray);
      cursor: wait;
      transform: none;
    }

    #result {
      background: var(--logo-white);
      border: 2px solid var(--black);
      border-radius: 8px;
      display: none;
      margin-top: 1.5rem;
      padding: 1rem;
    }

    .result-title {
      color: var(--black);
      font-size: 1rem;
      font-weight: 700;
      margin-bottom: .25rem;
    }

    .result-copy {
      color: var(--gray);
      font-size: .84rem;
      line-height: 1.5;
      margin-bottom: .85rem;
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
      border: 1.5px solid var(--light-gray);
      border-radius: 7px;
      background: var(--white);
      word-break: break-all;
    }

    .copy-btn {
      width: auto;
      padding: .5rem .9rem;
      margin-top: 0;
      font-size: .85rem;
      flex-shrink: 0;
    }

    .result-actions {
      display: flex;
      gap: .5rem;
      margin-top: .75rem;
    }

    .secondary-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 2.25rem;
      padding: .5rem .9rem;
      border: 1.5px solid var(--light-gray);
      border-radius: 7px;
      color: var(--black);
      text-decoration: none;
      font-size: .85rem;
      font-weight: 600;
      background: var(--white);
    }

    .secondary-link:hover {
      border-color: var(--black);
    }

    .info-box {
      margin-top: 1.25rem;
      background: var(--logo-white);
      border: 1px solid var(--light-gray);
      border-radius: 8px;
      padding: .75rem 1rem;
      font-size: .82rem;
      color: var(--gray);
      line-height: 1.5;
    }

    .error-box {
      margin-top: 1rem;
      background: var(--error-bg);
      border: 1.5px solid var(--error);
      border-radius: 8px;
      padding: .75rem 1rem;
      font-size: .85rem;
      color: var(--error);
      line-height: 1.45;
    }

    footer {
      margin-top: 2rem;
      font-size: .78rem;
      color: var(--light-gray);
      text-align: center;
    }

    @media (max-width: 560px) {
      .header, .content { padding-left: 1.25rem; padding-right: 1.25rem; }
      .result-url-wrap, .result-actions {
        flex-direction: column;
      }
      .copy-btn { width: 100%; }
    }
  </style>
</head>
<body class="${embedded ? "embedded" : ""}">
<main>
  <div class="header">
    <h1>Outlook iCal Timezone Fixer</h1>
    <p class="intro">
      Generate a corrected subscription URL for Outlook calendar feeds that
      appear with shifted times in calendar apps.
    </p>
  </div>

  <div class="content">
    <p class="note">
      This page does not store your calendar URL. The generated link points
      back to this Worker, which fetches the original feed and applies the
      selected conversion whenever your calendar app refreshes it.
    </p>

    <form id="configForm" novalidate>
    <div class="field">
      <label for="icsUrl">Outlook ICS/iCal URL</label>
      <input
        type="url"
        id="icsUrl"
        name="url"
        placeholder="https://outlook.office365.com/owa/calendar/.../reachcalendar.ics"
        autocomplete="off"
        spellcheck="false"
      />
      <p class="hint">Use the public subscription URL from Outlook's publish or share settings.</p>
    </div>

    <div class="field">
      <label for="timezone">Target timezone</label>
      <select id="timezone" name="tz">
          ${tzOptions}
      </select>
      <div class="other-panel" id="otherTimezonePanel">
        <label class="choice-row">
          <input type="radio" name="otherTimezoneType" value="iana" checked />
          IANA timezone
        </label>
        <div class="choice-field open" id="ianaTimezoneField">
          <input
            type="text"
            id="customTimezone"
            placeholder="e.g. Asia/Tokyo"
            autocomplete="off"
            spellcheck="false"
          />
          <p class="hint">Use a valid IANA timezone name.</p>
        </div>

        <label class="choice-row">
          <input type="radio" name="otherTimezoneType" value="offset" />
          Fixed offset from UTC
        </label>
        <div class="choice-field" id="utcOffsetField">
          <input
            type="number"
            id="utcOffsetMinutes"
            placeholder="e.g. 60 for UTC+1, -300 for UTC-5"
            min="-840"
            max="840"
          />
          <p class="hint">Fixed offsets are not DST-aware and always use shift mode.</p>
        </div>
      </div>
      <p class="hint">
        Select a preset timezone, or choose Other for a custom IANA timezone or
        a fixed UTC offset.
      </p>
    </div>

    <div class="field">
      <label>Conversion mode</label>
      <div class="mode-grid" id="modeGrid">
        <label class="mode-card selected">
          <input type="radio" name="mode" value="force" checked />
          <strong>Force TZID (recommended)</strong>
          <span>
            Converts UTC timestamps into local wall-clock time and marks
            floating timestamps with the selected timezone. A matching
            VTIMEZONE block is added.
          </span>
        </label>
        <label class="mode-card">
          <input type="radio" name="mode" value="shift" />
          <strong>Shift by offset</strong>
          <span>
            Adds a fixed number of minutes to UTC timestamps. This is simple
            but not DST-aware, so use it only for troubleshooting.
          </span>
        </label>
        <label class="mode-card">
          <input type="radio" name="mode" value="passthrough" />
          <strong>Passthrough</strong>
          <span>
            Returns the feed unchanged. Useful for checking that the proxy
            itself is reachable.
          </span>
        </label>
      </div>
    </div>

    <div id="formError" class="error-box" style="display:none;"></div>

    <button id="generateBtn" type="submit">Generate corrected ICS URL</button>
    </form>

  <div id="result">
    <div class="result-title">Generated ICS link</div>
    <p class="result-copy">
      Use this URL as the ICS subscription link in your calendar app.
    </p>
    <label>Your corrected ICS subscription URL:</label>
    <div class="result-url-wrap">
      <input type="text" id="resultUrl" readonly />
      <button class="copy-btn" id="copyBtn" type="button">Copy</button>
    </div>
    <div class="result-actions">
      <a class="secondary-link" id="openLink" href="#" target="_blank" rel="noopener">
        Open feed
      </a>
    </div>
    <div class="info-box" id="infoBox"></div>
    </div>
  </div>
</main>

<footer>
  Cloudflare Worker - Outlook iCal Proxy -
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
  const openLink = document.getElementById("openLink");
  const generateBtn = document.getElementById("generateBtn");
  const formError = document.getElementById("formError");
  const infoBox = document.getElementById("infoBox");
  const timezoneSelect = document.getElementById("timezone");
  const otherPanel = document.getElementById("otherTimezonePanel");
  const ianaField = document.getElementById("ianaTimezoneField");
  const offsetField = document.getElementById("utcOffsetField");

  function selectedOtherType() {
    return document.querySelector('input[name="otherTimezoneType"]:checked').value;
  }

  function setSelectedMode(mode) {
    const input = document.querySelector('input[name="mode"][value="' + mode + '"]');
    input.checked = true;
    modeCards.forEach(function (card) {
      card.classList.toggle("selected", card.contains(input));
    });
  }

  function syncModeLock() {
    const fixedOffsetSelected =
      timezoneSelect.value === "__other" && selectedOtherType() === "offset";

    if (fixedOffsetSelected) {
      setSelectedMode("shift");
    }

    modeCards.forEach(function (card) {
      const input = card.querySelector('input[name="mode"]');
      const disabled = fixedOffsetSelected && input.value !== "shift";
      input.disabled = disabled;
      card.classList.toggle("disabled", disabled);
    });
  }

  // Highlight selected mode card
  modeCards.forEach(function (card) {
    card.addEventListener("click", function () {
      const input = card.querySelector('input[name="mode"]');
      if (input.disabled) return;
      modeCards.forEach(function (c) { c.classList.remove("selected"); });
      card.classList.add("selected");
    });
  });

  timezoneSelect.addEventListener("change", function () {
    otherPanel.classList.toggle("open", timezoneSelect.value === "__other");
    syncModeLock();
  });

  document.querySelectorAll('input[name="otherTimezoneType"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
      const type = selectedOtherType();
      ianaField.classList.toggle("open", type === "iana");
      offsetField.classList.toggle("open", type === "offset");
      syncModeLock();
    });
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    formError.style.display = "none";
    resultDiv.style.display = "none";
    generateBtn.disabled = true;
    generateBtn.textContent = "Checking ICS feed...";

    try {
      const icsUrl = document.getElementById("icsUrl").value.trim();
      let tz = timezoneSelect.value;
      let mode = document.querySelector('input[name="mode"]:checked').value;
      let offset = "";

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

      if (tz === "__other") {
        const type = document.querySelector('input[name="otherTimezoneType"]:checked').value;
        if (type === "iana") {
          tz = document.getElementById("customTimezone").value.trim();
          if (!tz) {
            showError("Please enter an IANA timezone name.");
            return;
          }
          if (!/^[A-Za-z0-9/_+-]+$/.test(tz)) {
            showError("The timezone must be an IANA name such as Asia/Tokyo.");
            return;
          }
        } else {
          offset = document.getElementById("utcOffsetMinutes").value.trim();
          if (!/^[+-]?\\d+$/.test(offset)) {
            showError("Please enter a UTC offset in whole minutes.");
            return;
          }
          const offsetNumber = Number(offset);
          if (!Number.isFinite(offsetNumber) || Math.abs(offsetNumber) > 840) {
            showError("UTC offset must be between -840 and 840 minutes.");
            return;
          }
          tz = "UTC";
          mode = "shift";
        }
      }

      const base = ${JSON.stringify(workerUrl)};
      const params = new URLSearchParams({ url: icsUrl, tz: tz, mode: mode });
      if (offset !== "") params.set("offset", offset);

      const generated = base + "/calendar?" + params.toString();
      const validation = await validateGeneratedCalendar(generated);
      if (!validation.ok) {
        showError(validation.message);
        return;
      }

      resultUrl.value = generated;
      openLink.href = generated;
      resultDiv.style.display = "block";

      const modeDescriptions = {
        force: "The feed was checked successfully. It uses DST-aware TZID-annotated timestamps for " + tz + ". A VTIMEZONE block has been embedded.",
        shift: offset
          ? "The feed was checked successfully. UTC timestamps are shifted by " + offset + " minutes."
          : "The feed was checked successfully. UTC timestamps are shifted by the current offset of " + tz + ".",
        passthrough: "The feed was checked successfully and is returned unchanged (passthrough mode).",
      };
      infoBox.textContent = modeDescriptions[mode] || "";
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = "Generate corrected ICS URL";
    }
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

  async function validateGeneratedCalendar(url) {
    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "text/calendar" },
      });
      const body = await response.text();

      if (!response.ok) {
        return {
          ok: false,
          message: body.trim() || "The Worker could not generate an ICS feed from this URL.",
        };
      }

      const contentType = response.headers.get("Content-Type") || "";
      if (!contentType.includes("text/calendar") || !body.includes("BEGIN:VCALENDAR")) {
        return {
          ok: false,
          message: "The URL was reachable, but it did not generate a valid ICS calendar.",
        };
      }

      return { ok: true };
    } catch (_) {
      return {
        ok: false,
        message: "The generated link could not be checked. Make sure the Outlook ICS URL is reachable.",
      };
    }
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
