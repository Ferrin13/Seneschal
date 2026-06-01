import Fastify from "fastify";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { config } from "./config.js";
import { authPlugin } from "./auth/middleware.js";
import { meRoutes } from "./routes/me.js";
import { categoryRoutes } from "./routes/categories.js";
import { activityRoutes } from "./routes/activities.js";
import { slotRoutes } from "./routes/slots.js";
import { timerRoutes } from "./routes/timer.js";
import { businessRoutes } from "./routes/businesses.js";
import { expenseRoutes } from "./routes/expenses.js";
import { messageTemplateRoutes } from "./routes/messageTemplates.js";
import { groupRoutes } from "./routes/groups.js";
import { groupMemberRoutes } from "./routes/groupMembers.js";
import { uploadRoutes } from "./routes/uploads.js";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty" } }
        : {}),
    },
    trustProxy: true,
  });

  await app.register(sensible);
  if (config.CORS_ORIGINS.length > 0) {
    await app.register(cors, { origin: config.CORS_ORIGINS });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      req.log.warn({ issues: err.issues }, "validation_failed");
      return reply
        .code(400)
        .send({ error: "validation_failed", issues: err.issues });
    }
    req.log.error({ err }, "request failed");
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode ?? 500;
    return reply
      .code(status)
      .send({ error: e.message || "internal_error" });
  });

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async () => ({ status: "ok" }));

  await app.register(authPlugin);
  await app.register(meRoutes);
  await app.register(categoryRoutes);
  await app.register(activityRoutes);
  await app.register(slotRoutes);
  await app.register(timerRoutes);
  await app.register(businessRoutes);
  await app.register(expenseRoutes);
  await app.register(messageTemplateRoutes);
  await app.register(groupRoutes);
  await app.register(groupMemberRoutes);
  await app.register(uploadRoutes);

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  void main();
} else if (process.argv[1] && process.argv[1].endsWith("index.js")) {
  void main();
}
