#!/usr/bin/env python3
"""Builds the Solvro live-QA report page from the walkthrough log.
Usage: build_report.py <qa_dir> <out_dir> <facts.json> -> <out_dir>/index.html (images: shots/<id>.jpg)."""
import json, sys, html

qa_dir, out_dir, facts_path = sys.argv[1:4]
log = json.load(open(f"{qa_dir}/log.json"))
facts = json.load(open(facts_path))
steps = {s["id"]: s for s in log["steps"]}
E = html.escape

GROUPS = [
    ("Workspace", ["01-login", "02-overview", "03-sidebar-collapsed", "04-projects"]),
    ("Project", ["05-00-project-overview", "05-01-project-list", "05-02-project-kanban", "05-03-project-gantt",
                 "05-04-project-epics", "05-05-project-timeline", "05-06-project-risks", "05-07-project-services"]),
    ("Project actions and task editing", ["06-project-menu", "07-delete-confirm", "08-task-panel", "09-task-form"]),
    ("Customers", ["10-customers", "11-customer-account", "12-customer-services"]),
    ("Tasks views", ["13-tasks-open", "14-tasks-overdue", "15-tasks-week"]),
    ("Cadence and insights", ["16-daily-review", "17-weekly-sync", "18-utilization", "19-executive"]),
    ("System", ["20-settings", "21-admin", "22-help", "23-palette"]),
    ("Light theme", ["30-light-overview", "31-light-kanban", "32-light-customer"]),
    ("Phone, 390 px", ["40-m-overview", "41-m-project", "42-m-tasks", "43-m-customer", "44-m-menu"]),
]

def card(sid):
    s = steps.get(sid)
    if not s:
        return ""
    ok = bool(s.get("file")) and not s.get("overflow")
    chip = '<span class="chip chip-pass">Pass</span>' if ok else '<span class="chip chip-fail">Check</span>'
    phone = " card-phone" if sid.startswith("4") else ""
    img = (f'<a class="shot" href="shots/{E(sid)}.jpg" target="_blank" rel="noopener">'
           f'<img src="shots/{E(sid)}.jpg" alt="{E(s["title"])}" loading="lazy"></a>') if s.get("file") else '<div class="shot shot-missing">No screenshot</div>'
    note = f'<p class="note">{E(s.get("note",""))}</p>' if s.get("note") else ""
    return (f'<article class="card{phone}">{img}<div class="meta"><div class="meta-top"><h4>{E(s["title"])}</h4>{chip}</div>'
            f'<code class="route">{E(s.get("url") or "")}</code>{note}</div></article>')

stats = "".join(f'<div class="stat"><span class="stat-v {E(t.get("tone",""))}">{E(str(t["value"]))}</span><span class="stat-l">{E(t["label"])}</span></div>' for t in facts["stats"])
fixed = "".join(f'<tr><td><span class="chip chip-fixed">Fixed</span></td><td><strong>{E(f["title"])}</strong><br><span class="muted">{E(f["what"])}</span></td><td><a href="shots/{E(f["id"])}.jpg" target="_blank" rel="noopener">After</a></td></tr>' for f in facts["fixed"])
known = "".join(f'<li><strong>{E(k["title"])}</strong> {E(k["detail"])}</li>' for k in facts["known"])
checks = "".join(f'<tr><td>{E(c["name"])}</td><td class="num">{E(c["result"])}</td><td>{E(c["note"])}</td></tr>' for c in facts["checks"])
timings = "".join(f'<tr><td><code>{E(t["endpoint"])}</code></td><td class="num">{E(t["ms"])}</td></tr>' for t in facts["timings"])
groups = "".join(f'<section class="group" id="g-{i}"><h3>{E(n)}</h3><div class="grid{" grid-phone" if n.startswith("Phone") else ""}">' + "".join(card(s) for s in ids) + "</div></section>" for i, (n, ids) in enumerate(GROUPS))
toc = "".join(f'<a href="#g-{i}">{E(n)}</a>' for i, (n, _) in enumerate(GROUPS))

LIGHT = """--bg:#f9f9f7;--surface:#fff;--raised:#f2f2ee;--line:#d0d0cc;--fg:#1a1a18;--muted:#4a4a47;--accent:#2d9042;--accent-soft:rgba(45,144,66,.12);--ok-bg:#dcfce7;--ok-fg:#166534;--warn-fg:#92400e;--bad-bg:#fee2e2;--bad-fg:#991b1b;color-scheme:light;"""
page = f'''<title>Solvro UI Pass QA</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&display=swap">
<style>
/* Layout: a reading column for the verdict and checks, then a dense screenshot grid per area. Solvro's "Technical Precision" tokens, dark first. */
:root{{--bg:#1a1a18;--surface:#232321;--raised:#2a2a28;--line:#3a3a37;--fg:#f0ede8;--muted:#b0ada8;--accent:#3aae51;--accent-soft:rgba(58,174,81,.16);--ok-bg:#064e3b;--ok-fg:#a7f3d0;--warn-fg:#fde68a;--bad-bg:#7f1d1d;--bad-fg:#fecaca;
--font-body:"Source Sans 3","Segoe UI",system-ui,sans-serif;--font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color-scheme:dark}}
@media (prefers-color-scheme:light){{:root:not([data-theme="dark"]){{{LIGHT}}}}}
:root[data-theme="light"]{{{LIGHT}}}
*{{box-sizing:border-box}}
body{{background:var(--bg);color:var(--fg);font:450 15px/1.5 var(--font-body)}}
.wrap{{max-width:1240px;margin:0 auto;padding-inline:20px;padding-block:32px 64px;display:flex;flex-direction:column;gap:40px}}
h1,h2,h3,h4{{margin:0;text-wrap:balance}} h1{{font-size:32px;font-weight:700;line-height:1.15}} h2{{font-size:22px;font-weight:600}}
h3{{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}} h4{{font-size:15px;font-weight:600}}
p{{margin:0;max-width:72ch}} code{{font-family:var(--font-mono);font-size:12.5px}} a{{color:var(--accent)}}
a:focus-visible{{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}}
.muted{{color:var(--muted)}}
.eyebrow{{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}}
.head{{display:flex;flex-direction:column;gap:10px}} .lead{{color:var(--muted);font-size:17px}}
.verdict{{border:1px solid var(--line);border-left:3px solid var(--accent);background:var(--surface);border-radius:0 8px 8px 0;padding:16px 18px;display:flex;flex-direction:column;gap:6px}}
.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}}
.stat{{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:2px}}
.stat-v{{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}} .stat-v.good{{color:var(--accent)}} .stat-v.warn{{color:var(--warn-fg)}}
.stat-l{{color:var(--muted);font-size:13px}}
.section{{display:flex;flex-direction:column;gap:16px}}
.chip{{display:inline-flex;align-items:center;border-radius:999px;padding:1px 9px;font-size:12px;font-weight:600;white-space:nowrap}}
.chip-pass{{background:var(--ok-bg);color:var(--ok-fg)}} .chip-fixed{{background:var(--accent-soft);color:var(--accent)}} .chip-fail{{background:var(--bad-bg);color:var(--bad-fg)}}
.toc{{display:flex;flex-wrap:wrap;gap:8px}}
.toc a{{text-decoration:none;color:var(--fg);background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:4px 10px;font-size:13px}} .toc a:hover{{border-color:var(--accent)}}
.group{{display:flex;flex-direction:column;gap:12px;scroll-margin-top:16px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}} .grid-phone{{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}}
.card{{background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;min-width:0}}
.card .shot{{display:block;padding:8px 8px 0}}
.shot img{{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:6px;background:var(--raised);aspect-ratio:16/10;object-fit:cover;object-position:top}}
.card-phone .shot img{{aspect-ratio:390/844}}
.shot-missing{{padding:40px;color:var(--muted);text-align:center}}
.meta{{padding:10px 12px 12px;display:flex;flex-direction:column;gap:4px}} .meta-top{{display:flex;align-items:center;justify-content:space-between;gap:8px}}
.route{{color:var(--muted);overflow-wrap:anywhere}} .note{{color:var(--muted);font-size:13px}}
.twocol{{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;align-items:start}}
.panel{{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:10px;min-width:0}}
.table-scroll{{overflow-x:auto}} table{{border-collapse:collapse;width:100%;font-size:14px}}
th,td{{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}}
th{{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}}
td.num{{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600}}
ul.known{{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:8px}} ul.known li{{max-width:80ch;color:var(--muted)}} ul.known strong{{color:var(--fg);font-weight:600}}
footer{{color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:16px}}
@media (max-width:820px){{.twocol{{grid-template-columns:1fr}}.grid{{grid-template-columns:1fr}}.grid-phone{{grid-template-columns:repeat(2,1fr)}}}}
</style>
<div class="wrap">
  <header class="head"><span class="eyebrow">Live QA · {E(facts["date"])}</span><h1>Solvro UI pass, tested as a user would use it</h1><p class="lead">{E(facts["lead"])}</p></header>
  <div class="verdict"><h4>{E(facts["verdict_title"])}</h4><p>{E(facts["verdict"])}</p></div>
  <div class="stats">{stats}</div>
  <section class="section"><h2>Found during QA and fixed</h2><p class="lead">The first walkthrough surfaced these defects. Each was fixed, reviewed, and checked again in the final walkthrough.</p>
    <div class="panel"><div class="table-scroll"><table><tbody>{fixed}</tbody></table></div></div></section>
  <section class="section"><h2>Every screen, final build</h2><nav class="toc" aria-label="Screen groups">{toc}</nav>{groups}</section>
  <section class="twocol">
    <div class="panel"><h2>Automated checks</h2><div class="table-scroll"><table><thead><tr><th>Check</th><th>Result</th><th>Notes</th></tr></thead><tbody>{checks}</tbody></table></div></div>
    <div class="panel"><h2>API response times</h2><p class="note">Backend on the dev stack, demo data, admin session, three warm requests each. Target: under 200 ms.</p><div class="table-scroll"><table><thead><tr><th>Endpoint</th><th>ms</th></tr></thead><tbody>{timings}</tbody></table></div></div>
  </section>
  <section class="panel"><h2>Known issues, not blocking</h2><ul class="known">{known}</ul></section>
  <footer>{E(facts["footer"])}</footer>
</div>
'''
open(f"{out_dir}/index.html", "w").write(page)
print("ok", len(page))
