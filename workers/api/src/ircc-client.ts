// Shared IRCC client used by both Next.js (browser/server) and the Cloudflare Worker.
// Kept dependency-free so it can run on the Workers runtime with nodejs_compat.

export const COGNITO_URL =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.COGNITO_URL ??
  "https://cognito-idp.ca-central-1.amazonaws.com/";
export const COGNITO_CLIENT_ID =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.COGNITO_CLIENT_ID ??
  "3cfutv5ffd1i622g1tn6vton5r";
export const IRCC_API_URL =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.IRCC_API_URL ??
  "https://api.ircc-tracker-suivi.apps.cic.gc.ca/user";

/** Mimic the official Tracker SPA so Cognito WAF does not block datacenter egress. */
export const PORTAL_ORIGIN = "https://ircc-tracker-suivi.apps.cic.gc.ca";
export const PORTAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type ApiErrorCode =
  | "auth"
  | "query"
  | "parse"
  | "config"
  | "usage"
  | "waf";

export class IrccApiError extends Error {
  code: ApiErrorCode;
  status: number;

  constructor(code: ApiErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "IrccApiError";
  }
}

type CognitoErrorBody = {
  __type?: string;
  message?: string;
};

function authFailureMessage(status: number, json: unknown): {
  code: ApiErrorCode;
  message: string;
  httpStatus: number;
} {
  const body = (json ?? {}) as CognitoErrorBody;
  const type = body.__type ?? "";
  const msg = body.message ?? "";

  if (
    status === 403 ||
    /WAF/i.test(msg) ||
    /ForbiddenException/i.test(type) ||
    /Request not allowed/i.test(msg)
  ) {
    return {
      code: "waf",
      message:
        "IRCC Cognito blocked this request (WAF). Try again from your own network, or refresh if the block was temporary.",
      httpStatus: 403,
    };
  }

  if (/NotAuthorizedException/i.test(type) || /Incorrect/i.test(msg)) {
    return {
      code: "auth",
      message: "Login failed. Check UCI or Tracker password.",
      httpStatus: 401,
    };
  }

  return {
    code: "auth",
    message: "Login failed. Check UCI / password or Cognito availability.",
    httpStatus: status >= 400 ? status : 401,
  };
}

export type TrackerAppSummary = {
  appNum: string;
  appType: string | null;
  status: string | null;
  lastUpdated: string | null;
  paFirstName: string | null;
  paLastName: string | null;
  role: number | null;
};

export type ApplicationDetails = {
  app?: Record<string, unknown>;
  relations?: Relation[];
  [key: string]: unknown;
};

export type Relation = {
  uci?: string | null;
  role?: number | null;
  relationType?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  imeExpiry?: string | null;
  activities?: {
    eligibility?: string | null;
    medical?: string | null;
    biometrics?: string | null;
    background?: string | null;
  };
  history?: HistoryEvent[];
  [key: string]: unknown;
};

export type HistoryEvent = {
  key?: string | null;
  dateCreated?: string | null;
  dateLoaded?: string | null;
  actStatus?: number | null;
  actType?: number | null;
};

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    throw new IrccApiError(
      "query",
      `Network error reaching upstream (${(err as Error)?.message ?? "unknown"}).`,
      502,
    );
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new IrccApiError(
      "parse",
      "Upstream returned non-JSON response.",
      502,
    );
  }
  return { status: res.status, json };
}

export async function cognitoLogin(
  username: string,
  password: string,
): Promise<string> {
  const { status, json } = await postJson(
    COGNITO_URL,
    {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth",
      "user-agent": PORTAL_UA,
      origin: PORTAL_ORIGIN,
      referer: `${PORTAL_ORIGIN}/`,
    },
    {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
      ClientMetadata: {},
    },
  );

  if (status !== 200) {
    const failure = authFailureMessage(status, json);
    throw new IrccApiError(failure.code, failure.message, failure.httpStatus);
  }

  const token = (json as { AuthenticationResult?: { IdToken?: string } })
    ?.AuthenticationResult?.IdToken;
  if (!token) {
    throw new IrccApiError(
      "auth",
      "Login failed: IdToken missing in Cognito response.",
      401,
    );
  }
  return token;
}

export async function resolveIdToken(opts: {
  idToken?: string;
  uci?: string;
  password?: string;
}): Promise<string> {
  const existing = (opts.idToken ?? "").trim();
  if (existing) return existing;

  const uci = (opts.uci ?? "").trim();
  const password = opts.password ?? "";
  if (!uci || !password) {
    throw new IrccApiError(
      "usage",
      "Provide idToken, or both uci and password.",
      400,
    );
  }
  return cognitoLogin(uci, password);
}

export async function fetchProfileSummary(
  token: string,
): Promise<{ apps: TrackerAppSummary[] }> {
  const { status, json } = await postJson(
    IRCC_API_URL,
    {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": PORTAL_UA,
      origin: PORTAL_ORIGIN,
      referer: `${PORTAL_ORIGIN}/`,
    },
    { method: "get-profile-summary" },
  );

  if (status !== 200 || !json || typeof json !== "object") {
    throw new IrccApiError(
      "query",
      "Profile summary query failed.",
      status >= 400 ? status : 502,
    );
  }

  const appsRaw = (json as { apps?: unknown[] }).apps ?? [];
  const apps: TrackerAppSummary[] = appsRaw.map((item) => {
    const a = (item ?? {}) as Record<string, unknown>;
    return {
      appNum: String(a.appNum ?? ""),
      appType: a.appType == null ? null : String(a.appType),
      status: a.status == null ? null : String(a.status),
      lastUpdated: a.lastUpdated == null ? null : String(a.lastUpdated),
      paFirstName: a.paFirstName == null ? null : String(a.paFirstName),
      paLastName: a.paLastName == null ? null : String(a.paLastName),
      role: typeof a.role === "number" ? a.role : null,
    };
  });

  return { apps };
}

export async function fetchApplicationDetails(
  token: string,
  applicationNumber: string,
  uci: string,
): Promise<ApplicationDetails> {
  const { status, json } = await postJson(
    IRCC_API_URL,
    {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": PORTAL_UA,
      origin: PORTAL_ORIGIN,
      referer: `${PORTAL_ORIGIN}/`,
    },
    {
      method: "get-application-details",
      applicationNumber,
      uci,
      isAgent: false,
    },
  );

  if (status !== 200 || !json || typeof json !== "object") {
    throw new IrccApiError(
      "query",
      "Application details query failed.",
      status >= 400 ? status : 502,
    );
  }

  return json as ApplicationDetails;
}

export function pickDefaultAppNumber(apps: TrackerAppSummary[]): string {
  const first = apps.find((a) => a.appNum)?.appNum;
  if (!first) {
    throw new IrccApiError(
      "config",
      "No applications found on this Tracker account.",
      404,
    );
  }
  return first;
}