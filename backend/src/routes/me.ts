import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", async (req) => {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.auth.userId))
      .limit(1);
    return {
      id: row!.id,
      email: row!.email,
      displayName: row!.displayName,
      createdAt: row!.createdAt.toISOString(),
    };
  });
};
