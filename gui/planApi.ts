// Dev-server API: the bridge between the GUI and the agent.
//   GET  /api/plan       → { plan, hash, profiles, planPath }
//   GET  /api/status     → { hash, changesetPending }
//   POST /api/changeset  → writes changeset.json next to plan.json
// The agent renames changeset.json to changeset.applying.json while it works (so the GUI
// neither adopts a half-finished plan nor sends again), then deletes it when done.
import type { Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function planApi(opts: { planPath: string; profilesDir: string }): Plugin {
  const changesetPath = path.join(path.dirname(opts.planPath), "changeset.json");
  const applyingPath = path.join(path.dirname(opts.planPath), "changeset.applying.json");
  const hashOf = (text: string) => "sha256:" + crypto.createHash("sha256").update(text).digest("hex");
  const readPlanText = () => fs.readFileSync(opts.planPath, "utf8");

  const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  };

  return {
    name: "plan-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
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
              hash: hashOf(readPlanText()),
              changesetPending: agentWorking || fs.existsSync(changesetPath),
              agentWorking,
            });
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
      });
    },
  };
}
