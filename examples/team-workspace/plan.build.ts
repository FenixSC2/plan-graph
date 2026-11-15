// Regenerates examples/team-workspace/plan.json, a larger example (web + API + CLI, seven
// groups) that shows how big plans read in the editor: the group map, regions, the Map tab.
//   node --experimental-strip-types examples/team-workspace/plan.build.ts
import path from "node:path";
import { create } from "../../scripts/build.ts";

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "plan.json");
const p = create({
  name: "Team Workspace",
  summary: "A small project tracker for teams: projects, a task board, invites, billing, and an admin CLI. Web app on a JSON API.",
  profiles: ["web", "api", "cli"],
});

const confirmed = { origin: "agent", status: "confirmed" } as const;
const proposed = { origin: "agent", status: "proposed" } as const;

// ── helpers ────────────────────────────────────────────────────────────────
type Opts = { states?: (string | [string, string])[]; elements?: [string, string, string][]; kind?: string };
const page = (id: string, name: string, address: string, group: string, o: Opts = {}) =>
  p.surface({ id, profile: "web", kind: o.kind ?? "page", name, address, group, states: o.states, elements: o.elements });
const modal = (id: string, name: string, group: string, o: Opts = {}) =>
  p.surface({ id, profile: "web", kind: "modal", name, group, states: o.states, elements: o.elements });
const endpoint = (id: string, name: string, address: string, group: string, cases: [string, string, string][], kind = "endpoint") => {
  p.surface({ id, profile: "api", kind, name, address, group });
  p.interaction(`${id}.request`, id, ["request", address], cases.map(([c, when, result]) => [c, when, null, result] as [string, string, null, string]));
};
const cmd = (id: string, name: string, address: string, group: string, cases: [string, string, string][], calls?: string) => {
  p.surface({ id, profile: "cli", kind: "command", name, address, group, terminal: true });
  p.interaction(`${id}.invoke`, id, ["invoke", `Run ${address}`], cases.map(([c, when, result]) => [c, when, null, result] as [string, string, null, string]), calls ? { calls: [calls] } : {});
};
const nav = (id: string, from: string, label: string, to: string) =>
  p.interaction(id, from, ["click", label], [["go", "always", to]]);
/** A form that calls an API endpoint: success goes somewhere, failures stay on the form. */
const form = (id: string, from: string, label: string, api: string, ok: [string, string?], invalid: string) =>
  p.interaction(id, from, ["submit", label], [
    ["ok", "API returns 2xx", ok[0], ok[1]],
    ["invalid", "API returns 400", `${from}#error`, invalid],
    ["failed", "Network error or 5xx", `${from}#error`, "“Something went wrong, try again”"],
  ], { calls: [`${api}.request`] });
const loads = (id: string, from: string, api: string, what: string) =>
  p.interaction(id, from, ["on-enter", "Page opens"], [
    ["ready", `Has ${what}`, `${from}#ready`],
    ["empty", `No ${what} yet`, `${from}#empty`],
    ["error", "Request fails", `${from}#error`, "Inline error with Retry"],
  ], { calls: [`${api}.request`] });
const DATA = ["loading", "ready", "empty", "error"];
const FORM = ["idle", "submitting", "error"];

// ── groups ─────────────────────────────────────────────────────────────────
p.defaults(confirmed);
p.group("g.auth", "Auth", "Signing up, signing in, and getting back into an account");
p.group("g.onboarding", "Onboarding", "First run: create a workspace and invite the team");
p.group("g.projects", "Projects", "Listing, creating and configuring projects");
p.group("g.tasks", "Task board", "The board where work happens: columns, tasks, comments");
p.group("g.notifications", "Notifications", "In-app and email notifications about tasks");
p.group("g.billing", "Billing", "Plans, checkout and the billing portal");
p.group("g.admin", "Admin", "Staff tools: user management on the web and in the CLI");

// ── Auth (reviewed) ────────────────────────────────────────────────────────
page("web.sign-in", "Sign in", "/sign-in", "g.auth", { states: FORM, elements: [["web.sign-in.email", "input", "Email"], ["web.sign-in.password", "input", "Password"]] });
page("web.sign-up", "Sign up", "/sign-up", "g.auth", { states: FORM });
page("web.reset", "Reset password", "/reset", "g.auth", { states: [...FORM, "sent"] });
page("web.verify", "Verify email", "/verify/:token", "g.auth", { states: ["checking", "expired"] });
endpoint("api.session", "Create session", "POST /api/session", "g.auth", [["ok", "Email and password match", "200 { token }"], ["invalid", "Wrong email or password", "401 { error: { code: \"bad_credentials\" } }"], ["locked", "5 failures in 15 min", "429 with Retry-After"]]);
endpoint("api.signup", "Create account", "POST /api/users", "g.auth", [["ok", "Email unused", "201 { user }"], ["taken", "Email already registered", "409 { error: { code: \"email_taken\" } }"], ["invalid", "Weak password or bad email", "400 { error: { field } }"]]);
endpoint("api.reset", "Send reset email", "POST /api/password-resets", "g.auth", [["ok", "Always (no account enumeration)", "202"], ["limited", "More than 3 an hour", "429"]]);
form("web.sign-in.submit", "web.sign-in", "Click Sign in", "api.session", ["web.projects"], "“Email or password is wrong”");
nav("web.sign-in.to-reset", "web.sign-in", "Forgot password?", "web.reset");
nav("web.sign-in.to-sign-up", "web.sign-in", "Create an account", "web.sign-up");
form("web.sign-up.submit", "web.sign-up", "Click Create account", "api.signup", ["web.verify"], "Field errors under each input");
form("web.reset.submit", "web.reset", "Click Send link", "api.reset", ["web.reset#sent", "“Check your email”"], "“Enter a valid email”");
p.interaction("web.verify.check", "web.verify", ["on-enter", "Page opens with the token"], [["ok", "Token valid", "web.welcome"], ["expired", "Token older than 24h", "web.verify#expired", "Offer to resend"]]);

// ── Onboarding (reviewed) ──────────────────────────────────────────────────
page("web.welcome", "Welcome", "/welcome", "g.onboarding");
page("web.new-workspace", "Create workspace", "/welcome/workspace", "g.onboarding", { states: FORM });
page("web.invite", "Invite your team", "/welcome/invite", "g.onboarding", { states: [...FORM, "sent"] });
endpoint("api.workspaces.create", "Create workspace", "POST /api/workspaces", "g.onboarding", [["ok", "Name free", "201 { workspace }"], ["taken", "Slug in use", "409"]]);
endpoint("api.invites.create", "Send invites", "POST /api/invites", "g.onboarding", [["ok", "All emails valid", "202 { sent }"], ["invalid", "Any email invalid", "400 { error: { field: \"emails\" } }"]]);
nav("web.welcome.start", "web.welcome", "Get started", "web.new-workspace");
form("web.new-workspace.submit", "web.new-workspace", "Click Create", "api.workspaces.create", ["web.invite"], "“That name is taken”");
form("web.invite.submit", "web.invite", "Click Send invites", "api.invites.create", ["web.projects", "Toast: “Invites sent”"], "Highlights the bad email");
nav("web.invite.skip", "web.invite", "Skip for now", "web.projects");

// ── Projects (partly reviewed) ─────────────────────────────────────────────
page("web.projects", "Projects", "/projects", "g.projects", { states: DATA });
modal("web.new-project", "New project", "g.projects", { states: FORM });
page("web.project-settings", "Project settings", "/projects/:id/settings", "g.projects", { states: FORM });
modal("web.delete-project", "Delete project?", "g.projects", { states: ["idle", "deleting", "error"] });
endpoint("api.projects.list", "List projects", "GET /api/projects", "g.projects", [["ok", "Signed in", "200 { projects, nextCursor }"], ["unauth", "No session", "401"]]);
endpoint("api.projects.create", "Create project", "POST /api/projects", "g.projects", [["ok", "Name valid", "201 { project }"], ["invalid", "Empty or > 80 chars", "400"]]);
p.defaults(proposed);
endpoint("api.projects.update", "Update project", "PATCH /api/projects/:id", "g.projects", [["ok", "Caller is an owner", "200 { project }"], ["forbidden", "Caller is a member", "403"], ["missing", "No such project", "404"]]);
endpoint("api.projects.delete", "Delete project", "DELETE /api/projects/:id", "g.projects", [["ok", "Caller is an owner", "204; tasks deleted after 30 days"], ["forbidden", "Caller is a member", "403"]]);
p.defaults(confirmed);
loads("web.projects.load", "web.projects", "api.projects.list", "projects");
nav("web.projects.new", "web.projects", "New project", "web.new-project");
nav("web.projects.open", "web.projects", "Click a project card", "web.board");
form("web.new-project.submit", "web.new-project", "Click Create", "api.projects.create", ["web.board"], "“Give the project a name”");
p.defaults(proposed);
form("web.project-settings.save", "web.project-settings", "Click Save", "api.projects.update", ["web.project-settings", "Toast: “Saved”"], "Field error");
nav("web.project-settings.delete", "web.project-settings", "Delete project…", "web.delete-project");
form("web.delete-project.confirm", "web.delete-project", "Type the name and click Delete", "api.projects.delete", ["web.projects", "Toast with Undo for 10s"], "“Only owners can delete”");

// ── Task board (mostly proposed) ───────────────────────────────────────────
page("web.board", "Board", "/projects/:id", "g.tasks", { states: DATA });
page("web.task", "Task", "/projects/:id/tasks/:task", "g.tasks", { states: DATA, kind: "drawer" });
modal("web.new-task", "New task", "g.tasks", { states: FORM });
endpoint("api.tasks.list", "List tasks", "GET /api/projects/:id/tasks", "g.tasks", [["ok", "Member of project", "200 { tasks }"], ["forbidden", "Not a member", "403"]]);
endpoint("api.tasks.create", "Create task", "POST /api/projects/:id/tasks", "g.tasks", [["ok", "Title present", "201 { task }"], ["invalid", "No title", "400"]]);
endpoint("api.tasks.update", "Update task", "PATCH /api/tasks/:id", "g.tasks", [["ok", "Valid change", "200 { task }"], ["conflict", "Edited by someone else since load", "409 { current }"], ["missing", "Task deleted", "404"]]);
endpoint("api.comments.create", "Add comment", "POST /api/tasks/:id/comments", "g.tasks", [["ok", "Body present", "201 { comment }"], ["invalid", "Empty", "400"]]);
loads("web.board.load", "web.board", "api.tasks.list", "tasks");
nav("web.board.new", "web.board", "Add task", "web.new-task");
nav("web.board.open", "web.board", "Click a task card", "web.task");
nav("web.board.settings", "web.board", "Project settings", "web.project-settings");
p.interaction("web.board.drag", "web.board", ["change", "Drag a card to another column"], [
  ["ok", "API returns 200", "web.board#ready", "Card stays in the new column"],
  ["conflict", "API returns 409", "web.board#ready", "Card snaps back; toast “Someone else moved this”"],
], { calls: ["api.tasks.update.request"] });
form("web.new-task.submit", "web.new-task", "Click Add", "api.tasks.create", ["web.board", "Card appears at the top of To do"], "“Give the task a title”");
form("web.task.comment", "web.task", "Click Comment", "api.comments.create", ["web.task#ready", "Comment appended"], "Nothing to send");
nav("web.task.close", "web.task", "Close (Esc)", "web.board");

// ── Notifications (sketchy) ────────────────────────────────────────────────
page("web.notifications", "Notifications", "/notifications", "g.notifications", { states: DATA });
endpoint("api.notifications.list", "List notifications", "GET /api/notifications", "g.notifications", [["ok", "Signed in", "200 { items, unread }"], ["unauth", "No session", "401"]]);
endpoint("api.notifications.read", "Mark read", "POST /api/notifications/read", "g.notifications", [["ok", "Ids belong to caller", "204"], ["invalid", "Unknown ids", "400"]]);
p.surface({ id: "web.email-digest", profile: "web", kind: "page", name: "Daily email digest", group: "g.notifications", meta: { origin: "user", status: "sketch" }, note: "A daily email summarising task changes. Agent: fill this in." });
loads("web.notifications.load", "web.notifications", "api.notifications.list", "notifications");
form("web.notifications.mark", "web.notifications", "Mark all read", "api.notifications.read", ["web.notifications#ready"], "Inline error");
nav("web.notifications.open", "web.notifications", "Click a notification", "web.task");
nav("web.board.bell", "web.board", "Bell icon", "web.notifications");

// ── Billing (proposed) ─────────────────────────────────────────────────────
page("web.billing", "Billing", "/settings/billing", "g.billing", { states: DATA });
page("web.plans", "Choose a plan", "/settings/billing/plans", "g.billing");
page("web.checkout-done", "Checkout complete", "/settings/billing/done", "g.billing", { states: ["confirming", "active", "pending"] });
endpoint("api.billing.summary", "Billing summary", "GET /api/billing", "g.billing", [["ok", "Caller is an owner", "200 { plan, seats, nextInvoice }"], ["forbidden", "Not an owner", "403"]]);
endpoint("api.billing.checkout", "Start checkout", "POST /api/billing/checkout", "g.billing", [["ok", "Plan exists", "303 to the payment provider"], ["invalid", "Unknown plan", "400"]]);
endpoint("api.billing.webhook", "Payment webhook", "POST /webhooks/payments", "g.billing", [["ok", "Signature valid", "200; plan updated"], ["bad-signature", "Signature invalid", "400; nothing changes"]], "webhook");
loads("web.billing.load", "web.billing", "api.billing.summary", "a paid plan");
nav("web.billing.change", "web.billing", "Change plan", "web.plans");
p.interaction("web.plans.choose", "web.plans", ["click", "Choose a plan"], [
  ["ok", "API returns 303", "web.checkout-done", "After paying, the provider redirects back"],
  ["failed", "API error", "web.plans", "Toast: “Couldn't start checkout”"],
], { calls: ["api.billing.checkout.request"] });
nav("web.checkout-done.back", "web.checkout-done", "Back to billing", "web.billing");

// ── Admin (CLI + web) ──────────────────────────────────────────────────────
page("web.admin-users", "Admin: users", "/admin/users", "g.admin", { states: DATA });
endpoint("api.admin.users", "Search users", "GET /api/admin/users?q=", "g.admin", [["ok", "Caller is staff", "200 { users }"], ["forbidden", "Not staff", "404 (hidden)"]]);
endpoint("api.admin.suspend", "Suspend user", "POST /api/admin/users/:id/suspend", "g.admin", [["ok", "Caller is staff", "204; sessions revoked"], ["missing", "No such user", "404"]]);
loads("web.admin-users.load", "web.admin-users", "api.admin.users", "users");
form("web.admin-users.suspend", "web.admin-users", "Click Suspend and confirm", "api.admin.suspend", ["web.admin-users#ready", "Row shows Suspended"], "Inline error");
cmd("cli.users", "tw users", "tw users <query> [--json]", "g.admin", [["ok", "API returns 200", "exit 0; table or JSON on stdout"], ["auth", "No TW_TOKEN", "exit 2; stderr: “set TW_TOKEN”"], ["failed", "API unreachable", "exit 3"]], "api.admin.users.request");
cmd("cli.suspend", "tw suspend", "tw suspend <user-id> [--yes]", "g.admin", [["ok", "Confirmed and API returns 204", "exit 0"], ["aborted", "Answer no at the prompt", "exit 1; nothing changes"], ["missing", "API returns 404", "exit 1; stderr: “no such user”"]], "api.admin.suspend.request");
cmd("cli.export", "tw export", "tw export <workspace> > out.json", "g.admin", [["ok", "Workspace exists", "exit 0; JSON on stdout"], ["missing", "No such workspace", "exit 1"]]);

p.entry("web.sign-in", "web.sign-up", "web.verify", "cli.users", "cli.suspend", "cli.export", "api.billing.webhook", "web.admin-users");

// ── decisions ──────────────────────────────────────────────────────────────
const D = (id: string, attachedTo: string[], question: string, value: string, alternatives: string[], rationale: string, impact: "low" | "medium" | "high", checklistKey?: string) =>
  p.decision({ id, attachedTo, question, value, alternatives, rationale, impact, ...(checklistKey ? { checklistKey } : {}) });
p.defaults(confirmed);
D("d.auth", [], "How do users authenticate?", "Email + password, session token in an httpOnly cookie; staff flag for admin routes", ["Magic links only", "SSO only"], "Simplest thing teams expect.", "high", "auth");
D("d.error-shape", [], "API error body shape?", "{ error: { code, message, field? } }", ["RFC 7807 problem+json"], "Field errors map straight onto inputs.", "medium", "error-shape");
p.defaults(proposed);
D("d.delete-project", ["web.delete-project"], "What happens to a deleted project's tasks?", "Soft-deleted; restorable for 30 days, then purged", ["Deleted immediately", "Archived forever"], "Undo for mistakes without keeping data forever.", "high");
D("d.board-conflicts", ["web.board.drag"], "Two people move the same card: who wins?", "First write wins; the second gets 409 and the card snaps back", ["Last write wins silently", "Real-time sync so it can't happen"], "Never lose a move without telling someone.", "high");
D("d.pagination", ["api.projects.list"], "How do list endpoints paginate?", "Cursor-based, 50 per page", ["Offset/limit"], "Stable under inserts.", "medium", "pagination");
D("d.seats", ["web.billing"], "How are seats billed?", "Per active member per month, prorated", ["Flat per workspace"], "Matches how teams grow.", "medium");
D("d.admin-hidden", ["api.admin.users"], "What do non-staff get from admin routes?", "404, as if they don't exist", ["403"], "Don't advertise admin routes.", "low");

p.save(OUT);
