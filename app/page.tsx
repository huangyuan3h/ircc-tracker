"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "ircc-checker-session";

type SessionPayload = {
  uci: string;
  password: string;
  remember: boolean;
};

function loadRememberedUci(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { uci?: string; remember?: boolean };
    return parsed.remember ? String(parsed.uci ?? "") : "";
  } catch {
    return "";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [uci, setUci] = useState(loadRememberedUci);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetch("/api/ircc/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uci: uci.trim(), password }),
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
        password,
        remember,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      if (remember) {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ uci: payload.uci, remember: true }),
        );
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }

      router.push("/report");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <div className="login-grid fade-in">
        <section className="brand-panel">
          <p className="eyebrow">Canada · IRCC Tracker</p>
          <h1>See your file clearly, in one quiet place.</h1>
          <p className="brand-copy">
            Sign in with your Application Status Tracker UCI and password. We
            fetch your latest modules, security nodes, and letters — then render
            a readable report.
          </p>
          <ul className="feature-list">
            <li>
              <span className="dot" />
              <div>
                <strong>Auto application pick</strong>
                <div>Uses the first app from your profile summary.</div>
              </div>
            </li>
            <li>
              <span className="dot alt" />
              <div>
                <strong>Security-aware timeline</strong>
                <div>Highlights Security / Medical / letter events.</div>
              </div>
            </li>
            <li>
              <span className="dot" />
              <div>
                <strong>Personal use only</strong>
                <div>Credentials stay in this session; do not share the URL.</div>
              </div>
            </li>
          </ul>
        </section>

        <section className="form-panel">
          <h2>Sign in</h2>
          <p className="lead">UCI + Tracker password — same as the official portal.</p>

          {error ? <div className="banner error">{error}</div> : null}

          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="uci">UCI number</label>
              <input
                id="uci"
                name="uci"
                inputMode="numeric"
                autoComplete="username"
                placeholder="1139609588"
                value={uci}
                onChange={(e) => setUci(e.target.value)}
                pattern="[\d-]{5,}"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">Tracker password</label>
              <div className="password-wrap">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
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
            Hobby / personal demo. Password is sent to your own Vercel API route
            and never written into the HTML report.
          </p>
        </section>
      </div>
    </main>
  );
}
