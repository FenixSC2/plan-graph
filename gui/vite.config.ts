import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { planApi } from "./planApi.ts";

// PLAN: path to plan.json (relative to the repo root). PROFILES: profiles directory.
const repoRoot = path.resolve(import.meta.dirname, "..");
const planPath = path.resolve(repoRoot, process.env.PLAN ?? "examples/link-shortener/plan.json");
const profilesDir = path.resolve(repoRoot, process.env.PROFILES ?? "profiles");

export default defineConfig({
  plugins: [react(), planApi({ planPath, profilesDir })],
  server: { port: Number(process.env.PORT ?? 5199), fs: { allow: [repoRoot] } },
  preview: { port: Number(process.env.PORT ?? 5199) },
});
