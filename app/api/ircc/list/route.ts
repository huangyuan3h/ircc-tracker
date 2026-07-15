import { NextResponse } from "next/server";
import {
  IrccApiError,
  fetchProfileSummary,
  resolveIdToken,
} from "@/lib/ircc-client";

export const dynamic = "force-dynamic";

type Body = {
  uci?: string;
  password?: string;
  idToken?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const uci = (body.uci ?? "").trim();

    if (!uci) {
      throw new IrccApiError("usage", "uci is required.", 400);
    }

    const token = await resolveIdToken({
      idToken: body.idToken,
      uci,
      password: body.password,
    });
    const { apps } = await fetchProfileSummary(token);

    return NextResponse.json(
      { apps },
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
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("list route failed", message, stack);
    return NextResponse.json(
      { error: `Unexpected server error: ${message}`, code: "query" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
