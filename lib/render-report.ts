import eventsRef from "./ircc-events.json";
import type {
  ApplicationDetails,
  HistoryEvent,
  Relation,
} from "./ircc-client";

// ----- Reference data (hand-curated labels for IRCC codes / letters) -----

type LetterInfo = {
  label: string;
  desc?: string;
  url?: string;
  date?: string | null;
};

type EventRef = {
  letters: Record<string, LetterInfo>;
  system_events: Record<string, LetterInfo>;
  status_codes: Record<string, string>;
  category_colors: Record<string, string>;
};

const REF = eventsRef as EventRef;

// ----- Public types for the UI -----

export type ModuleKey = "eligibility" | "medical" | "biometrics" | "background";

export const MODULES: { key: ModuleKey; label: string }[] = [
  { key: "eligibility", label: "Eligibility" },
  { key: "medical", label: "Medical" },
  { key: "biometrics", label: "Biometrics" },
  { key: "background", label: "Background" },
];

export type ModuleStatus = {
  key: ModuleKey;
  label: string;
  status: string;
  statusLabel: string;
  statusClass: "ok" | "warn" | "info" | "danger" | "muted";
};

export type InterpretedEvent = {
  id: string;
  date: string; // yyyy-mm-dd or full ISO
  whenLabel: string;
  category:
    | "security"
    | "medical"
    | "eligibility"
    | "biometrics"
    | "background"
    | "document"
    | "system"
    | "neutral"
    | "other";
  color: string;
  badge: string;
  title: string;
  body?: string;
  code?: string;
};

export type PersonView = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  initials: string;
  uci?: string;
  role: number | null;
  roleLabel: string;
  relation?: string;
  isRepresentative: boolean;
  isFocus: boolean;
  imeExpiry?: string;
  modules: ModuleStatus[];
  events: InterpretedEvent[];
  firstSecurity?: string;
};

export type OverallView = {
  appNumber: string;
  appType: string;
  status: string;
  statusLabel: string;
  statusClass: ModuleStatus["statusClass"];
  receivedOn?: string;
  lastUpdated?: string;
  hasSecurity: boolean;
  securityDate?: string;
  people: PersonView[];
  representatives: PersonView[];
  generatedAt: string;
};

export type RenderOptions = {
  focusUci?: string;
  generatedAt?: string;
};

// ----- Helpers -----

function esc(value: unknown): string {
  return String(value ?? "");
}

function dateOnly(iso: unknown): string {
  if (iso == null || iso === "") return "";
  return String(iso).split("T")[0] || "";
}

/** Short clock for timeline rows (day is already in the section header). */
function shortTime(iso: unknown): string {
  if (iso == null || iso === "") return "";
  const s = String(iso);
  const m = s.match(/T(\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}`;
  return s.slice(0, 16);
}

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  inProgress: "In progress",
  notStarted: "Not started",
  exempted: "Exempted",
  incomplete: "Incomplete",
  required: "Required",
  optional: "Optional",
  unknown: "Unknown",
};

/** Compact labels for narrow module cells (never wrap). */
const STATUS_SHORT: Record<string, string> = {
  completed: "Done",
  inProgress: "Active",
  notStarted: "Idle",
  exempted: "Exempt",
  incomplete: "Partial",
  required: "Required",
  optional: "Optional",
  unknown: "—",
};

function statusLabel(s: unknown): string {
  const v = s == null || s === "" ? "unknown" : String(s);
  return STATUS_LABELS[v] ?? v.replace(/_/g, " ");
}

export function statusShortLabel(s: unknown): string {
  const v = s == null || s === "" ? "unknown" : String(s);
  return STATUS_SHORT[v] ?? statusLabel(s);
}

function statusClass(s: unknown): ModuleStatus["statusClass"] {
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
  return role == null ? "Applicant" : `Role ${role}`;
}

function relationLabel(t: unknown): string {
  if (t === 2) return "Child";
  if (t === 10) return "Spouse / partner";
  if (t === 11) return "Parent";
  if (t == null) return "";
  return `Relation ${t}`;
}

function initialsOf(first?: string, last?: string): string {
  const f = (first ?? "").trim().charAt(0).toUpperCase();
  const l = (last ?? "").trim().charAt(0).toUpperCase();
  return `${f}${l}` || "·";
}

function personSortKey(r: Relation): number {
  if (r.role === 1) return 0;
  if (r.role === 7) return 1;
  if (r.role === 8) return 9;
  return 5;
}

// ----- Event interpretation -----

function interpretEvent(h: HistoryEvent): Omit<InterpretedEvent, "id" | "date" | "whenLabel"> {
  const key = String(h.key ?? "");
  const cats = REF.category_colors;
  let category: InterpretedEvent["category"];
  let title: string;
  let body: string | undefined;
  let badge: string;
  let color: string;

  if (key === "INITIAL") {
    category = "neutral";
    title = "Application received";
    body = "IRCC has logged your application in the system.";
    badge = "Initial";
    color = cats.INITIAL ?? "neutral";
  } else if (key === "Medical") {
    category = "medical";
    title = "Medical exam";
    body = "Medical exam event. actStatus 33 = started, 108 = completed.";
    badge = key;
    color = cats.Medical ?? "medical";
  } else if (key === "Security") {
    category = "security";
    title = "Security / background review";
    body = "actStatus 17 = comprehensive security check started.";
    badge = key;
    color = cats.Security ?? "security";
  } else if (key === "Eligibility") {
    category = "eligibility";
    title = "Eligibility review";
    body = "Officer reviewing whether you meet the program requirements.";
    badge = key;
    color = cats.Eligibility ?? "eligibility";
  } else if (key === "Biometric") {
    category = "biometrics";
    title = "Biometrics";
    body = "Biometrics enrollment / status update.";
    badge = key;
    color = cats.Biometric ?? "biometrics";
  } else if (/^IMM/.test(key)) {
    const info = REF.letters[key] ?? {
      label: `IRCC letter ${key}`,
      desc: "Auto-generated IRCC system letter.",
    };
    category = "document";
    title = info.label;
    body = info.desc ?? "";
    badge = key;
    color = cats.Document ?? "document";
  } else if (/^[0-9]+$/.test(key)) {
    const info = REF.system_events[key] ?? {
      label: `System event #${key}`,
      desc: "Internal system event — likely an Express Entry draw number.",
      date: null,
    };
    const descParts: string[] = [];
    if (info.desc) descParts.push(info.desc);
    if (info.date) descParts.push(`Reference date: ${info.date}`);
    body = descParts.length ? descParts.join("\n") : undefined;
    category = "system";
    title = info.label;
    badge = key;
    color = cats.System ?? "system";
  } else {
    category = "other";
    title = key || "Unknown";
    body = "Tracker event with no description yet.";
    badge = key || "?";
    color = "muted";
  }

  let code: string | undefined;
  if (h.actStatus != null) {
    code =
      REF.status_codes[String(h.actStatus)] ?? `Internal code ${h.actStatus}`;
    // Fold status detail into body so the card header keeps a single primary badge.
    body = body ? `${body}\n${code}` : code;
  }

  return { category, title, body, badge, color, code };
}

// ----- Public entry -----

export function renderReport(
  details: ApplicationDetails,
  options: RenderOptions = {},
): OverallView {
  const app = (details.app ?? {}) as Record<string, unknown>;
  const relations = Array.isArray(details.relations) ? details.relations : [];
  const focusUci = options.focusUci ?? "";
  const generatedAt =
    options.generatedAt ??
    new Date().toISOString().replace("T", " ").slice(0, 19);

  const status = String(app.status ?? "unknown");

  const peopleRaw = [...relations].sort(
    (a, b) => personSortKey(a) - personSortKey(b),
  );

  const buildPerson = (p: Relation): PersonView => {
    const first = esc(p.firstName);
    const last = esc(p.lastName);
    const uci = esc(p.uci);
    const a = p.activities ?? {};
    const modules: ModuleStatus[] = MODULES.map((m) => {
      const v = a[m.key];
      return {
        key: m.key,
        label: m.label,
        status: v == null ? "unknown" : String(v),
        statusLabel: statusLabel(v),
        statusClass: statusClass(v),
      };
    });

    const events: InterpretedEvent[] = (p.history ?? [])
      .map((h) => {
        const inter = interpretEvent(h);
        return {
          id: `${h.key ?? "?"}-${h.dateCreated ?? ""}-${h.actStatus ?? ""}`,
          date: dateOnly(h.dateCreated),
          whenLabel: shortTime(h.dateCreated),
          ...inter,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const firstSecurity = events.find((e) => e.category === "security")?.date;

    return {
      id: `${roleLabel(p.role)}-${uci || first + last || Math.random().toString(36).slice(2, 6)}`,
      firstName: first,
      lastName: last,
      fullName: [first, last].filter(Boolean).join(" ") || "Unknown",
      initials: initialsOf(first, last),
      uci: uci || undefined,
      role: p.role ?? null,
      roleLabel: roleLabel(p.role),
      relation: relationLabel(p.relationType),
      isRepresentative: p.role === 8,
      isFocus: !!focusUci && uci === focusUci,
      imeExpiry: p.imeExpiry ? dateOnly(p.imeExpiry) : undefined,
      modules,
      events,
      firstSecurity,
    };
  };

  const people = peopleRaw.filter((r) => r.role !== 8).map(buildPerson);
  const representatives = peopleRaw.filter((r) => r.role === 8).map(buildPerson);

  const hasSecurity = peopleRaw.some((r) =>
    (r.history ?? []).some((h) => h.key === "Security"),
  );

  const securityDate = peopleRaw
    .flatMap((r) => r.history ?? [])
    .find((h) => h.key === "Security")?.dateCreated;

  return {
    appNumber: esc(app.appNumber),
    appType: esc(app.lob ?? app.appType ?? "—"),
    status,
    statusLabel: statusLabel(status),
    statusClass: statusClass(status),
    receivedOn: dateOnly(app.dateRecieved) || undefined,
    lastUpdated: dateOnly(app.lastUpdated) || undefined,
    hasSecurity,
    securityDate: securityDate ? dateOnly(securityDate) : undefined,
    people,
    representatives,
    generatedAt,
  };
}