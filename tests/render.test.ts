import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderApplicationHtml } from "../lib/render-report.ts";
import type { ApplicationDetails } from "../lib/ircc-client.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("renderApplicationHtml includes app number and security alert", () => {
  const raw = readFileSync(
    join(root, "tests/fixtures/application-details.json"),
    "utf8",
  );
  const details = JSON.parse(raw) as ApplicationDetails;
  const html = renderApplicationHtml(details, {
    focusUci: "11-1111-1111",
    generatedAt: "2026-07-15 12:00:00",
  });

  assert.match(html, /S300000000/);
  assert.match(html, /Security review detected/);
  assert.match(html, /Security \/ background review/);
  assert.match(html, /Principal applicant/);
  assert.match(html, /2026-07-15 12:00:00/);
});

test("renderApplicationHtml handles missing security", () => {
  const raw = readFileSync(
    join(root, "tests/fixtures/application-details-no-security.json"),
    "utf8",
  );
  const details = JSON.parse(raw) as ApplicationDetails;
  const html = renderApplicationHtml(details, { focusUci: "22-2222-2222" });
  assert.match(html, /No Security node detected/);
  assert.match(html, /Completed/);
});
