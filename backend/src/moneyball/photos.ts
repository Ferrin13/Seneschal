/**
 * Player photo storage. `photo_url` is one of:
 *  - a site-relative path (`/moneyball/players/x.jpg`) shipped with the frontend
 *    by the roster import,
 *  - an absolute http(s) URL, or
 *  - `s3:<key>` for a photo uploaded from the Roster admin page, stored in the
 *    private images bucket and resolved to a presigned GET URL on read.
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Bucket, s3Client } from "../s3.js";

export const S3_PHOTO_PREFIX = "s3:";
export const PHOTO_KEY_PREFIX = "moneyball/players";
/** Long enough for a browsing session; the board is re-fetched on reload anyway. */
const PHOTO_URL_TTL_SECONDS = 6 * 60 * 60;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const PHOTO_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Turn a stored photo_url into something an <img> can load. */
export async function resolvePhotoUrl(stored: string | null): Promise<string | null> {
  if (!stored || !stored.startsWith(S3_PHOTO_PREFIX)) return stored;
  const key = stored.slice(S3_PHOTO_PREFIX.length);
  try {
    return await getSignedUrl(s3Client(), new GetObjectCommand({ Bucket: s3Bucket(), Key: key }), {
      expiresIn: PHOTO_URL_TTL_SECONDS,
    });
  } catch {
    // S3 not configured in this environment: show no photo rather than 500.
    return null;
  }
}
