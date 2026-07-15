import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderReport } from "../lib/render-report.ts";
import type { ApplicationDetails } from "../lib/ircc-client.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("renderReport includes app number, security flag and applicant", () => {
  const raw = readFileSync(
    join(root, "tests/fixtures/application-details.json"),
    "utf8",
  );
  const details = JSON.parse(raw) as ApplicationDetails;
  const report = renderReport(details, {
    focusUci: "11-1111-1111",
    generatedAt: "2026-07-15 12:00:00",
  });

  assert.equal(report.appNumber, "S300000000");
  assert.equal(report.hasSecurity, true);
  assert.equal(report.people.length, 1);
  assert.equal(report.people[0].roleLabel, "Principal applicant");
  assert.equal(report.generatedAt, "2026-07-15 12:00:00");
  assert.ok(
    report.people[0].events.some((e) => e.title === "Security / background review"),
  );
});

test("renderReport handles missing security", () => {
  const raw = readFileSync(
    join(root, "tests/fixtures/application-details-no-security.json"),
    "utf8",
  );
  const details = JSON.parse(raw) as ApplicationDetails;
  const report = renderReport(details, { focusUci: "22-2222-2222" });
  assert.equal(report.hasSecurity, false);
  assert.equal(report.statusLabel, "In progress");
  assert.equal(report.people.length, 1);
  // Eligibility module should read completed
  const eligibility = report.people[0].modules.find((m) => m.key === "eligibility");
  assert.equal(eligibility?.statusLabel, "Completed");
});