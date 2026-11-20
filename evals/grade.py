"""Grade plan-graph eval runs. Programmatic checks here; reply-reading checks come from manual.json.
usage: python3 evals/grade.py <iteration-dir>  (reads <iteration-dir>/manual.json for reply checks)"""
import json, os, re, subprocess, sys, filecmp, glob

SKILL = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IT = os.path.abspath(sys.argv[1])
manual = json.load(open(os.path.join(IT, "manual.json"))) if os.path.exists(os.path.join(IT, "manual.json")) else {}

def load(path):
    try: return json.load(open(path))
    except Exception: return None

def lint(path):
    r = subprocess.run(["node", "--experimental-strip-types", f"{SKILL}/scripts/plan.ts", "lint", path], capture_output=True, text=True)
    last = (r.stdout.strip().splitlines() or [r.stderr.strip()[:200]])[-1]
    return r.returncode == 0, last

def items(plan):
    out = []
    for s in plan.get("surfaces", []):
        out.append(("surface", s["id"], s))
        for st in s.get("states", []) or []: out.append(("state", f'{s["id"]}#{st["id"]}', st))
        for e in s.get("elements", []) or []: out.append(("element", e["id"], e))
    for i in plan.get("interactions", []):
        out.append(("interaction", i["id"], i))
        for o in i.get("outcomes", []): out.append(("outcome", o["id"], o))
    for d in plan.get("decisions", []): out.append(("decision", d["id"], d))
    for g in plan.get("groups", []) or []: out.append(("group", g["id"], g))
    return out

def text_of(x):
    keys = ["id", "name", "label", "when", "result", "description", "question", "value", "address"]
    t = " ".join(str(x.get(k, "")) for k in keys)
    if "trigger" in x: t += " " + x["trigger"].get("description", "")
    if "spec" in x: t += " " + json.dumps(x["spec"])
    return t.lower()

def own(x):
    return {k: v for k, v in x.items() if k not in ("meta", "outcomes", "states", "elements")}

NO_PLAN = (False, "No plan-graph/plan.json in the project")

def grade_plans_new_web_app(proj):
    pp = f"{proj}/plan-graph/plan.json"; plan = load(pp)
    r = {}
    if plan is None or "surfaces" not in plan:
        r.update({k: NO_PLAN for k in ["01", "02", "03", "04", "05", "06"]})
    else:
        ok, last = lint(pp); r["01"] = (ok, f"lint: {last}")
        web = [s for s in plan["surfaces"] if s.get("profile") == "web"]
        api = [s for s in plan["surfaces"] if s.get("profile") == "api"]
        blob = " ".join(text_of(s) for s in web)
        need = {"sign up/in": r"sign|login|log in|register", "browse/search": r"search|browse", "favorites": r"favo", "new recipe": r"new|create|post|submit", "recipe detail": r"detail|recipe"}
        miss = [k for k, rx in need.items() if not re.search(rx, blob)]
        r["02"] = (len(web) >= 5 and len(api) >= 5 and not miss, f"{len(web)} web surfaces, {len(api)} api surfaces; missing: {miss or 'none'}")
        keys = {d.get("checklistKey") for d in plan.get("decisions", [])}
        want = [c["key"] for p in ("web", "api") for c in json.load(open(f"{SKILL}/profiles/{p}.json"))["decisionChecklist"]]
        unanswered = [k for k in want if k not in keys]
        r["03"] = (not unanswered, f"unanswered: {unanswered or 'none'} ({len(set(want))} keys)")
        ds = plan.get("decisions", [])
        bad = [d["id"] for d in ds if not d.get("alternatives") or d.get("impact") not in ("low", "medium", "high")]
        high = sum(d.get("impact") == "high" for d in ds)
        r["04"] = (bool(ds) and not bad and high < len(ds) / 2, f"{len(ds)} decisions, {high} high; missing alternatives/impact: {bad or 'none'}")
        single = [i["id"] for i in plan["interactions"] if i["trigger"]["kind"] in ("submit", "request") and len(i["outcomes"]) < 2]
        n = sum(i["trigger"]["kind"] in ("submit", "request") for i in plan["interactions"])
        r["05"] = (n > 0 and not single, f"{n} submit/request interactions; single-outcome: {single or 'none'}")
        badm = [ref for _, ref, x in items(plan) if x.get("meta", {}).get("origin") != "agent" or x.get("meta", {}).get("status") != "proposed"]
        r["06"] = (not badm, f"{len(items(plan))} items; not agent/proposed: {badm[:5] or 'none'}")
    code = [f for f in glob.glob(f"{proj}/**/*", recursive=True) if os.path.isfile(f) and "/plan-graph/" not in f and not f.endswith((".md", ".gitignore"))]
    r["07"] = (not code, f"non-plan files: {[os.path.relpath(f, proj) for f in code][:8] or 'none'}")
    return r

FIX_NOTES = f"{SKILL}/evals/documents-existing-notes-app/files/notes-app"
def grade_documents_existing_notes_app(proj):
    pp = f"{proj}/plan-graph/plan.json"; plan = load(pp)
    r = {}
    if plan is None or "surfaces" not in plan:
        r.update({k: NO_PLAN for k in ["01", "02", "03", "04"]})
    else:
        ok, last = lint(pp); r["01"] = (ok and plan.get("mode") == "retroactive", f"mode {plan.get('mode')}; lint: {last}")
        files = [os.path.relpath(f, FIX_NOTES) for f in glob.glob(f"{FIX_NOTES}/**/*", recursive=True) if os.path.isfile(f)]
        def cited(x):
            src = x.get("meta", {}).get("sources") or []
            return x.get("meta", {}).get("origin") == "code" and any(any(str(s.get("file", "")).endswith(f) for f in files) for s in src)
        bad = [x["id"] for x in plan["surfaces"] + plan["interactions"] if not cited(x)]
        r["02"] = (not bad, f"without origin code + source: {bad[:6] or 'none'}")
        apiblob = " ".join(text_of(s) + " " + " ".join(text_of(i) for i in plan["interactions"] if i["from"].split("#")[0] == s["id"]) for s in plan["surfaces"] if s.get("profile") == "api")
        need = {"list": r"get\s+/api/notes(?![/\w:])", "create": r"post\s+/api/notes", "get id": r"get\s+/api/notes/:id", "delete": r"delete\s+/api/notes/:id", "export": r"/api/notes/export"}
        miss = [k for k, rx in need.items() if not re.search(rx, apiblob)]
        cliblob = " ".join(text_of(s) for s in plan["surfaces"] if s.get("profile") == "cli")
        miss += [f"cli {c}" for c in ("list", "add", "rm") if not re.search(rf"\b{c}\b", cliblob)]
        if not any(s.get("profile") == "web" for s in plan["surfaces"]): miss.append("web page")
        r["03"] = (not miss, f"missing: {miss or 'none'}")
        ds = [d for d in plan.get("decisions", []) if d.get("meta", {}).get("origin") == "code" and d.get("meta", {}).get("status") == "proposed" and d.get("alternatives")]
        r["04"] = (len(ds) >= 4, f"{len(ds)} code/proposed decisions with alternatives: {[d['id'] for d in ds][:8]}")
    cmp = filecmp.dircmp(FIX_NOTES, f"{proj}/notes-app")
    changed = []
    def walk(d, pre=""):
        changed.extend(pre + f for f in d.diff_files + d.left_only + d.right_only)
        for k, sub in d.subdirs.items(): walk(sub, pre + k + "/")
    walk(cmp)
    r["09"] = (not changed, f"changed/added/removed: {changed or 'none'}")
    return r

FIX_CS = f"{SKILL}/evals/applies-gui-changeset/files/plan-graph"
CONFIRMED = ["d.redirect-status", "d.auth", "d.web-errors", "d.cli-exit-codes", "web.result.copy"]
def grade_applies_gui_changeset(proj):
    pp = f"{proj}/plan-graph/plan.json"; plan = load(pp); base = load(f"{FIX_CS}/plan.json")
    r = {}
    idx = {ref: x for _, ref, x in items(plan)}
    bidx = {ref: x for _, ref, x in items(base)}
    probs = []
    for ref in CONFIRMED:
        if ref not in idx: probs.append(f"{ref} missing")
    if "expiry" and "1 year" not in str(idx.get("d.expiry", {}).get("value", "")).lower(): probs.append("d.expiry not updated")
    if "focus" not in str(idx.get("web.result.new.go", {}).get("result", "")).lower(): probs.append("web.result.new.go not updated")
    if "web.home.alias-input" in idx: probs.append("alias input still present")
    for ref in ("web.result.qr-btn", "web.qr-modal", "web.result.show-qr"):
        if ref not in idx: probs.append(f"{ref} not added")
    r["01"] = (not probs, f"problems: {probs or 'none'}")
    alias = [ref for _, ref, x in items(plan) if "alias" in text_of(x) and not (x.get("meta", {}).get("status") == "proposed" and x.get("meta", {}).get("note"))]
    r["02"] = (not alias, f"alias items not flagged: {alias or 'none'}")
    m = idx.get("web.qr-modal")
    its = [i for i in plan["interactions"] if i["from"].split("#")[0] == "web.qr-modal"]
    agentp = all(i["meta"].get("origin") == "agent" and i["meta"].get("status") == "proposed" for i in its)
    r["03"] = (bool(m) and m["meta"]["status"] != "sketch" and any(i["outcomes"] for i in its) and agentp,
               f"modal status {m and m['meta']['status']}; {len(its)} interaction(s) from it; all agent/proposed: {agentp}")
    bad = []
    for ref in CONFIRMED:
        x = idx.get(ref)
        if not x: continue
        st, note = x["meta"].get("status"), x["meta"].get("note")
        a, b = own(x), own(bidx[ref])
        # Adding an alternative (with a note) records an option without changing the user's choice.
        alt_only = {k: v for k, v in a.items() if k != "alternatives"} == {k: v for k, v in b.items() if k != "alternatives"} \
            and set(b.get("alternatives", [])) <= set(a.get("alternatives", [])) and note
        if st == "confirmed" and a != b and not alt_only: bad.append(f"{ref} changed but still confirmed")
        elif st != "confirmed" and not (st == "proposed" and note): bad.append(f"{ref} status {st} without note")
    r["04"] = (not bad, f"{bad or 'all confirmed items intact or flagged'}")
    ok, last = lint(pp); r["05"] = (ok, f"lint: {last}")
    cs = load(f"{FIX_CS}/changeset.json")
    user_added = {op["value"]["id"] for op in cs["ops"] if op["op"] == "add"}
    new_s = [s["id"] for s in plan["surfaces"] if s["id"] not in bidx and s["id"] not in user_added]
    new_i = [i["id"] for i in plan["interactions"] if i["id"] not in bidx and i["id"] not in user_added and not i["from"].startswith("web.qr-modal")]
    moved = [s["id"] for s in plan["surfaces"] if "stats" in s["id"] and s["id"] in bidx and s.get("address") != bidx[s["id"]].get("address")]
    new_d = [d["id"] for d in plan["decisions"] if d["id"] not in bidx and "stats" in text_of(d) and "qr" not in d["id"]]
    auth_val = idx.get("d.auth", {}).get("value") == bidx["d.auth"]["value"]
    r["09"] = (not (new_s or new_i or moved or new_d) and auth_val,
               f"new surfaces: {new_s or 'none'}; new interactions: {new_i or 'none'}; stats addresses changed: {moved or 'none'}; new stats decisions: {new_d or 'none'}; d.auth value unchanged: {auth_val}")
    left = [f for f in ("changeset.json", "changeset.applying.json") if os.path.exists(f"{proj}/plan-graph/{f}")]
    r["06"] = (not left, f"remaining: {left or 'none'}")
    return r

FIX_KV = f"{SKILL}/evals/implements-from-plan/files/plan-graph"
def find_cli(proj):
    pkg = load(f"{proj}/package.json") or {}
    b = pkg.get("bin")
    cands = ([b] if isinstance(b, str) else list((b or {}).values())) + ["kv.js", "bin/kv.js", "bin/kv", "src/cli.js", "cli.js", "index.js", "src/kv.js"]
    for c in cands:
        if c and os.path.isfile(os.path.join(proj, c)): return os.path.join(proj, c), pkg
    return None, pkg

def grade_implements_from_plan(proj):
    import shutil, tempfile
    r = {}
    entry, pkg = find_cli(proj)
    deps = list((pkg.get("dependencies") or {}).keys())
    r["01"] = (bool(entry) and not deps, f"entry: {os.path.relpath(entry, proj) if entry else 'not found'}; dependencies: {deps or 'none'}")
    tmp = tempfile.mkdtemp(prefix="kv-grade-")
    work = os.path.join(tmp, "proj"); shutil.copytree(proj, work, ignore=shutil.ignore_patterns("node_modules"))
    cmd = ["npm", "test", "--silent"] if (pkg.get("scripts") or {}).get("test") else ["node", "--test"]
    try:
        t = subprocess.run(cmd, cwd=work, capture_output=True, text=True, timeout=180)
        out = (t.stdout + t.stderr)
        summ = [l for l in out.splitlines() if re.search(r"^# (tests|pass|fail)|^ℹ (tests|pass|fail)", l)]
        r["02"] = (t.returncode == 0, f"{' '.join(cmd)} exit {t.returncode}; {' | '.join(summ) or out.strip()[-200:]}")
    except subprocess.TimeoutExpired:
        r["02"] = (False, f"{' '.join(cmd)} timed out")
    base = load(f"{FIX_KV}/plan.json")
    ids = [o["id"] for i in base["interactions"] for o in i["outcomes"]]
    tests = ""
    for f in glob.glob(f"{proj}/**/*", recursive=True):
        rel = os.path.relpath(f, proj)
        if os.path.isfile(f) and "node_modules" not in rel and not rel.startswith("plan-graph") and re.search(r"test|spec", rel, re.I):
            tests += open(f, errors="replace").read()
    missing = [i for i in ids if i not in tests]
    r["03"] = (bool(tests) and not missing, f"{len(ids) - len(missing)}/{len(ids)} outcome ids in test files; missing: {missing or 'none'}")
    pp = f"{proj}/plan-graph/plan.json"; plan = load(pp)
    bad = []
    for kind, ref, x in items(plan):
        if kind not in ("surface", "interaction", "outcome"): continue
        m = x.get("meta", {})
        srcs = [s for s in (m.get("sources") or []) if os.path.isfile(os.path.join(proj, s.get("file", "")))]
        if m.get("built") not in ("yes", "partial") or not srcs: bad.append(ref)
    r["04"] = (not bad, f"items without built + existing source: {bad[:6] or 'none'}{' …' if len(bad) > 6 else ''}")
    ok, last = lint(pp)
    idx = {ref: x for _, ref, x in items(plan)}
    changed = []
    for _, ref, x in items(base):
        y = idx.get(ref)
        if y is None: changed.append(f"{ref} removed"); continue
        if own(y) != own(x) and not (y["meta"].get("status") == "proposed" and y["meta"].get("note")): changed.append(f"{ref} changed")
    r["05"] = (ok and not changed, f"lint: {last}; confirmed items changed silently: {changed or 'none'}")
    if entry:
        rel = os.path.relpath(entry, proj); e2 = os.path.join(work, rel)
        store = os.path.join(tmp, "store.json")
        def kv(*a):
            p = subprocess.run(["node", e2, *a], cwd=tmp, capture_output=True, text=True, timeout=20, env={**os.environ, "KV_FILE": store})
            return p.returncode, p.stdout, p.stderr
        probs = []
        c, o, e = kv("get", "nope")
        if not (c == 1 and "no such key" in e and o == ""): probs.append(f"get missing → {c}, out={o!r}, err={e.strip()!r}")
        c, o, e = kv("set", "Bad Key", "x")
        if c != 2: probs.append(f"set invalid key → exit {c}")
        c, o, e = kv("frob")
        if c != 2 or o: probs.append(f"unknown command → exit {c}, out={o!r}")
        kv("set", "b", "2"); kv("set", "a", "1")
        c, o, e = kv("list", "--json")
        try:
            j = json.loads(o)
            if list(j) != ["a", "b"] or c != 0: probs.append(f"list --json → {o.strip()!r}")
        except Exception: probs.append(f"list --json not JSON: {o.strip()!r}")
        if not os.path.exists(store): probs.append("KV_FILE not used")
        c, o, e = kv("get", "a")
        if (c, o) != (0, "1\n"): probs.append(f"get a → {c}, {o!r}")
        r["06"] = (not probs, f"problems: {probs or 'none'}")
    else:
        r["06"] = (False, "no CLI found")
    shutil.rmtree(tmp, ignore_errors=True)
    return r

FIX_PROP = f"{SKILL}/evals/proposes-chat-change"
def grade_proposes_chat_change(proj):
    import hashlib, tempfile
    r = {}
    fixture = f"{FIX_PROP}/files/plan-graph/plan.json"
    fixture_text = open(fixture, "rb").read()
    pp, prp = f"{proj}/plan-graph/plan.json", f"{proj}/plan-graph/proposal.json"
    prop = load(prp)
    base_hash = "sha256:" + hashlib.sha256(fixture_text).hexdigest()
    ops = (prop or {}).get("ops") or []
    shape = prop is not None and prop.get("id") and prop.get("title") and ops
    r["01"] = (bool(shape) and prop.get("base") == base_hash,
               "no proposal.json" if prop is None else f"id {prop.get('id')!r}; title {prop.get('title')!r}; {len(ops)} op(s); base matches: {prop.get('base') == base_hash}")
    untouched = os.path.exists(pp) and open(pp, "rb").read() == fixture_text
    left = [f for f in ("changeset.json", "changeset.applying.json") if os.path.exists(f"{proj}/plan-graph/{f}")]
    r["02"] = (untouched and not left, f"plan.json unchanged: {untouched}; leftover: {left or 'none'}")
    if not shape:
        for k in ("03", "04", "05", "06", "07"): r[k] = (False, "no usable proposal")
        return r

    out = tempfile.mktemp(suffix=".json")
    pr = subprocess.run(["node", "--experimental-strip-types", f"{FIX_PROP}/preview.ts", fixture, prp, out], capture_output=True, text=True)
    after = load(out)
    if pr.returncode != 0 or after is None:
        for k in ("03", "04"): r[k] = (False, f"preview failed: {(pr.stderr or pr.stdout).strip()[-200:]}")
    else:
        failed = pr.stdout.strip()
        base = load(fixture)
        bidx = {ref: x for _, ref, x in items(base)}
        left_alias = []
        for _, ref, x in items(after):
            if "alias" not in text_of(x): continue
            changed = ref not in bidx or own(x) != own(bidx[ref])
            if not (changed and x.get("meta", {}).get("note")): left_alias.append(ref)
        r["03"] = (not left_alias, f"alias items left untouched or without a note: {left_alias or 'none'}")
        ok, last = lint(out)
        r["04"] = (ok and not failed, f"lint: {last}; ops that failed to apply: {failed or 'none'}")
        os.unlink(out)

    bad = []
    for i, op in enumerate(ops):
        if op.get("op") == "add":
            m = op.get("value", {}).get("meta", {})
            if m.get("origin") != "agent" or m.get("status") != "proposed": bad.append(f"add {op['value'].get('id')}: {m.get('origin')}/{m.get('status')}")
        elif op.get("op") == "update" and op.get("ref") != "$plan":
            m = op.get("set", {}).get("meta") or {}
            if m.get("status") != "proposed" or not (m.get("note") or op.get("note")): bad.append(f"update {op.get('ref')}: no proposed status + note")
        elif op.get("op") == "remove" and not op.get("note"): bad.append(f"remove {op.get('ref')}: no note")
    r["05"] = (not bad, f"{bad[:5] or 'all flagged'}")

    qs = prop.get("questions") or []
    base_dec = {d["id"] for d in load(fixture)["decisions"]}
    dec_ops = [op for op in ops if (op.get("op") == "add" and op.get("kind") == "decision") or (op.get("op") in ("update", "remove") and op.get("ref") in base_dec)]
    r["06"] = (bool(dec_ops or qs), f"{len(dec_ops)} decision op(s), {len(qs)} question(s)")
    qbad = [q.get("id", "?") for q in qs if not q.get("id") or not q.get("question") or (q.get("recommended") and q.get("recommended") not in (q.get("options") or []))]
    r["07"] = (len(qs) <= 3 and not qbad, f"{len(qs)} question(s); malformed: {qbad or 'none'}")
    r["09"] = editor_url_check(proj)
    return r

def editor_url_check(proj):
    """The reply's editor URL must be one the trace shows serving this project's plan."""
    run = os.path.dirname(os.path.dirname(proj))
    reply = open(f"{run}/outputs/response.md").read() if os.path.exists(f"{run}/outputs/response.md") else ""
    ports = set(re.findall(r"localhost:(\d+)", reply))
    if not ports: return (False, "the reply gives no editor URL")
    seen, ours = "", set()
    if os.path.exists(f"{run}/trace.jsonl"):
        for l in open(f"{run}/trace.jsonl"):
            if '"tool_result"' in l: seen += l.replace("\\n", "\n")
            # A `serve --port N` the agent ran on this project's plan (its cwd is the project)
            # counts too: --strictPort means it only starts if N is free. Without --port, serve
            # may move to another port, so only its printed URL counts.
            for cmd in re.findall(r'"command":\s*"((?:[^"\\]|\\.)*plan\.ts serve(?:[^"\\]|\\.)*)"', l):
                m = re.search(r"--port\s+(\d+)", cmd)
                if m and "plan-graph/plan.json" in cmd: ours.add(m.group(1))
    plan = os.path.realpath(f"{proj}/plan-graph/plan.json")
    ours |= set(re.findall(r"(?:editor for this plan(?: is already running)?): http://localhost:(\d+)", seen))
    for m in re.finditer(r'localhost:(\d+)/api/status.{0,400}?\\?"planPath\\?":\s*\\?"([^"\\]+)', seen, re.S):
        if os.path.realpath(m.group(2)) == plan: ours.add(m.group(1))
    return (ports <= ours and bool(ours), f"reply names port(s) {sorted(ports)}; ports the trace shows serving this plan: {sorted(ours) or 'none'}")

def changed_files(left, right):
    out = []
    def walk(d, pre=""):
        out.extend(pre + f for f in d.diff_files + d.left_only + d.right_only if not (pre == "" and f == "plan-graph"))
        for k, sub in d.subdirs.items(): walk(sub, pre + k + "/")
    walk(filecmp.dircmp(left, right))
    return out

FIX_ORDERS = f"{SKILL}/evals/explains-orders-service/files/orders-service"

def plan_dir(proj, app):
    """The plan may sit next to the app (the project root) or inside it (the app is the project)."""
    return next((d for d in (f"{proj}/plan-graph", f"{app}/plan-graph") if os.path.exists(f"{d}/plan.json")), f"{proj}/plan-graph")

def grade_explains_orders_service(proj):
    pd = plan_dir(proj, f"{proj}/orders-service"); pp = f"{pd}/plan.json"; plan = load(pp)
    r = {}
    if plan is None or "surfaces" not in plan:
        r.update({k: NO_PLAN for k in ["01", "02", "03", "04"]})
    else:
        ok, last = lint(pp); profs = plan.get("profiles", [])
        r["01"] = (ok and plan.get("mode") == "retroactive" and "internals" in profs and "api" in profs, f"mode {plan.get('mode')}; profiles {profs}; lint: {last}")
        def blob(s):
            t = text_of(s) + " " + " ".join(text_of(i) for i in plan["interactions"] if i["from"].split("#")[0] == s["id"])
            return t + " " + " ".join(str(x.get("file", "")) for x in s.get("meta", {}).get("sources") or []).lower()
        internals = [(s.get("kind"), blob(s)) for s in plan["surfaces"] if s.get("profile") == "internals"]
        need = {"orders service": ({"module", "service"}, r"order"), "inventory": ({"module", "service"}, r"inventor|reserve"),
                "payments provider": ({"external"}, r"pay|charge"), "mail provider": ({"external"}, r"mail"),
                "order data": ({"table", "cache", "file-store"}, r"order"), "stock data": ({"table", "cache", "file-store"}, r"stock|inventor"),
                "queue": ({"queue"}, r"."), "confirmation job": ({"job"}, r"confirm|mail")}
        miss = [k for k, (kinds, rx) in need.items() if not any(kd in kinds and re.search(rx, t) for kd, t in internals)]
        r["02"] = (not miss, f"{len(internals)} internals surfaces; missing: {miss or 'none'}")
        helper = [s["id"] for s in plan["surfaces"] if (src := [str(x.get("file", "")) for x in s.get("meta", {}).get("sources") or []])
                  and all(re.search(r"util/money\.js|orders/validate\.js", f) for f in src)]
        r["03"] = (not helper, f"surfaces sourced only from helper files: {helper or 'none'}")
        idx = {i: x for _, i, x in items(plan)}
        def ref_text(ref):
            x = idx.get(ref) or idx.get(ref.split("#")[0])
            if x is None: return ""
            t = text_of(x)
            if "from" in x and x["from"].split("#")[0] in idx: t += " " + text_of(idx[x["from"].split("#")[0]])
            return t
        focus = load(f"{pd}/focus.json") or {}
        walks = [f for f in focus.get("items", []) if re.search(r"order", f.get("title", ""), re.I) and re.search(r"plac|new order|creat|checkout|submit|post /orders", f.get("title", ""), re.I)]
        steps = [("endpoint", r"post\s+/orders(?!/)|/orders\b(?!/).*post"), ("inventory", r"inventor|reserve|stock"), ("payment", r"charge|payment"), ("queue/job", r"queue|enqueue|confirm|job")]
        best = None
        for w in walks:
            texts = [ref_text(rf) for rf in w.get("refs") or []]
            pos, found = -1, []
            for name, rx in steps:
                nxt = next((k for k in range(pos + 1, len(texts)) if re.search(rx, texts[k])), None)
                if nxt is None: break
                pos = nxt; found.append(name)
            if best is None or len(found) > len(best[1]): best = (w["id"], found, len(texts))
        r["04"] = (bool(best) and len(best[1]) == len(steps), f"walkthroughs about placing an order: {[w['id'] for w in walks] or 'none'}; best {best}")
    changed = changed_files(FIX_ORDERS, f"{proj}/orders-service") if os.path.isdir(f"{proj}/orders-service") else ["orders-service/ missing"]
    r["08"] = (not changed, f"changed/added/removed: {changed or 'none'}")
    return r

FIX_INV = f"{SKILL}/evals/simplifies-invoices-api"

def test_files(app):
    out = []
    for f in glob.glob(f"{app}/**/*", recursive=True):
        rel = os.path.relpath(f, app)
        if "node_modules" in rel or rel.startswith("plan-graph/") or not os.path.isfile(f) or not re.search(r"\.(m?js|ts)$", f): continue
        if re.search(r"(^|/)(tests?|__tests__)/", rel) or re.search(r"[.-](test|spec)\.(m?js|ts)$", rel): out.append(rel)
    return sorted(out)

def node_test(cwd, files, env=None):
    try:
        r = subprocess.run(["node", "--test", *files], cwd=cwd, capture_output=True, text=True, timeout=180, env={**os.environ, **(env or {})})
    except subprocess.TimeoutExpired:
        return False, "timed out"
    m = re.findall(r"ℹ (tests|pass|fail) (\d+)", r.stdout)
    return r.returncode == 0, (" ".join(f"{k} {v}" for k, v in m) or (r.stdout + r.stderr)[-200:]).strip()

def grade_simplifies_invoices_api(proj):
    import shutil, tempfile
    app = f"{proj}/invoices-api"; r = {}
    tests = test_files(app) if os.path.isdir(app) else []
    if not tests:
        r["01"] = r["02"] = (False, "no test files in invoices-api/")
    else:
        tmp = tempfile.mkdtemp(prefix="inv-grade-")
        orig = os.path.join(tmp, "invoices-api"); shutil.copytree(f"{FIX_INV}/files/invoices-api", orig)
        for t in tests:
            os.makedirs(os.path.dirname(os.path.join(orig, t)), exist_ok=True); shutil.copy(os.path.join(app, t), os.path.join(orig, t))
        ok, ev = node_test(orig, tests); r["01"] = (ok, f"{tests} on the original code: {ev}")
        shutil.rmtree(tmp, ignore_errors=True)
        ok, ev = node_test(app, tests); r["02"] = (ok, f"on the simplified code: {ev}")
    ok, ev = node_test(FIX_INV, ["acceptance.test.mjs"], {"APP_DIR": app}); r["03"] = (ok, f"acceptance: {ev}")
    srcs = [f for f in glob.glob(f"{app}/**/*.*js", recursive=True) if "node_modules" not in f and os.path.relpath(f, app) not in tests]
    hits = [(os.path.relpath(f, app), len(re.findall(r"TAX_RATE\s*\*|\*\s*TAX_RATE|\*\s*0?\.08\b", open(f).read()))) for f in srcs]
    hits = [h for h in hits if h[1]]
    r["04"] = (sum(n for _, n in hits) == 1, f"tax calculations: {hits or 'none'}")
    gone = {f: not os.path.exists(f"{app}/lib/{f}") for f in ("legacyFormat.js", "invoiceService.js")}
    r["05"] = (all(gone.values()), f"removed: {gone}")
    pp = f"{plan_dir(proj, app)}/plan.json"; plan = load(pp)
    if plan is None: r["06"] = NO_PLAN
    else:
        ok, last = lint(pp)
        stale = sorted({str(x.get("file")) for _, _, it in items(plan) for x in (it.get("meta", {}).get("sources") or [])
                        if x.get("file") and not any(os.path.exists(os.path.join(b, x["file"])) for b in (proj, app))})
        r["06"] = (ok and not stale, f"lint: {last}; sources citing missing files: {stale or 'none'}")
    return r

GRADERS = {"plans-new-web-app": grade_plans_new_web_app, "documents-existing-notes-app": grade_documents_existing_notes_app, "applies-gui-changeset": grade_applies_gui_changeset, "implements-from-plan": grade_implements_from_plan, "proposes-chat-change": grade_proposes_chat_change, "explains-orders-service": grade_explains_orders_service, "simplifies-invoices-api": grade_simplifies_invoices_api}

for case, fn in GRADERS.items():
    if not os.path.exists(f"{IT}/{case}/eval_metadata.json"): continue
    meta = json.load(open(f"{IT}/{case}/eval_metadata.json"))
    graders = sorted(os.listdir(f"{SKILL}/evals/{case}/graders"))
    for cfg in ("with_skill", "old_skill", "without_skill"):
        run = f"{IT}/{case}/{cfg}"
        if not os.path.exists(f"{run}/outputs/response.md"): continue
        auto = fn(f"{run}/outputs/project")
        exps = []
        for g, text in zip(graders, meta["assertions"]):
            k = g[:2]
            if k in manual.get(case, {}).get(cfg, {}): passed, ev = manual[case][cfg][k]
            elif k in auto: passed, ev = auto[k]
            elif k in manual.get(case, {}).get(cfg, {}): passed, ev = manual[case][cfg][k]
            else: passed, ev = False, "NOT GRADED YET"
            exps.append({"text": text, "passed": bool(passed), "evidence": ev})
        n = sum(e["passed"] for e in exps)
        json.dump({"expectations": exps, "summary": {"passed": n, "failed": len(exps) - n, "total": len(exps), "pass_rate": round(n / len(exps), 2)}},
                  open(f"{run}/grading.json", "w"), indent=2)
        print(f"{case:30} {cfg:14} {n}/{len(exps)}")
        for e in exps:
            if not e["passed"]: print(f"    ✗ {e['text'][:70]} — {e['evidence'][:110]}")
