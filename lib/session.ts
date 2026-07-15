export const STORAGE_KEY = "ircc-checker-session";

export type SessionApp = {
  appNum: string;
  appType: string | null;
  status: string | null;
  lastUpdated: string | null;
  paFirstName: string | null;
  paLastName: string | null;
  role: number | null;
};

export type SessionPayload = {
  uci: string;
  /** Cognito IdToken — prefer this over password when calling the API. */
  idToken: string;
  /** Last retrieved applications list, so the report can offer a switcher. */
  apps?: SessionApp[];
};
