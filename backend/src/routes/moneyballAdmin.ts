import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { GENDERS, type Gender } from "../moneyball/engine.js";
import {
  createPlayer,
  deletePlayer,
  listPlayersAdmin,
  updatePlayer,
  uploadPlayerPhoto,
} from "../moneyball/admin.js";
import { MAX_PHOTO_BYTES, PHOTO_CONTENT_TYPES } from "../moneyball/photos.js";
import { MoneyballError } from "../moneyball/service.js";

/**
 * Raw player CRUD for admins. Lives under `/admin/...` so the auth middleware
 * requires the admin flag (auth/access.ts ADMIN_PREFIXES) — no feature check,
 * since an admin fixing the roster needn't have Moneyball enabled for
 * themselves.
 */

const idParams = z.object({ id: z.string().uuid() });

const genderSchema = z
  .union([z.enum(GENDERS as unknown as [Gender, ...Gender[]]), z.null()])
  .optional();

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === "" ? null : s))
    .nullable();

const playerBody = z.object({
  slug: z.string().trim().max(120).default(""),
  name: z.string().trim().min(1).max(200),
  photoUrl: nullableText(2048).default(null),
  team: nullableText(200).default(null),
  gender: genderSchema.default(null),
  number: z.number().int().min(0).max(999).nullable().default(null),
  active: z.boolean().default(true),
});

const playerPatch = z
  .object({
    slug: z.string().trim().max(120).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    photoUrl: nullableText(2048).optional(),
    team: nullableText(200).optional(),
    gender: genderSchema,
    number: z.number().int().min(0).max(999).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "nothing to update" });

const photoBody = z.object({
  contentType: z.string().refine((v) => v in PHOTO_CONTENT_TYPES, {
    message: `contentType must be one of ${Object.keys(PHOTO_CONTENT_TYPES).join(", ")}`,
  }),
  /** Raw base64 (no data: prefix). */
  dataBase64: z.string().min(1),
});

function mapError(err: unknown): { status: number; body: { error: string; code?: string } } {
  if (err instanceof MoneyballError) {
    return { status: err.status, body: { error: err.message, code: err.code } };
  }
  throw err;
}

export const moneyballAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/admin/moneyball/players", async () => ({ players: await listPlayersAdmin() }));

  app.post("/admin/moneyball/players", async (req, reply) => {
    const body = playerBody.parse(req.body);
    try {
      return reply.code(201).send(await createPlayer({ ...body, gender: body.gender ?? null }));
    } catch (err) {
      const m = mapError(err);
      return reply.code(m.status).send(m.body);
    }
  });

  app.patch("/admin/moneyball/players/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const patch = playerPatch.parse(req.body);
    try {
      return await updatePlayer(id, patch);
    } catch (err) {
      const m = mapError(err);
      return reply.code(m.status).send(m.body);
    }
  });

  app.delete("/admin/moneyball/players/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    try {
      await deletePlayer(id);
      return reply.code(204).send();
    } catch (err) {
      const m = mapError(err);
      return reply.code(m.status).send(m.body);
    }
  });

  /** Base64 JSON upload; the body limit allows for base64's 4/3 overhead. */
  app.post(
    "/admin/moneyball/players/:id/photo",
    { bodyLimit: Math.ceil(MAX_PHOTO_BYTES * 1.4) + 4096 },
    async (req, reply) => {
      const { id } = idParams.parse(req.params);
      const body = photoBody.parse(req.body);
      const bytes = Buffer.from(body.dataBase64, "base64");
      try {
        return await uploadPlayerPhoto(id, body.contentType, bytes);
      } catch (err) {
        const m = mapError(err);
        return reply.code(m.status).send(m.body);
      }
    }
  );
};
