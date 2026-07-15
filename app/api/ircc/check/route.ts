import { NextResponse } from "next/server";
import {
  IrccApiError,
  fetchApplicationDetails,
  fetchProfileSummary,
  pickDefaultAppNumber,
  resolveIdToken,
} from "@/lib/ircc-client";
import { renderReport } from "@/lib/render-report";

export const dynamic = "force-dynamic";

type Body = {
  uci?: string;
  password?: string;
  idToken?: string;
  appNumber?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const uci = (body.uci ?? "").trim();
    let appNumber = (body.appNumber ?? "").trim();

    if (!uci) {
      throw new IrccApiError("usage", "uci is required.", 400);
    }

    const token = await resolveIdToken({
      idToken: body.idToken,
      uci,
      password: body.password,
    });

    if (!appNumber) {
      const { apps } = await fetchProfileSummary(token);
      appNumber = pickDefaultAppNumber(apps);
    }

    const details = await fetchApplicationDetails(token, appNumber, uci);
    const report = renderReport(details, {
      focusUci: uci,
      generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    });

    return NextResponse.json(
      { appNumber, report },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof IrccApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("check route failed", message);
    return NextResponse.json(
      { error: `Unexpected server error: ${message}`, code: "query" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}