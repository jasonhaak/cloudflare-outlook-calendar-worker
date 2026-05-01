import { describe, expect, it } from "vitest";
import { renderUi } from "../src/html.js";

describe("renderUi", () => {
  it("renders the standalone UI with the configured worker URL and default timezone", () => {
    const html = renderUi({
      workerUrl: "https://calendar.example.com",
      defaultTz: "Europe/London",
    });

    expect(html).toContain("<h1>Outlook iCal Timezone Fixer</h1>");
    expect(html).toContain("https://calendar.example.com");
    expect(html).toContain('<option value="Europe/London" selected>');
    expect(html).toContain('<body class="">');
  });

  it("renders the embedded UI variant", () => {
    const html = renderUi({
      workerUrl: "https://calendar.example.com",
      embedded: true,
    });

    expect(html).toContain('<body class="embedded">');
    expect(html).toContain("body.embedded footer { display: none; }");
  });

  it("includes custom timezone and fixed offset controls", () => {
    const html = renderUi({ workerUrl: "https://calendar.example.com" });

    expect(html).toContain('<option value="__other">Other</option>');
    expect(html).toContain('id="customTimezone"');
    expect(html).toContain('id="utcOffsetMinutes"');
    expect(html).toContain("Fixed offsets are not DST-aware and always use shift mode.");
  });

  it("includes generated feed validation logic", () => {
    const html = renderUi({ workerUrl: "https://calendar.example.com" });

    expect(html).toContain("Checking ICS feed...");
    expect(html).toContain("validateGeneratedCalendar");
    expect(html).toContain("BEGIN:VCALENDAR");
    expect(html).toContain("Generated ICS link");
  });
});
