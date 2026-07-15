"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "ircc-checker-session";

type SessionPayload = {
  uci: string;
  password: string;
};

export default function ReportPage() {
  const router = useRouter();
  const [html, setHtml] = useState<string | null>(null);
  const [appNumber, setAppNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();

  const loadReport = useCallback(async () => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      router.replace("/");
      return;
    }

    let session: SessionPayload;
    try {
      session = JSON.parse(raw) as SessionPayload;
    } catch {
      router.replace("/");
      return;
    }

    if (!session.uci || !session.password) {
      router.replace("/");
      return;
    }

    startTransition(() => {
      setLoading(true);
      setError(null);
    });

    try {
      const res = await fetch("/api/ircc/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uci: session.uci,
          password: session.password,
        }),
      });
      const data = (await res.json()) as {
        html?: string;
        appNumber?: string;
        error?: string;
      };
      if (!res.ok || !data.html) {
        throw new Error(data.error || "Failed to load application status.");
      }
      startTransition(() => {
        setHtml(data.html ?? null);
        setAppNumber(data.appNumber ?? null);
        setError(null);
        setLoading(false);
      });
    } catch (err) {
      startTransition(() => {
        setError(err instanceof Error ? err.message : "Failed to load report.");
        setHtml(null);
        setLoading(false);
      });
    }
  }, [router, startTransition]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReport();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReport]);

  function signOut() {
    sessionStorage.removeItem(STORAGE_KEY);
    router.replace("/");
  }

  return (
    <div className="report-shell fade-in">
      <header className="toolbar">
        <div>
          <h1>IRCC Status Report</h1>
          {appNumber ? (
            <div className="text-sm text-muted">Application {appNumber}</div>
          ) : null}
        </div>
        <div className="toolbar-actions">
          <button
            className="ghost"
            type="button"
            onClick={() => void loadReport()}
          >
            Refresh
          </button>
          <button className="primary" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {loading ? (
        <div className="center-state">
          <div>
            <div className="spinner" />
            <div>Fetching your Tracker snapshot…</div>
          </div>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="center-state">
          <div>
            <div className="banner error">{error}</div>
            <button
              className="primary"
              type="button"
              onClick={() => void loadReport()}
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {!loading && !error && html ? (
        <iframe
          className="report-frame"
          title="IRCC application report"
          srcDoc={html}
        />
      ) : null}
    </div>
  );
}
