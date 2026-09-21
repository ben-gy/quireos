// QuireOS store Worker. Routes:
//   /api/v1/*         device API (spec §9)              → src/api.ts
//   /a/:slug/:ver/*   hosted bundle files, /icons/*     → src/bundles.ts
//   everything else   developer web UI                  → src/web.tsx
import { Hono } from "hono";
import api from "./api";
import { sessionMiddleware } from "./auth";
import files from "./bundles";
import type { Env } from "./env";
import web from "./web";

const app = new Hono<Env>();

app.onError((err, c) => {
  console.error(`${c.req.method} ${new URL(c.req.url).pathname}: ${err.message}`);
  if (c.req.path.startsWith("/api/")) return c.json({ spec_version: 1, error: { code: "internal", message: "Internal error" } }, 500);
  return c.text("Something went wrong.", 500);
});

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ spec_version: 1, error: { code: "not_found", message: "No such endpoint" } }, 404);
  return c.text("Not found", 404);
});

app.route("/api/v1", api);
app.use("/a/*", sessionMiddleware); // lets the owner's browser session read private bundles
app.route("/", files);
app.route("/", web);

export default app;
