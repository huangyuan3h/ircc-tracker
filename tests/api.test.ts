import assert from "node:assert/strict";
import test from "node:test";
import {
  IrccApiError,
  pickDefaultAppNumber,
  type TrackerAppSummary,
} from "../lib/ircc-client.ts";

test("pickDefaultAppNumber returns first non-empty appNum", () => {
  const apps: TrackerAppSummary[] = [
    {
      appNum: "",
      appType: null,
      status: null,
      lastUpdated: null,
      paFirstName: null,
      paLastName: null,
      role: null,
    },
    {
      appNum: "E003591853",
      appType: "PV2",
      status: "inProgress",
      lastUpdated: "2026-05-21T00:00:00.000Z",
      paFirstName: "YUAN",
      paLastName: "HUANG",
      role: 1,
    },
  ];
  assert.equal(pickDefaultAppNumber(apps), "E003591853");
});

test("pickDefaultAppNumber throws when empty", () => {
  assert.throws(
    () => pickDefaultAppNumber([]),
    (err: unknown) =>
      err instanceof IrccApiError && err.code === "config",
  );
});
