# Render IRCC application-details JSON to a readable HTML report.
# Usage:
#   jq -r -f lib/render-report.jq \
#     --arg generated_at "2026-07-15 18:00:00" \
#     --arg focus_uci "1139609588" \
#     --slurpfile ref lib/ircc-events.json \
#     input.json

# date helpers --------------------------------------------------------------
def date_only:
  if . == null or . == "" then "—"
  else (. | split("T")[0])
  end;

def full_datetime:
  if . == null or . == "" then "—"
  else (. | sub("\\.[0-9]+Z$"; "Z") | sub("Z$"; " UTC"))
  end;

# status helpers ------------------------------------------------------------
def status_label:
  . as $s
  | if $s == null or $s == "" then "Unknown"
    elif $s == "completed" then "Completed"
    elif $s == "inProgress" then "In progress"
    elif $s == "notStarted" then "Not started"
    elif $s == "exempted" then "Exempted"
    elif $s == "incomplete" then "Incomplete"
    elif $s == "required" then "Required"
    elif $s == "optional" then "Optional"
    else ($s|ascii_upcase|sub("_"; " "))
    end;

def status_class:
  . as $s
  | if $s == "completed" then "ok"
    elif $s == "inProgress" then "warn"
    elif $s == "incomplete" then "warn"
    elif $s == "notStarted" then "muted"
    elif $s == "exempted" or $s == "optional" then "info"
    elif $s == "required" then "danger"
    else "muted"
    end;

# role / relation labels ----------------------------------------------------
def role_label:
  . as $r
  | if $r == 1 then "Principal applicant"
    elif $r == 7 then "Dependent"
    elif $r == 8 then "Representative"
    else ("Role " + ($r|tostring))
    end;

def relation_label:
  . as $t
  | if $t == 2 then "Child"
    elif $t == 10 then "Spouse / partner"
    elif $t == null then ""
    else ("Relation " + ($t|tostring))
    end;

# Event interpretation ------------------------------------------------------
# Returns {category, title, body, badge, color, href}
def interpret_event:
  . as $h
  | ($ref[0].letters // {}) as $letters
  | ($ref[0].system_events // {}) as $sys
  | ($ref[0].status_codes // {}) as $status
  | ($ref[0].category_colors // {}) as $cats
  | ($h.key // "") as $key
  | (
      if $key == "INITIAL" then
        { category: "neutral", title: "Application received", body: "IRCC has logged your application in the system.", badge: "Initial", color: $cats.INITIAL }
      elif $key == "Medical" then
        { category: "medical", title: "Medical exam", body: "Medical exam event. actStatus 33 = started, 108 = completed.", badge: $key, color: $cats.Medical }
      elif $key == "Security" then
        { category: "security", title: "Security / background review", body: "actStatus 17 = comprehensive security check started.", badge: $key, color: $cats.Security }
      elif $key == "Eligibility" then
        { category: "eligibility", title: "Eligibility review", body: "Officer reviewing whether you meet the program requirements.", badge: $key, color: $cats.Eligibility }
      elif $key == "Biometric" then
        { category: "biometrics", title: "Biometrics", body: "Biometrics enrollment / status update.", badge: $key, color: $cats.Biometric }
      elif $key | test("^IMM") then
        (
          ($letters[$key] // {label: ("IRCC letter " + $key), desc: "Auto-generated IRCC system letter."}) as $info
          | { category: "document", title: ($info.label|@text), body: ($info.desc // ""), badge: $key, color: $cats.Document, href: ($info.url // null) }
        )
      elif $key | test("^[0-9]+$") then
        (
          ($sys[$key] // {label: ("System event #" + $key), date: null, desc: "Internal system event — likely an Express Entry draw number."}) as $info
          | {
              category: "system",
              title: $info.label,
              body: (
                if ($info.date // null) != null
                then "\($info.desc|@text)\nReference date: \($info.date|@text)"
                else $info.desc
                end
              ),
              badge: $key,
              color: $cats.System,
              href: null
            }
        )
      else
        { category: "other", title: ($key|@text), body: "Tracker event with no description yet.", badge: $key, color: "muted", href: null }
      end
    ) as $ev
  | $ev
  | (if ($h.actStatus != null) then . + {code: ($status[$h.actStatus|tostring] // ("Internal code " + ($h.actStatus|tostring)))} else . end);

def badge_html($ev):
  "<span class=\"ev ev-\($ev.color)\">\($ev.badge|@html)</span>";

# Layout helpers ------------------------------------------------------------
def module_row($name; $status):
  "<div class=\"module\"><span class=\"module-name\">\($name|@html)</span><span class=\"badge \($status|status_class)\">\($status|status_label)</span></div>";

def person_sort_key:
  if .role == 1 then 0
  elif .role == 7 then 1
  elif .role == 8 then 9
  else 5
  end;

def has_security:
  any(.relations[]?; any((.history // [])[]; (.key // "") == "Security"));

def primary_security_date:
  ([.relations[]?
    | select(.role == 1)
    | (.history // [])[]
    | select((.key // "") == "Security")
    | .dateCreated
  ] | first)
  // ([.relations[]?
    | (.history // [])[]
    | select((.key // "") == "Security")
    | .dateCreated
  ] | first)
  // null;

# Timeline component --------------------------------------------------------
def month_label($iso):
  $iso | split("T")[0] | split("-") | "[\(.[0]), \(.[1])]";

def render_timeline:
  . as $p
  | ($p.history // []) as $evs
  | (
      $evs
      | sort_by(.dateCreated)
      | group_by(.dateCreated | split("T")[0])
      | reverse
      | .[]
      | .[0].dateCreated | split("T")[0]
    ) as $months
  | (
      $evs
      | sort_by(.dateCreated) | reverse
      | group_by(.dateCreated | split("T")[0])
      | .[]
      | (
          "<section class=\"month\">",
          "<header class=\"month-head\">\((.[0].dateCreated | split("T")[0])|@html)</header>",
          "<ol class=\"events\">",
          (
            .[]
            | interpret_event as $ev
            | "<li class=\"ev-li ev-li-\($ev.category)\">",
              "<div class=\"ev-when\">",
                "<time>\((.dateCreated | full_datetime)|@html)</time>",
              "</div>",
              "<div class=\"ev-body\">",
                badge_html($ev),
                "<div class=\"ev-title\">\($ev.title|@html)</div>",
                (if ($ev.body // "") != "" then
                  "<p class=\"ev-text\">\($ev.body|gsub("\n"; "<br />")|@html)</p>"
                 else "" end),
                (if $ev.code then "<p class=\"ev-code\">\($ev.code|@html)</p>" else "" end),
              "</div>",
              "</li>"
          ),
          "</ol>",
          "</section>"
        )
    );

def render_person:
  . as $p
  | ($p.activities // {}) as $a
  | (if ($focus_uci != "" and ($p.uci // "") == $focus_uci) then " person-focus" else "" end) as $focus
  | ($p.relationType | relation_label) as $rel
  | ($p.role | role_label) as $role
  | "<section class=\"person\($focus)\">",
    "<header class=\"person-head\">",
      "<div>",
        "<h2>\(($p.firstName // "")|@html) <span class=\"lastname\">\($p.lastName // ""|@html)</span></h2>",
        "<p class=\"meta\">",
          (if $rel != "" then "\($rel|@html) · " else "" end),
          "\($role|@html)",
          " · UCI <code>\($p.uci // "—"|@html)</code>",
        "</p>",
      "</div>",
      (if ($p.imeExpiry != null) then
        "<p class=\"meta tip\">Medical (IME) expiry: <time>\(($p.imeExpiry|date_only)|@html)</time></p>"
       else "" end),
    "</header>",
    "<div class=\"modules\">",
      module_row("Eligibility"; $a.eligibility // "unknown"),
      module_row("Medical"; $a.medical // "unknown"),
      module_row("Biometrics"; $a.biometrics // "unknown"),
      module_row("Background"; $a.background // "unknown"),
    "</div>",
    (if (($p.history // []) | length) == 0 then
      "<p class=\"empty\">No timeline events yet.</p>"
     else
      "<h3>Timeline</h3>",
      (render_timeline)
     end),
    "</section>";

# Main render ---------------------------------------------------------------
(.app // {}) as $app
| ($generated_at // "") as $gen
| ($focus_uci // "") as $focus_uci
| (has_security) as $sec
| (primary_security_date | date_only) as $sec_date

| (try ($ref[0]) catch null) as $ref
| (
    "<!DOCTYPE html>",
    "<html lang=\"en\">",
    "<head>",
      "<meta charset=\"utf-8\" />",
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
      "<title>IRCC Status · \($app.appNumber // "Report")</title>",
      "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\" />",
      "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin />",
      "<link href=\"https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@500;600&display=swap\" rel=\"stylesheet\" />",
      "<style>",
        ":root{",
        "  --bg:#f4f6f5;",
        "  --ink:#16302b;",
        "  --muted:#5b6e68;",
        "  --line:#d5e0db;",
        "  --panel:#ffffff;",
        "  --ok:#1f7a4c;",
        "  --ok-bg:#e5f5ec;",
        "  --warn:#9a6700;",
        "  --warn-bg:#fff4d6;",
        "  --info:#0b6e99;",
        "  --info-bg:#e6f4fa;",
        "  --danger:#8b2e2e;",
        "  --danger-bg:#fdecec;",
        "  --alert:#8b2e2e;",
        "  --alert-bg:#fdecec;",
        "  --neutral:#5b6e68;",
        "  --neutral-bg:#eef1ef;",
        "  --accent:#0f5c4c;",
        "  --security:#8b2e2e;",
        "  --security-bg:#fdecec;",
        "  --medical:#0b6e99;",
        "  --medical-bg:#e6f4fa;",
        "  --eligibility:#5e3aa0;",
        "  --eligibility-bg:#efeafa;",
        "  --biometrics:#9a6700;",
        "  --biometrics-bg:#fff4d6;",
        "  --background:#0f5c4c;",
        "  --background-bg:#dff1ea;",
        "  --document:#1f4a78;",
        "  --document-bg:#e8eff7;",
        "  --system:#334155;",
        "  --system-bg:#e9ecf1;",
        "}",
        "*{box-sizing:border-box}",
        "body{margin:0;font-family:'IBM Plex Sans',sans-serif;color:var(--ink);background:",
        "  radial-gradient(1200px 500px at 10% -10%, #d9ece4 0%, transparent 55%),",
        "  radial-gradient(900px 400px at 100% 0%, #e7eef2 0%, transparent 50%),",
        "  var(--bg);",
        "line-height:1.5}",
        ".wrap{max-width:940px;margin:0 auto;padding:2.5rem 1.25rem 4rem}",
        "h1,h2,h3{font-family:'IBM Plex Serif',serif;font-weight:600;letter-spacing:-0.02em;margin:0}",
        "h1{font-size:clamp(1.8rem,4vw,2.4rem)}",
        "h2{font-size:1.35rem}",
        "h2 .lastname{color:var(--muted);font-weight:500}",
        "h3{font-size:1.05rem;margin:1.5rem 0 0.75rem;color:var(--muted)}",
        ".eyebrow{text-transform:uppercase;letter-spacing:0.08em;font-size:0.75rem;font-weight:600;color:var(--accent);margin:0 0 0.5rem}",
        ".lede{color:var(--muted);margin:0.75rem 0 0;max-width:42rem}",
        ".hero{padding-bottom:1.75rem;border-bottom:1px solid var(--line);margin-bottom:1.5rem}",
        ".stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem;margin-top:1.5rem}",
        ".stat{padding:0.9rem 1rem;border-top:3px solid var(--accent);background:rgba(255,255,255,0.72)}",
        ".stat span{display:block;font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em}",
        ".stat strong{display:block;margin-top:0.25rem;font-size:1.05rem}",
        ".alert{margin:1rem 0 1.75rem;padding:1rem 1.1rem;background:var(--alert-bg);border-left:4px solid var(--alert);color:var(--alert)}",
        ".alert strong{display:block;margin-bottom:0.2rem}",
        ".alert.ok{background:var(--ok-bg);border-left-color:var(--ok);color:var(--ok)}",
        ".section-title{display:flex;align-items:center;gap:0.6rem;margin:2rem 0 0.5rem;font-family:'IBM Plex Serif',serif;font-size:1.15rem;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:0.08em;font-size:0.8rem}",
        ".section-title::before{content:'';flex:0 0 6px;height:6px;border-radius:50%;background:var(--accent)}",
        ".person{padding:1.5rem 0;border-bottom:1px solid var(--line)}",
        ".person-focus{background:linear-gradient(90deg, rgba(15,92,76,0.06), transparent 55%);margin:0 -1.25rem;padding:1.5rem 1.25rem;border-top:1px solid var(--line)}",
        ".person-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:0.75rem;align-items:flex-start;margin-bottom:1rem}",
        ".meta{margin:0.35rem 0 0;color:var(--muted);font-size:0.92rem}",
        ".tip{font-size:0.85rem}",
        ".modules{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.6rem;margin-bottom:0.5rem}",
        "@media (min-width:640px){.modules{grid-template-columns:repeat(4,minmax(0,1fr))}}",
        ".module{display:flex;flex-direction:column;gap:0.45rem;padding:0.85rem 0.9rem;background:var(--panel);border:1px solid var(--line);border-radius:2px}",
        ".module-name{font-size:0.8rem;color:var(--muted);font-weight:500}",
        ".badge{display:inline-flex;align-items:center;width:fit-content;padding:0.2rem 0.55rem;font-size:0.8rem;font-weight:600;border-radius:999px}",
        ".badge.ok{background:var(--ok-bg);color:var(--ok)}",
        ".badge.warn{background:var(--warn-bg);color:var(--warn)}",
        ".badge.info{background:var(--info-bg);color:var(--info)}",
        ".badge.muted{background:var(--muted-bg);color:var(--muted)}",
        ".badge.danger{background:var(--danger-bg);color:var(--danger)}",
        ".representative{background:rgba(15,92,76,0.04);border-radius:6px;padding:1.25rem 1.5rem;margin-top:1rem;border:1px dashed var(--line)}",
        ".representative .person{padding:0;border-bottom:none}",
        ".representative .person-focus{background:none;margin:0;padding:0;border-top:none}",
        ".timeline-months{display:flex;flex-direction:column;gap:1.25rem;margin-top:0.5rem;padding-left:0.5rem;border-left:2px solid var(--line)}",
        ".month-head{font-size:0.78rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.6rem}",
        ".events{list-style:none;margin:0;padding:0 0 0 0.75rem;display:flex;flex-direction:column;gap:0.65rem;position:relative}",
        ".events::before{content:'';position:absolute;left:-1.45rem;top:0;bottom:0;width:1px;background:var(--line)}",
        ".ev-li{position:relative;display:grid;grid-template-columns:9rem 1fr;gap:0.85rem;align-items:start}",
        ".ev-li::before{content:'';position:absolute;left:-1.6rem;top:0.45rem;width:9px;height:9px;border-radius:50%;background:var(--line);border:2px solid var(--bg)}",
        ".ev-li-security::before{background:var(--security)}",
        ".ev-li-medical::before{background:var(--medical)}",
        ".ev-li-eligibility::before{background:var(--eligibility)}",
        ".ev-li-biometrics::before{background:var(--biometrics)}",
        ".ev-li-background::before{background:var(--background)}",
        ".ev-li-document::before{background:var(--document)}",
        ".ev-li-system::before{background:var(--system)}",
        ".ev-when time{font-variant-numeric:tabular-nums;color:var(--muted);font-size:0.82rem;display:block;padding-top:0.18rem}",
        ".ev-body{background:var(--panel);border:1px solid var(--line);padding:0.55rem 0.8rem;border-radius:2px}",
        ".ev-li-security .ev-body{border-color:#e3b4b4;background:#fff8f8}",
        ".ev-title{font-weight:600;font-size:0.98rem;margin:0.35rem 0 0.15rem}",
        ".ev-text{margin:0.2rem 0 0;color:var(--muted);font-size:0.88rem}",
        ".ev-code{margin:0.3rem 0 0;font-size:0.78rem;color:var(--muted);font-style:italic}",
        ".ev{display:inline-flex;align-items:center;padding:0.1rem 0.55rem;font-size:0.72rem;font-weight:700;border-radius:999px;text-transform:uppercase;letter-spacing:0.04em;color:#fff}",
        ".ev-security{background:var(--security)}",
        ".ev-medical{background:var(--medical)}",
        ".ev-eligibility{background:var(--eligibility)}",
        ".ev-biometrics{background:var(--biometrics)}",
        ".ev-background{background:var(--background)}",
        ".ev-document{background:var(--document)}",
        ".ev-system{background:var(--system)}",
        ".ev-neutral{background:var(--neutral)}",
        ".empty{color:var(--muted)}",
        "footer{margin-top:2rem;color:var(--muted);font-size:0.85rem}",
        ".legend{margin-top:0.5rem;display:flex;flex-wrap:wrap;gap:0.5rem 1rem;font-size:0.78rem;color:var(--muted)}",
        ".legend span{display:inline-flex;align-items:center;gap:0.35rem}",
        ".legend i{width:9px;height:9px;border-radius:50%;display:inline-block}",
        "code{font-family:'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;font-size:0.85em;background:var(--neutral-bg);padding:0.05em 0.35em;border-radius:2px}",
      "</style>",
    "</head>",
    "<body>",
      "<main class=\"wrap\">",
        "<header class=\"hero\">",
          "<p class=\"eyebrow\">IRCC Application Status</p>",
          "<h1>\(($app.firstName // "")|@html) <span class=\"lastname\">\($app.lastName // "")</span></h1>",
          "<p class=\"lede\">Application <strong>\($app.appNumber // "—")</strong>",
          " · Type <strong>\($app.lob // "—")</strong>",
          " · Overall <span class=\"badge \($app.status // "unknown" | status_class)\">\($app.status // "unknown" | status_label)</span></p>",
          "<div class=\"stats\">",
            "<div class=\"stat\"><span>Received</span><strong>\($app.dateRecieved | date_only)</strong></div>",
            "<div class=\"stat\"><span>Last updated</span><strong>\($app.lastUpdated | date_only)</strong></div>",
            "<div class=\"stat\"><span>Security</span><strong>\(if $sec then $sec_date else "Not detected" end)</strong></div>",
            "<div class=\"stat\"><span>People</span><strong>\((.relations // []) | length)</strong></div>",
          "</div>",
          (if $sec then
            "<div class=\"alert\" role=\"status\"><strong>Security review detected</strong>At least one Security history node exists (earliest/principal: \($sec_date)). Background module is typically still in progress while this runs.</div>"
           else
            "<div class=\"alert ok\" role=\"status\"><strong>No Security node detected</strong>No Security history entries were found on this application snapshot.</div>"
           end),
          "<div class=\"legend\">",
            "<span><i style=\"background:var(--security)\"></i>Security</span>",
            "<span><i style=\"background:var(--medical)\"></i>Medical</span>",
            "<span><i style=\"background:var(--eligibility)\"></i>Eligibility</span>",
            "<span><i style=\"background:var(--biometrics)\"></i>Biometrics</span>",
            "<span><i style=\"background:var(--background)\"></i>Background</span>",
            "<span><i style=\"background:var(--document)\"></i>IRCC letter</span>",
            "<span><i style=\"background:var(--system)\"></i>System event</span>",
          "</div>",
        "</header>",

        # ---- Applicants / dependants ----
        (
          (.relations // [])
          | sort_by(person_sort_key)
          | map(select(.role != 8))
          | .[]
          | render_person
        ),

        # ---- Representative section ----
        (
          (.relations // [])
          | sort_by(person_sort_key)
          | map(select(.role == 8))
          | if (length > 0) then
              "<div class=\"section-title\">Representatives</div>",
              "<div class=\"representative\">",
              (.[] | render_person),
              "</div>"
            else empty end
        ),

        "<footer>",
          "Generated \(($gen // "by ircc-check")) by ircc-check. Local report only — do not share publicly.",
        "</footer>",
      "</main>",
    "</body>",
    "</html>"
  )