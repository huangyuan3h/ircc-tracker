import { NextResponse } from "next/server";
import {
  IrccApiError,
  cognitoLogin,
  fetchApplicationDetails,
  fetchProfileSummary,
  pickDefaultAppNumber,
} from "@/lib/ircc-client";
import { renderApplicationHtml } from "@/lib/render-report";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Body = {
  uci?: string;
  password?: string;
  appNumber?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const uci = (body.uci ?? "").trim();
    const password = body.password ?? "";
    let appNumber = (body.appNumber ?? "").trim();

    if (!uci || !password) {
      throw new IrccApiError(
        "usage",
        "Both uci and password are required.",
        400,
      );
    }

    const token = await cognitoLogin(uci, password);

    if (!appNumber) {
      const { apps } = await fetchProfileSummary(token);
      appNumber = pickDefaultAppNumber(apps);
    }

    const details = await fetchApplicationDetails(token, appNumber, uci);
    const html = renderApplicationHtml(details, {
      focusUci: uci,
      generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    });

    return NextResponse.json(
      { appNumber, html },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof IrccApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error(err);
    return NextResponse.json(
      { error: "Unexpected server error.", code: "query" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
