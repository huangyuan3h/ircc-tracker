import assert from "node:assert/strict";
import test from "node:test";
import {
  pickAppNumberFor,
  type TrackerAppSummary,
} from "../lib/ircc-client.ts";

function app(appNum: string, appType: string | null = null): TrackerAppSummary {
  return {
    appNum,
    appType,
    status: null,
    lastUpdated: null,
    paFirstName: null,
    paLastName: null,
    role: null,
  };
}

const apps = [app("A1", "TRV"), app("B2", "Study permit"), app("C3", "Work permit")];

test("pickAppNumberFor returns requested appNum when present", () => {
  assert.equal(pickAppNumberFor(apps, "B2"), "B2");
});

test("pickAppNumberFor falls back to default when requested is empty/whitespace", () => {
  assert.equal(pickAppNumberFor(apps, ""), "A1");
  assert.equal(pickAppNumberFor(apps, "   "), "A1");
  assert.equal(pickAppNumberFor(apps, undefined), "A1");
  assert.equal(pickAppNumberFor(apps, null), "A1");
});

test("pickAppNumberFor falls back to default when requested is unknown", () => {
  assert.equal(pickAppNumberFor(apps, "ZZZ-9999"), "A1");
});

test("pickAppNumberFor throws when apps is empty", () => {
  assert.throws(() => pickAppNumberFor([], "X"), /No applications found/);
});
