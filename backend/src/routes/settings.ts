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
};
