import { NextResponse } from "next/server";
import {
  IrccApiError,
  cognitoLogin,
  fetchProfileSummary,
} from "@/lib/ircc-client";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Body = { uci?: string; password?: string };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const uci = (body.uci ?? "").trim();
    const password = body.password ?? "";

    if (!uci || !password) {
      throw new IrccApiError(
        "usage",
        "Both uci and password are required.",
        400,
      );
    }

    const token = await cognitoLogin(uci, password);
    const { apps } = await fetchProfileSummary(token);

    return NextResponse.json(
      { apps },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
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
