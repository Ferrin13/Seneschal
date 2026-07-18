import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { userSettings } from "../db/schema.js";
import {
  MODEL_STEPS,
  MODEL_STEP_META,
  defaultModels,
  getModelOverrides,
  sanitizeOverrides,
  type ModelStep,
} from "../marketplace/modelSettings.js";
import {
  getNotificationPrefs,
  sanitizeNotificationPrefs,
} from "../marketplace/notificationSettings.js";

function modelSettingsPayload(overrides: Awaited<ReturnType<typeof getModelOverrides>>) {
  const defaults = defaultModels();
  return {
    steps: MODEL_STEPS.map((step) => ({
      step,
      label: MODEL_STEP_META[step].label,
      description: MODEL_STEP_META[step].description,
      default: defaults[step],
      model: overrides[step] ?? null,
    })),
  };
}

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  /** Current per-step model configuration (overrides + server defaults). */
  app.get("/settings/models", async (req) => {
    const overrides = await getModelOverrides(req.auth.userId);
    return modelSettingsPayload(overrides);
  });

  /**
   * Replace the per-step model overrides. Send `null`/empty for a step to
   * clear it (falls back to the server default).
   */
  app.put("/settings/models", async (req) => {
    const body = z
      .object({
        overrides: z.record(z.string(), z.string().max(200).nullable()),
      })
      .parse(req.body);

    const clean = sanitizeOverrides(body.overrides) as Record<ModelStep, string>;
    const now = new Date();
    await db
      .insert(userSettings)
      .values({ userId: req.auth.userId, modelOverrides: clean, updatedAt: now })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { modelOverrides: clean, updatedAt: now },
      });

    return modelSettingsPayload(await getModelOverrides(req.auth.userId));
  });

  /** The user's browser-notification preferences (deal thresholds + targets). */
  app.get("/settings/notifications", async (req) => {
    return getNotificationPrefs(req.auth.userId);
  });

  /** Replace the user's browser-notification preferences. */
  app.put("/settings/notifications", async (req) => {
    const body = z
      .object({
        enabled: z.boolean(),
        minDealScore: z.number().min(0).max(100),
        minValueScore: z.number().min(0).max(100),
        maxPriceCents: z.number().int().min(0).nullable(),
        targetIds: z.array(z.string()).nullable(),
      })
      .parse(req.body);

    const clean = sanitizeNotificationPrefs(body);
    const now = new Date();
    await db
      .insert(userSettings)
      .values({
        userId: req.auth.userId,
        notificationPrefs: clean,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { notificationPrefs: clean, updatedAt: now },
      });

    return getNotificationPrefs(req.auth.userId);
  });
};
