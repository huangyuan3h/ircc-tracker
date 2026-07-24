/**
 * Temporary offline / maintenance Worker for ircc-tracker.it-t.xyz.
 * Replaces the OpenNext app while IRCC immigrant Tracker upstream is down.
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return Response.json(
        {
          error:
            "IRCC Tracker is temporarily offline. The official immigrant Tracker API is unavailable.",
          code: "maintenance",
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "3600",
          },
        },
      );
    }

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>IRCC Tracker — Temporarily Offline</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 2rem;
      font-family: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
      color: #142c27;
      background:
        radial-gradient(900px 420px at 8% -8%, rgba(200,16,46,0.08), transparent 55%),
        radial-gradient(1000px 500px at 100% 0%, rgba(15,92,76,0.14), transparent 50%),
        linear-gradient(165deg, #f4f7f5, #e8efeb 55%, #f4f7f5);
    }
    main {
      width: min(440px, 100%);
      padding: 1.75rem 1.5rem;
      border: 1px solid rgba(20,64,54,0.14);
      border-radius: 22px;
      background: rgba(255,255,255,0.9);
      box-shadow: 0 18px 42px rgba(15,44,36,0.1);
    }
    .mark {
      width: 34px; height: 34px; border-radius: 10px;
      background: linear-gradient(135deg, #0f5c4c, #14715e);
      margin-bottom: 1rem;
    }
    h1 {
      margin: 0;
      font-family: "IBM Plex Serif", ui-serif, Georgia, serif;
      font-size: 1.55rem;
      letter-spacing: -0.02em;
    }
    p {
      margin: 0.85rem 0 0;
      line-height: 1.55;
      color: #4f655e;
      font-size: 0.98rem;
    }
    .pill {
      display: inline-block;
      margin-top: 1.1rem;
      padding: 0.28rem 0.7rem;
      border-radius: 999px;
      background: rgba(155,44,44,0.1);
      color: #9b2c2c;
      font-size: 0.78rem;
      font-weight: 600;
    }
    a { color: #0f5c4c; }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true"></div>
    <h1>Temporarily offline</h1>
    <p>
      This personal IRCC status viewer is paused because the official immigrant
      Tracker API / portal is currently unavailable (DNS / 503 on IRCC side).
    </p>
    <p>
      You can check the official site:
      <a href="https://ircc-tracker-suivi.apps.cic.gc.ca/">ircc-tracker-suivi.apps.cic.gc.ca</a>.
      We will bring this app back once upstream recovers.
    </p>
    <div class="pill">HTTP 503 · maintenance</div>
  </main>
</body>
</html>`;

    return new Response(html, {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "3600",
      },
    });
  },
};
