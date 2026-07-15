"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { STORAGE_KEY, type SessionApp, type SessionPayload } from "@/lib/session";
import type {
  ModuleStatus,
  OverallView,
  PersonView,
} from "@/lib/render-report";
import { statusShortLabel } from "@/lib/render-report";

/** Empty = same-origin (OpenNext Worker serves /api/ircc/*). */
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; report: OverallView; appNumber: string; apps: SessionApp[] };

export default function ReportPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const activeAppNumberRef = useRef<string | null>(null);
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

    if (!session.uci || !session.idToken) {
      sessionStorage.removeItem(STORAGE_KEY);
      router.replace("/");
      return;
    }

    startTransition(() => {
      setState({ kind: "loading" });
    });

    const requested = activeAppNumberRef.current ?? undefined;
    try {
      const res = await fetch(`${API_BASE}/api/ircc/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uci: session.uci,
          idToken: session.idToken,
          appNumber: requested,
        }),
      });
      const data = (await res.json()) as {
        report?: OverallView;
        appNumber?: string;
        apps?: SessionApp[];
        error?: string;
      };
      if (!res.ok || !data.report) {
        throw new Error(data.error || "Failed to load application status.");
      }
      startTransition(() => {
        const apps = data.apps ?? session.apps ?? [];
        setState({
          kind: "ready",
          report: data.report as OverallView,
          appNumber: data.appNumber ?? "—",
          apps,
        });
        setActiveId(defaultActiveId(data.report as OverallView, session.uci));
      });
    } catch (err) {
      startTransition(() => {
        setState({
          kind: "error",
          message:
            err instanceof Error ? err.message : "Failed to load report.",
        });
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
        <div className="toolbar-brand">
          <span className="toolbar-mark" aria-hidden />
          <div>
            <h1>IRCC Status Report</h1>
            <div className="text-sm text-muted">
              {state.kind === "ready"
                ? `Application ${state.appNumber}`
                : "Loading your file…"}
            </div>
          </div>
        </div>
        {state.kind === "ready" && state.apps.length > 1 ? (
          <AppSwitcher
            apps={state.apps}
            value={state.appNumber}
            onChange={(next) => {
              activeAppNumberRef.current = next;
              setSelectedApp(next);
              void loadReport();
            }}
          />
        ) : null}
        <div className="toolbar-actions">
          <button
            className="ghost"
            type="button"
            onClick={() => void loadReport()}
            disabled={state.kind === "loading"}
          >
            {state.kind === "loading" ? "Refreshing…" : "Refresh"}
          </button>
          <button className="primary" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {state.kind === "loading" ? (
        <div className="center-state">
          <div>
            <div className="spinner" />
            <div>Fetching your Tracker snapshot…</div>
          </div>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div className="center-state">
          <div className="error-card">
            <h2>Couldn’t load your report</h2>
            <div className="banner error">{state.message}</div>
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

      {state.kind === "ready" ? (
        <ReadyView
          report={state.report}
          activeId={activeId}
          onTabChange={setActiveId}
        />
      ) : null}
    </div>
  );
}

function defaultActiveId(report: OverallView, focusUci: string): string {
  if (report.people.some((p) => p.isFocus)) {
    return `person-${report.people.find((p) => p.isFocus)?.id ?? ""}`;
  }
  if (report.people.length > 0) return `person-${report.people[0].id}`;
  return "overall";
}

function ReadyView({
  report,
  activeId,
  onTabChange,
}: {
  report: OverallView;
  activeId: string | null;
  onTabChange: (id: string) => void;
}) {
  const tabs = useMemo(() => {
    const t: { id: string; label: string; badge?: string }[] = [
      { id: "overall", label: "Overall" },
    ];
    report.people.forEach((p) =>
      t.push({
        id: `person-${p.id}`,
        label: p.fullName,
        badge:
          p.role === 1 ? "PA" : p.role === 7 ? "Dep" : undefined,
      }),
    );
    report.representatives.forEach((p) =>
      t.push({
        id: `person-${p.id}`,
        label: p.fullName,
        badge: "Rep",
      }),
    );
    return t;
  }, [report]);

  const current = activeId ?? tabs[0]?.id ?? "overall";
  const activePerson =
    current === "overall"
      ? null
      : report.people.find((p) => `person-${p.id}` === current) ??
        report.representatives.find((p) => `person-${p.id}` === current) ??
        null;

  return (
    <main className="report-main">
      <OverallCard report={report} />

      <div className="tabs" role="tablist" aria-label="Application people">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={current === t.id}
            type="button"
            className={`tab ${current === t.id ? "tab-active" : ""}`}
            onClick={() => onTabChange(t.id)}
          >
            <span>{t.label}</span>
            {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      <section className="tab-panel" role="tabpanel">
        {current === "overall" ? (
          <OverallPanel report={report} />
        ) : activePerson ? (
          <PersonPanel person={activePerson} />
        ) : (
          <p className="empty">No data for this tab.</p>
        )}
      </section>

      <footer className="report-footer">
        Generated {report.generatedAt} · Local snapshot, not affiliated with
        IRCC.
      </footer>
    </main>
  );
}

function OverallCard({ report }: { report: OverallView }) {
  return (
    <header className="overall-card">
      <div className="overall-headline">
        <p className="eyebrow">IRCC Application Status</p>
        <h2>
          {report.appNumber}{" "}
          <span className="overall-sub">· {report.appType || "—"}</span>
        </h2>
        <div className="overall-badges">
          <span className={`status-pill status-${report.statusClass}`}>
            Overall {report.statusLabel}
          </span>
          {report.hasSecurity ? (
            <span className="status-pill status-danger">
              Security review {report.securityDate ? `· ${report.securityDate}` : "active"}
            </span>
          ) : (
            <span className="status-pill status-ok">No security node</span>
          )}
        </div>
      </div>
      <dl className="overall-stats">
        <div>
          <dt>Received</dt>
          <dd>{report.receivedOn ?? "—"}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>{report.lastUpdated ?? "—"}</dd>
        </div>
        <div>
          <dt>People</dt>
          <dd>{report.people.length}</dd>
        </div>
        <div>
          <dt>Representatives</dt>
          <dd>{report.representatives.length}</dd>
        </div>
      </dl>
    </header>
  );
}

function OverallPanel({ report }: { report: OverallView }) {
  const recentEvents = report.people
    .flatMap((p) =>
      p.events.map((e) => ({ person: p, event: e })),
    )
    .sort((a, b) => b.event.date.localeCompare(a.event.date))
    .slice(0, 8);

  return (
    <div className="panel-stack">
      <article className="panel">
        <h3>Applicants</h3>
        <ul className="people-list">
          {report.people.map((p) => (
            <li
              key={p.id}
              className={`person-row ${p.isFocus ? "person-focus" : ""}`}
            >
              <div className="person-row-top">
                <div className="avatar" aria-hidden>
                  {p.initials}
                </div>
                <div className="person-row-body">
                  <div className="person-row-name">{p.fullName}</div>
                  <div className="person-row-meta">
                    {p.roleLabel}
                    {p.uci ? <> · UCI <code>{p.uci}</code></> : null}
                    {p.relation ? <> · {p.relation}</> : null}
                  </div>
                </div>
              </div>
              <div className="modules-strip" role="list">
                {p.modules.map((m) => (
                  <ModuleCard key={m.key} m={m} />
                ))}
              </div>
            </li>
          ))}
          {report.people.length === 0 ? (
            <li className="empty">No applicants on this file.</li>
          ) : null}
        </ul>
      </article>

      <div className="panel-grid">
        <article className="panel">
          <h3>Latest events</h3>
          {recentEvents.length === 0 ? (
            <p className="empty">No timeline events yet.</p>
          ) : (
            <ul className="event-list">
              {recentEvents.map(({ person, event }) => (
                <li
                  key={`${person.id}-${event.id}`}
                  className={`event-row event-${event.color}`}
                >
                  <span className={`ev-badge ev-${event.color}`}>
                    {event.badge}
                  </span>
                  <div className="event-body">
                    <div className="event-title">{event.title}</div>
                    <div className="event-meta">
                      {person.fullName} · {event.date}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        {report.representatives.length > 0 ? (
          <article className="panel">
            <h3>Representatives</h3>
            <ul className="people-list">
              {report.representatives.map((p) => (
                <li key={p.id} className="person-row">
                  <div className="person-row-top">
                    <div className="avatar avatar-rep" aria-hidden>
                      {p.initials}
                    </div>
                    <div className="person-row-body">
                      <div className="person-row-name">{p.fullName}</div>
                      <div className="person-row-meta">
                        {p.roleLabel}
                        {p.uci ? <> · UCI <code>{p.uci}</code></> : null}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ) : null}
      </div>
    </div>
  );
}

function PersonPanel({ person }: { person: PersonView }) {
  return (
    <div className="panel-stack">
      <article className="panel">
        <header className="person-header">
          <div className="avatar avatar-lg" aria-hidden>
            {person.initials}
          </div>
          <div className="person-header-body">
            <h3 className="person-name">{person.fullName}</h3>
            <div className="person-meta">
              {person.roleLabel}
              {person.relation ? <> · {person.relation}</> : null}
              {person.uci ? <> · UCI <code>{person.uci}</code></> : null}
            </div>
            {person.imeExpiry ? (
              <div className="person-tip">
                Medical (IME) expiry: <strong>{person.imeExpiry}</strong>
              </div>
            ) : null}
          </div>
        </header>
        <div className="modules-strip" role="list">
          {person.modules.map((m) => (
            <ModuleCard key={m.key} m={m} />
          ))}
        </div>
      </article>

      <article className="panel">
        <h3>Timeline</h3>
        {person.events.length === 0 ? (
          <p className="empty">No timeline events yet.</p>
        ) : (
          <ol className="timeline">
            {[...person.events]
              .sort((a, b) => b.date.localeCompare(a.date) || b.whenLabel.localeCompare(a.whenLabel))
              .map((ev) => (
                <li
                  key={ev.id}
                  className={`timeline-item timeline-${ev.color}`}
                >
                  <span className="timeline-rail" aria-hidden>
                    <span className="timeline-dot" />
                  </span>
                  <article className="timeline-card">
                    <div className="timeline-card-head">
                      <time className="timeline-date" dateTime={ev.date}>
                        {ev.date || "—"}
                        {ev.whenLabel ? (
                          <span className="timeline-time"> · {ev.whenLabel}</span>
                        ) : null}
                      </time>
                      <div className="timeline-meta">
                        <span className="ev-badge">{ev.badge}</span>
                        {ev.code ? (
                          <span className="timeline-code">{ev.code}</span>
                        ) : null}
                      </div>
                    </div>
                    <h4 className="timeline-title">{ev.title}</h4>
                    {ev.body ? (
                      <div className="timeline-body">
                        {ev.body.split("\n").map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                </li>
              ))}
          </ol>
        )}
      </article>
    </div>
  );
}

function ModuleCard({ m }: { m: ModuleStatus }) {
  const short = statusShortLabel(m.status);
  return (
    <div
      className={`module-cell module-${m.statusClass}`}
      role="listitem"
      title={`${m.label}: ${m.statusLabel}`}
    >
      <span className="module-cell-label">{m.label}</span>
      <span className="module-cell-value">{short}</span>
    </div>
  );
}

function formatAppLabel(a: SessionApp): string {
  const pa = [a.paFirstName, a.paLastName].filter(Boolean).join(" ").trim();
  const type = a.appType ? ` · ${a.appType}` : "";
  const status = a.status ? ` (${a.status})` : "";
  return `${a.appNum}${type}${status}${pa ? ` — ${pa}` : ""}`;
}

function AppSwitcher({
  apps,
  value,
  onChange,
}: {
  apps: SessionApp[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="app-switcher" title="Switch application">
      <span className="app-switcher-label">Application</span>
      <select
        className="app-switcher-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {apps.map((a) => (
          <option key={a.appNum} value={a.appNum}>
            {formatAppLabel(a)}
          </option>
        ))}
      </select>
    </label>
  );
}