import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";

/**
 * Current account. Besides the profile row this is where clients learn what
 * they may show: `features` drives which product tabs render and `isAdmin`
 * reveals the Admin tab. The server enforces both independently of this.
 */
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
      isAdmin: req.auth.isAdmin,
      features: req.auth.features,
    };
  });
};
