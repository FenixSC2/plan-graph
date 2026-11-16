// Server API: the bridge between the GUI and the agent. Mounted on both the dev server
// (`npm run dev`) and the production preview server (`plan.ts serve`).
//   GET  /api/plan       → { plan, hash, profiles, planPath }
//   GET  /api/status     → { hash, changesetPending, agentWorking, proposalId }
//   GET  /api/proposal   → { proposal } — the agent's pending proposal (proposal.json), or null
//   POST /api/changeset  → writes changeset.json next to plan.json
// The agent renames changeset.json to changeset.applying.json while it works (so the GUI
// neither adopts a half-finished plan nor sends again), then deletes it when done.
import type { Connect, Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function planApi(opts: { planPath: string; profilesDir: string }): Plugin {
  const changesetPath = path.join(path.dirname(opts.planPath), "changeset.json");
  const applyingPath = path.join(path.dirname(opts.planPath), "changeset.applying.json");
  const proposalPath = path.join(path.dirname(opts.planPath), "proposal.json");
  const readProposal = () => {
    try { return fs.existsSync(proposalPath) ? JSON.parse(fs.readFileSync(proposalPath, "utf8")) : null; }
    catch { return null; } // mid-write or malformed: treat as absent until the next poll
  };
  const hashOf = (text: string) => "sha256:" + crypto.createHash("sha256").update(text).digest("hex");
  const readPlanText = () => fs.readFileSync(opts.planPath, "utf8");

  // /api/status is polled every 1.5 s: hash the file only when it changed on disk.
  let cached: { mtimeMs: number; size: number; hash: string } | null = null;
  const currentHash = () => {
    const st = fs.statSync(opts.planPath);
    if (!cached || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size) {
      cached = { mtimeMs: st.mtimeMs, size: st.size, hash: hashOf(readPlanText()) };
    }
    return cached.hash;
  };

  const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  };

  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    const url = req.url?.split("?")[0];
    try {
      if (req.method === "GET" && url === "/api/plan") {
        const text = readPlanText();
        const plan = JSON.parse(text);
        const profiles: Record<string, unknown> = {};
        for (const id of plan.profiles ?? []) {
          const p = path.join(opts.profilesDir, `${id}.json`);
          if (fs.existsSync(p)) profiles[id] = JSON.parse(fs.readFileSync(p, "utf8"));
        }
        return json(res, 200, { plan, hash: hashOf(text), profiles, planPath: opts.planPath });
      }
      if (req.method === "GET" && url === "/api/status") {
        const agentWorking = fs.existsSync(applyingPath);
        return json(res, 200, {
          hash: currentHash(),
          changesetPending: agentWorking || fs.existsSync(changesetPath),
          agentWorking,
          proposalId: readProposal()?.id ?? null,
        });
      }
      if (req.method === "GET" && url === "/api/proposal") {
        return json(res, 200, { proposal: readProposal() });
      }
      if (req.method === "POST" && url === "/api/changeset") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const changeset = JSON.parse(body);
        if (!Array.isArray(changeset.ops) || typeof changeset.base !== "string") {
          return json(res, 400, { error: "invalid changeset" });
        }
        if (fs.existsSync(applyingPath)) {
          return json(res, 423, { error: "The agent is still applying your last send. Keep editing; send again once it's done." });
        }
        const current = hashOf(readPlanText());
        if (changeset.base !== current) {
          return json(res, 409, { error: "plan.json changed since you loaded it", hash: current });
        }
        fs.writeFileSync(changesetPath, JSON.stringify(changeset, null, 2) + "\n");
        return json(res, 200, { path: changesetPath });
      }
    } catch (e) {
      return json(res, 500, { error: String(e) });
    }
    next();
  };

  return {
    name: "plan-api",
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}
