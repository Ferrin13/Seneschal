import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Bucket, s3Client } from "../s3.js";

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const PUT_TTL_SECONDS = 5 * 60; // 5 min — enough to upload from a flaky cell connection
const GET_TTL_SECONDS = 60 * 60; // 1 hour — long enough to render in a list, short enough to be safe

const SIGN_PURPOSE = z.enum(["expense_image"]);

const signPutBody = z.object({
  purpose: SIGN_PURPOSE,
  contentType: z.string().refine((v) => v in ALLOWED_CONTENT_TYPES, {
    message: `contentType must be one of ${Object.keys(ALLOWED_CONTENT_TYPES).join(", ")}`,
  }),
  contentLength: z.number().int().positive().max(MAX_BYTES),
});

const signGetQuery = z.object({
  key: z.string().min(1).max(512),
});

/**
 * Presigned upload/download URLs for user images. The byte path never
 * touches the API:
 *
 * - `POST /uploads/sign` mints a short-lived `PutObject` URL for a fresh
 *   per-user object key. Clients PUT bytes directly to S3 with the exact
 *   `Content-Type` they declared.
 * - `GET /uploads/sign?key=...` mints a short-lived `GetObject` URL,
 *   scoped to the requesting user's prefix (so users can only fetch
 *   their own keys regardless of what they ask for).
 */
export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.post("/uploads/sign", async (req) => {
    const body = signPutBody.parse(req.body);
    const ext = ALLOWED_CONTENT_TYPES[body.contentType]!;
    const key = `${prefixFor(req.auth.userId, body.purpose)}/${randomUUID()}.${ext}`;

    const cmd = new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
      ContentType: body.contentType,
      ContentLength: body.contentLength,
    });
    const url = await getSignedUrl(s3Client(), cmd, {
      expiresIn: PUT_TTL_SECONDS,
    });

    return {
      key,
      url,
      method: "PUT" as const,
      headers: { "Content-Type": body.contentType },
      expiresAt: new Date(Date.now() + PUT_TTL_SECONDS * 1000).toISOString(),
    };
  });

  app.get("/uploads/sign", async (req, reply) => {
    const q = signGetQuery.parse(req.query);
    const userPrefix = `users/${req.auth.userId}/`;
    if (!q.key.startsWith(userPrefix)) {
      return reply.code(403).send({ error: "forbidden_key" });
    }

    const cmd = new GetObjectCommand({ Bucket: s3Bucket(), Key: q.key });
    const url = await getSignedUrl(s3Client(), cmd, {
      expiresIn: GET_TTL_SECONDS,
    });

    return {
      key: q.key,
      url,
      expiresAt: new Date(Date.now() + GET_TTL_SECONDS * 1000).toISOString(),
    };
  });
};

function prefixFor(userId: string, purpose: z.infer<typeof SIGN_PURPOSE>): string {
  switch (purpose) {
    case "expense_image":
      return `users/${userId}/expenses`;
  }
}
