import {
  IrccApiError,
  fetchApplicationDetails,
  fetchProfileSummary,
  pickDefaultAppNumber,
  resolveIdToken,
} from "./ircc-client.js";
import { renderApplicationHtml } from "./render-report.js";

export interface Env {
  /** Comma-separated allow-list of origins for CORS. Use "*" to allow any. */
  ALLOWED_ORIGINS?: string;
}

type Body = {
  uci?: string;
  password?: string;
  idToken?: string;
  appNumber?: string;
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function errorResponse(err: unknown): Response {
  if (err instanceof IrccApiError) {
    return jsonResponse(
      { error: err.message, code: err.code },
      { status: err.status },
    );
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error("worker unexpected", err);
  return jsonResponse(
    { error: `Unexpected server error: ${message}`, code: "query" },
    { status: 500 },
  );
}

function allowedOrigins(req: Request, env: Env): string[] {
  const list = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0 || list.includes("*")) return ["*"];
  const origin = req.headers.get("origin");
  if (origin && list.includes(origin)) return [origin];
  return [];
}

function withCors(req: Request, env: Env, base: ResponseInit = {}): Response {
  const headers = new Headers(base.headers);
  const origins = allowedOrigins(req, env);
  if (origins.length === 1 && origins[0] !== "*") {
    headers.set("access-control-allow-origin", origins[0]);
    headers.set("vary", "Origin");
  } else if (origins[0] === "*") {
    headers.set("access-control-allow-origin", "*");
  }
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "content-type, authorization",
  );
  headers.set("access-control-max-age", "86400");
  return new Response(null, { ...base, headers });
}

async function handleList(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return withCors(req, env, { status: 204 });
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }
  try {
    const body = (await req.json()) as Body;
    const uci = (body.uci ?? "").trim();
    if (!uci) throw new IrccApiError("usage", "uci is required.", 400);

    const token = await resolveIdToken({
      idToken: body.idToken,
      uci,
      password: body.password,
    });
    const { apps } = await fetchProfileSummary(token);
    return jsonResponse({ apps });
  } catch (err) {
    return errorResponse(err);
  }
}

async function handleCheck(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return withCors(req, env, { status: 204 });
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }
  try {
    const body = (await req.json()) as Body;
    const uci = (body.uci ?? "").trim();
    let appNumber = (body.appNumber ?? "").trim();
    if (!uci) throw new IrccApiError("usage", "uci is required.", 400);

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
    const html = renderApplicationHtml(details, {
      focusUci: uci,
      generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    });
    return jsonResponse({ appNumber, html });
  } catch (err) {
    return errorResponse(err);
  }
}

function handleHealth(): Response {
  return jsonResponse({ ok: true, ts: Date.now() });
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return withCors(req, env, { status: 204 });
    }

    if (url.pathname === "/healthz") return handleHealth();

    if (url.pathname === "/api/ircc/list") {
      const res = await handleList(req, env);
      // attach CORS headers to non-OPTIONS responses too
      const headers = new Headers(res.headers);
      const origins = allowedOrigins(req, env);
      if (origins.length === 1 && origins[0] !== "*") {
        headers.set("access-control-allow-origin", origins[0]);
        headers.set("vary", "Origin");
      } else if (origins[0] === "*") {
        headers.set("access-control-allow-origin", "*");
      }
      return new Response(res.body, { status: res.status, headers });
    }

    if (url.pathname === "/api/ircc/check") {
      const res = await handleCheck(req, env);
      const headers = new Headers(res.headers);
      const origins = allowedOrigins(req, env);
      if (origins.length === 1 && origins[0] !== "*") {
        headers.set("access-control-allow-origin", origins[0]);
        headers.set("vary", "Origin");
      } else if (origins[0] === "*") {
        headers.set("access-control-allow-origin", "*");
      }
      return new Response(res.body, { status: res.status, headers });
    }

    return jsonResponse({ error: "Not found" }, { status: 404 });
  },
};