import eventsRef from "./ircc-events.json";
import type { ApplicationDetails, HistoryEvent, Relation } from "./ircc-client";

type LetterInfo = { label: string; desc?: string; url?: string; date?: string | null };
type EventRef = {
  letters: Record<string, LetterInfo>;
  system_events: Record<string, LetterInfo>;
  status_codes: Record<string, string>;
  category_colors: Record<string, string>;
};

const REF = eventsRef as EventRef;

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dateOnly(iso: unknown): string {
  if (iso == null || iso === "") return "—";
  return String(iso).split("T")[0] || "—";
}

function fullDatetime(iso: unknown): string {
  if (iso == null || iso === "") return "—";
  return String(iso).replace(/\.[0-9]+Z$/, "Z").replace(/Z$/, " UTC");
}

function statusLabel(s: unknown): string {
  const v = s == null || s === "" ? "unknown" : String(s);
  const map: Record<string, string> = {
    completed: "Completed",
    inProgress: "In progress",
    notStarted: "Not started",
    exempted: "Exempted",
    incomplete: "Incomplete",
    required: "Required",
    optional: "Optional",
    unknown: "Unknown",
  };
  return map[v] ?? v.replace(/_/g, " ");
}

function statusClass(s: unknown): string {
  const v = String(s ?? "unknown");
  if (v === "completed") return "ok";
  if (v === "inProgress" || v === "incomplete") return "warn";
  if (v === "exempted" || v === "optional") return "info";
  if (v === "required") return "danger";
  return "muted";
}

function roleLabel(role: unknown): string {
  if (role === 1) return "Principal applicant";
  if (role === 7) return "Dependent";
  if (role === 8) return "Representative";
  return `Role ${role ?? "?"}`;
}

function relationLabel(t: unknown): string {
  if (t === 2) return "Child";
  if (t === 10) return "Spouse / partner";
  if (t == null) return "";
  return `Relation ${t}`;
}

function personSortKey(r: Relation): number {
  if (r.role === 1) return 0;
  if (r.role === 7) return 1;
  if (r.role === 8) return 9;
  return 5;
}

type Interpreted = {
  category: string;
  title: string;
  body: string;
  badge: string;
  color: string;
  code?: string;
};

function interpretEvent(h: HistoryEvent): Interpreted {
  const key = String(h.key ?? "");
  const cats = REF.category_colors;
  let ev: Interpreted;

  if (key === "INITIAL") {
    ev = {
      category: "neutral",
      title: "Application received",
      body: "IRCC has logged your application in the system.",
      badge: "Initial",
      color: cats.INITIAL ?? "neutral",
    };
  } else if (key === "Medical") {
    ev = {
      category: "medical",
      title: "Medical exam",
      body: "Medical exam event. actStatus 33 = started, 108 = completed.",
      badge: key,
      color: cats.Medical ?? "medical",
    };
  } else if (key === "Security") {
    ev = {
      category: "security",
      title: "Security / background review",
      body: "actStatus 17 = comprehensive security check started.",
      badge: key,
      color: cats.Security ?? "security",
    };
  } else if (key === "Eligibility") {
    ev = {
      category: "eligibility",
      title: "Eligibility review",
      body: "Officer reviewing whether you meet the program requirements.",
      badge: key,
      color: cats.Eligibility ?? "eligibility",
    };
  } else if (key === "Biometric") {
    ev = {
      category: "biometrics",
      title: "Biometrics",
      body: "Biometrics enrollment / status update.",
      badge: key,
      color: cats.Biometric ?? "biometrics",
    };
  } else if (/^IMM/.test(key)) {
    const info = REF.letters[key] ?? {
      label: `IRCC letter ${key}`,
      desc: "Auto-generated IRCC system letter.",
    };
    ev = {
      category: "document",
      title: info.label,
      body: info.desc ?? "",
      badge: key,
      color: cats.Document ?? "document",
    };
  } else if (/^[0-9]+$/.test(key)) {
    const info = REF.system_events[key] ?? {
      label: `System event #${key}`,
      desc: "Internal system event — likely an Express Entry draw number.",
      date: null,
    };
    const body =
      info.date != null
        ? `${info.desc ?? ""}\nReference date: ${info.date}`
        : info.desc ?? "";
    ev = {
      category: "system",
      title: info.label,
      body,
      badge: key,
      color: cats.System ?? "system",
    };
  } else {
    ev = {
      category: "other",
      title: key || "Unknown",
      body: "Tracker event with no description yet.",
      badge: key || "?",
      color: "muted",
    };
  }

  if (h.actStatus != null) {
    const code =
      REF.status_codes[String(h.actStatus)] ??
      `Internal code ${h.actStatus}`;
    ev.code = code;
  }
  return ev;
}

function moduleRow(name: string, status: unknown): string {
  const s = status ?? "unknown";
  return `<div class="module"><span class="module-name">${esc(name)}</span><span class="badge ${statusClass(s)}">${esc(statusLabel(s))}</span></div>`;
}

function renderTimeline(history: HistoryEvent[]): string {
  if (!history.length) return `<p class="empty">No timeline events yet.</p>`;

  const sorted = [...history].sort((a, b) =>
    String(a.dateCreated ?? "").localeCompare(String(b.dateCreated ?? "")),
  );
  const byDay = new Map<string, HistoryEvent[]>();
  for (const ev of sorted) {
    const day = dateOnly(ev.dateCreated);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(ev);
  }

  const days = [...byDay.keys()].reverse();
  const sections = days.map((day) => {
    const items = (byDay.get(day) ?? []).reverse();
    const lis = items
      .map((h) => {
        const ev = interpretEvent(h);
        const bodyHtml = ev.body
          ? `<p class="ev-text">${esc(ev.body).replace(/\n/g, "<br />")}</p>`
          : "";
        const codeHtml = ev.code
          ? `<p class="ev-code">${esc(ev.code)}</p>`
          : "";
        return `<li class="ev-li ev-li-${esc(ev.category)}">
<div class="ev-when"><time>${esc(fullDatetime(h.dateCreated))}</time></div>
<div class="ev-body">
<span class="ev ev-${esc(ev.color)}">${esc(ev.badge)}</span>
<div class="ev-title">${esc(ev.title)}</div>
${bodyHtml}
${codeHtml}
</div>
</li>`;
      })
      .join("\n");

    return `<section class="month">
<header class="month-head">${esc(day)}</header>
<ol class="events">
${lis}
</ol>
</section>`;
  });

  return sections.join("\n");
}

function renderPerson(p: Relation, focusUci: string): string {
  const a = p.activities ?? {};
  const focus =
    focusUci && String(p.uci ?? "") === focusUci ? " person-focus" : "";
  const rel = relationLabel(p.relationType);
  const role = roleLabel(p.role);
  const ime =
    p.imeExpiry != null
      ? `<p class="meta tip">Medical (IME) expiry: <time>${esc(dateOnly(p.imeExpiry))}</time></p>`
      : "";
  const history = Array.isArray(p.history) ? p.history : [];
  const timeline =
    history.length === 0
      ? `<p class="empty">No timeline events yet.</p>`
      : `<h3>Timeline</h3>\n${renderTimeline(history)}`;

  return `<section class="person${focus}">
<header class="person-head">
<div>
<h2>${esc(p.firstName ?? "")} <span class="lastname">${esc(p.lastName ?? "")}</span></h2>
<p class="meta">${rel ? `${esc(rel)} · ` : ""}${esc(role)} · UCI <code>${esc(p.uci ?? "—")}</code></p>
</div>
${ime}
</header>
<div class="modules">
${moduleRow("Eligibility", a.eligibility)}
${moduleRow("Medical", a.medical)}
${moduleRow("Biometrics", a.biometrics)}
${moduleRow("Background", a.background)}
</div>
${timeline}
</section>`;
}

const REPORT_CSS = `
:root{
  --bg:#f4f6f5;--ink:#16302b;--muted:#5b6e68;--line:#d5e0db;--panel:#ffffff;
  --ok:#1f7a4c;--ok-bg:#e5f5ec;--warn:#9a6700;--warn-bg:#fff4d6;--info:#0b6e99;--info-bg:#e6f4fa;
  --danger:#8b2e2e;--danger-bg:#fdecec;--alert:#8b2e2e;--alert-bg:#fdecec;
  --neutral:#5b6e68;--neutral-bg:#eef1ef;--accent:#0f5c4c;
  --security:#8b2e2e;--security-bg:#fdecec;--medical:#0b6e99;--medical-bg:#e6f4fa;
  --eligibility:#5e3aa0;--eligibility-bg:#efeafa;--biometrics:#9a6700;--biometrics-bg:#fff4d6;
  --background:#0f5c4c;--background-bg:#dff1ea;--document:#1f4a78;--document-bg:#e8eff7;
  --system:#334155;--system-bg:#e9ecf1;
}
*{box-sizing:border-box}
body{margin:0;font-family:'IBM Plex Sans',sans-serif;color:var(--ink);background:
  radial-gradient(1200px 500px at 10% -10%, #d9ece4 0%, transparent 55%),
  radial-gradient(900px 400px at 100% 0%, #e7eef2 0%, transparent 50%),
  var(--bg);line-height:1.5}
.wrap{max-width:940px;margin:0 auto;padding:2.5rem 1.25rem 4rem}
h1,h2,h3{font-family:'IBM Plex Serif',serif;font-weight:600;letter-spacing:-0.02em;margin:0}
h1{font-size:clamp(1.8rem,4vw,2.4rem)}
h2{font-size:1.35rem}
h2 .lastname{color:var(--muted);font-weight:500}
h3{font-size:1.05rem;margin:1.5rem 0 0.75rem;color:var(--muted)}
.eyebrow{text-transform:uppercase;letter-spacing:0.08em;font-size:0.75rem;font-weight:600;color:var(--accent);margin:0 0 0.5rem}
.lede{color:var(--muted);margin:0.75rem 0 0;max-width:42rem}
.hero{padding-bottom:1.75rem;border-bottom:1px solid var(--line);margin-bottom:1.5rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem;margin-top:1.5rem}
.stat{padding:0.9rem 1rem;border-top:3px solid var(--accent);background:rgba(255,255,255,0.72)}
.stat span{display:block;font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em}
.stat strong{display:block;margin-top:0.25rem;font-size:1.05rem}
.alert{margin:1rem 0 1.75rem;padding:1rem 1.1rem;background:var(--alert-bg);border-left:4px solid var(--alert);color:var(--alert)}
.alert strong{display:block;margin-bottom:0.2rem}
.alert.ok{background:var(--ok-bg);border-left-color:var(--ok);color:var(--ok)}
.section-title{display:flex;align-items:center;gap:0.6rem;margin:2rem 0 0.5rem;font-family:'IBM Plex Serif',serif;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:0.08em;font-size:0.8rem}
.section-title::before{content:'';flex:0 0 6px;height:6px;border-radius:50%;background:var(--accent)}
.person{padding:1.5rem 0;border-bottom:1px solid var(--line)}
.person-focus{background:linear-gradient(90deg, rgba(15,92,76,0.06), transparent 55%);margin:0 -1.25rem;padding:1.5rem 1.25rem;border-top:1px solid var(--line)}
.person-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:0.75rem;align-items:flex-start;margin-bottom:1rem}
.meta{margin:0.35rem 0 0;color:var(--muted);font-size:0.92rem}
.tip{font-size:0.85rem}
.modules{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.6rem;margin-bottom:0.5rem}
@media (min-width:640px){.modules{grid-template-columns:repeat(4,minmax(0,1fr))}}
.module{display:flex;flex-direction:column;gap:0.45rem;padding:0.85rem 0.9rem;background:var(--panel);border:1px solid var(--line);border-radius:2px}
.module-name{font-size:0.8rem;color:var(--muted);font-weight:500}
.badge{display:inline-flex;align-items:center;width:fit-content;padding:0.2rem 0.55rem;font-size:0.8rem;font-weight:600;border-radius:999px}
.badge.ok{background:var(--ok-bg);color:var(--ok)}
.badge.warn{background:var(--warn-bg);color:var(--warn)}
.badge.info{background:var(--info-bg);color:var(--info)}
.badge.muted{background:var(--neutral-bg);color:var(--muted)}
.badge.danger{background:var(--danger-bg);color:var(--danger)}
.representative{background:rgba(15,92,76,0.04);border-radius:6px;padding:1.25rem 1.5rem;margin-top:1rem;border:1px dashed var(--line)}
.representative .person{padding:0;border-bottom:none}
.representative .person-focus{background:none;margin:0;padding:0;border-top:none}
.month-head{font-size:0.78rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.6rem}
.events{list-style:none;margin:0;padding:0 0 0 0.75rem;display:flex;flex-direction:column;gap:0.65rem;position:relative}
.events::before{content:'';position:absolute;left:-1.45rem;top:0;bottom:0;width:1px;background:var(--line)}
.ev-li{position:relative;display:grid;grid-template-columns:9rem 1fr;gap:0.85rem;align-items:start}
.ev-li::before{content:'';position:absolute;left:-1.6rem;top:0.45rem;width:9px;height:9px;border-radius:50%;background:var(--line);border:2px solid var(--bg)}
.ev-li-security::before{background:var(--security)}
.ev-li-medical::before{background:var(--medical)}
.ev-li-eligibility::before{background:var(--eligibility)}
.ev-li-biometrics::before{background:var(--biometrics)}
.ev-li-background::before{background:var(--background)}
.ev-li-document::before{background:var(--document)}
.ev-li-system::before{background:var(--system)}
.ev-when time{font-variant-numeric:tabular-nums;color:var(--muted);font-size:0.82rem;display:block;padding-top:0.18rem}
.ev-body{background:var(--panel);border:1px solid var(--line);padding:0.55rem 0.8rem;border-radius:2px}
.ev-li-security .ev-body{border-color:#e3b4b4;background:#fff8f8}
.ev-title{font-weight:600;font-size:0.98rem;margin:0.35rem 0 0.15rem}
.ev-text{margin:0.2rem 0 0;color:var(--muted);font-size:0.88rem}
.ev-code{margin:0.3rem 0 0;font-size:0.78rem;color:var(--muted);font-style:italic}
.ev{display:inline-flex;align-items:center;padding:0.1rem 0.55rem;font-size:0.72rem;font-weight:700;border-radius:999px;text-transform:uppercase;letter-spacing:0.04em;color:#fff}
.ev-security{background:var(--security)}
.ev-medical{background:var(--medical)}
.ev-eligibility{background:var(--eligibility)}
.ev-biometrics{background:var(--biometrics)}
.ev-background{background:var(--background)}
.ev-document{background:var(--document)}
.ev-system{background:var(--system)}
.ev-neutral{background:var(--neutral)}
.empty{color:var(--muted)}
footer{margin-top:2rem;color:var(--muted);font-size:0.85rem}
.legend{margin-top:0.5rem;display:flex;flex-wrap:wrap;gap:0.5rem 1rem;font-size:0.78rem;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:0.35rem}
.legend i{width:9px;height:9px;border-radius:50%;display:inline-block}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.85em;background:var(--neutral-bg);padding:0.05em 0.35em;border-radius:2px}
`.trim();

export type RenderOptions = {
  generatedAt?: string;
  focusUci?: string;
};

export function renderApplicationHtml(
  details: ApplicationDetails,
  options: RenderOptions = {},
): string {
  const app = (details.app ?? {}) as Record<string, unknown>;
  const relations = Array.isArray(details.relations) ? details.relations : [];
  const focusUci = options.focusUci ?? "";
  const generatedAt =
    options.generatedAt ??
    new Date().toISOString().replace("T", " ").slice(0, 19);

  const hasSecurity = relations.some((r) =>
    (r.history ?? []).some((h) => h.key === "Security"),
  );

  const primary = relations.find((r) => r.role === 1);
  const secRaw =
    (primary?.history ?? []).find((h) => h.key === "Security")?.dateCreated ??
    relations
      .flatMap((r) => r.history ?? [])
      .find((h) => h.key === "Security")?.dateCreated ??
    null;
  const secDate = dateOnly(secRaw);

  const people = [...relations].sort(
    (a, b) => personSortKey(a) - personSortKey(b),
  );
  const applicants = people.filter((r) => r.role !== 8);
  const reps = people.filter((r) => r.role === 8);

  const alert = hasSecurity
    ? `<div class="alert" role="status"><strong>Security review detected</strong>At least one Security history node exists (earliest/principal: ${esc(secDate)}). Background module is typically still in progress while this runs.</div>`
    : `<div class="alert ok" role="status"><strong>No Security node detected</strong>No Security history entries were found on this application snapshot.</div>`;

  const repsHtml =
    reps.length > 0
      ? `<div class="section-title">Representatives</div>
<div class="representative">
${reps.map((r) => renderPerson(r, focusUci)).join("\n")}
</div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>IRCC Status · ${esc(app.appNumber ?? "Report")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@500;600&display=swap" rel="stylesheet" />
<style>
${REPORT_CSS}
</style>
</head>
<body>
<main class="wrap">
<header class="hero">
<p class="eyebrow">IRCC Application Status</p>
<h1>${esc(app.firstName ?? "")} <span class="lastname">${esc(app.lastName ?? "")}</span></h1>
<p class="lede">Application <strong>${esc(app.appNumber ?? "—")}</strong>
 · Type <strong>${esc(app.lob ?? "—")}</strong>
 · Overall <span class="badge ${statusClass(app.status)}">${esc(statusLabel(app.status))}</span></p>
<div class="stats">
<div class="stat"><span>Received</span><strong>${esc(dateOnly(app.dateRecieved))}</strong></div>
<div class="stat"><span>Last updated</span><strong>${esc(dateOnly(app.lastUpdated))}</strong></div>
<div class="stat"><span>Security</span><strong>${esc(hasSecurity ? secDate : "Not detected")}</strong></div>
<div class="stat"><span>People</span><strong>${relations.length}</strong></div>
</div>
${alert}
<div class="legend">
<span><i style="background:var(--security)"></i>Security</span>
<span><i style="background:var(--medical)"></i>Medical</span>
<span><i style="background:var(--eligibility)"></i>Eligibility</span>
<span><i style="background:var(--biometrics)"></i>Biometrics</span>
<span><i style="background:var(--background)"></i>Background</span>
<span><i style="background:var(--document)"></i>IRCC letter</span>
<span><i style="background:var(--system)"></i>System event</span>
</div>
</header>
${applicants.map((r) => renderPerson(r, focusUci)).join("\n")}
${repsHtml}
<footer>Generated ${esc(generatedAt)} by ircc-check. Local report only — do not share publicly.</footer>
</main>
</body>
</html>`;
}
