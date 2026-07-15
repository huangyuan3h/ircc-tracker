"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cognitoLogin, IrccApiError } from "@/lib/ircc-client";
import { STORAGE_KEY, type SessionPayload } from "@/lib/session";

/** Empty = same-origin (OpenNext Worker serves /api/ircc/*). */
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");

const REMEMBER_KEY = "ircc-checker-remember-uci";

function loadRememberedUci(): string {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { uci?: string };
    return String(parsed.uci ?? "");
  } catch {
    return "";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [uci, setUci] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    const remembered = loadRememberedUci();
    if (!remembered) return;
    setUci(remembered);
    setRemember(true);
  }, []);

  const uciValid = useMemo(() => /^[\d-]{5,}$/.test(uci.trim()), [uci]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!uciValid) {
      setError("Please enter a valid UCI (digits, optional dashes).");
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }

    setLoading(true);
    try {
      const idToken = await cognitoLogin(uci.trim(), password);

      const res = await fetch(`${API_BASE}/api/ircc/list`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uci: uci.trim(), idToken }),
      });
      const data = (await res.json()) as {
        apps?: unknown[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Login failed.");
      }
      if (!data.apps || data.apps.length === 0) {
        throw new Error("No applications found on this account.");
      }

      const payload: SessionPayload = {
        uci: uci.trim(),
        idToken,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      if (remember) {
        localStorage.setItem(
          REMEMBER_KEY,
          JSON.stringify({ uci: payload.uci }),
        );
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }

      router.push("/report");
    } catch (err) {
      const message =
        err instanceof IrccApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Login failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <div className="login-stage fade-in">
        <header className="login-brand">
          <p className="login-brand-name">IRCC Tracker</p>
          <p className="login-brand-line">
            Your Application Status Tracker, rendered cleanly.
          </p>
        </header>

        <section className="login-card">
          {error ? <div className="banner error">{error}</div> : null}

          <form onSubmit={onSubmit} autoComplete="off">
            <div className="field">
              <label htmlFor="uci">UCI number</label>
              <input
                id="uci"
                name="uci"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Tracker UCI"
                value={uci}
                onChange={(e) => setUci(e.target.value)}
                pattern="[\d-]{5,}"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">Tracker password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="off"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <div className="row">
              <label>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember UCI on this device
              </label>
            </div>

            <button className="submit" type="submit" disabled={loading}>
              {loading ? "Checking Tracker…" : "Open my status"}
            </button>
          </form>

          <p className="hint">
            Same credentials as the official portal. Leave fields blank when
            sharing screenshots.
          </p>
        </section>
      </div>
    </main>
  );
}
