export const STORAGE_KEY = "ircc-checker-session";

export type SessionPayload = {
  uci: string;
  /** Cognito IdToken — prefer this over password when calling the API. */
  idToken: string;
};
