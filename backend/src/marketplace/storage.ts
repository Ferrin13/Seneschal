import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";
import { s3Client } from "../s3.js";

/**
 * Best-effort S3 upload helpers for marketplace artifacts (listing HTML
 * snapshots, images). Returns the object key on success, or `null` when S3
 * isn't configured so callers can degrade gracefully rather than fail the
 * whole scrape.
 */
export async function putObject(
  key: string,
  body: Buffer | string,
  contentType: string
): Promise<string | null> {
  if (!config.S3_BUCKET) return null;
  await s3Client().send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return key;
}

/** Presign a GET url for a stored object (e.g. to hand an image to the LLM). */
export async function presignGet(
  key: string,
  expiresIn = 900
): Promise<string | null> {
  if (!config.S3_BUCKET) return null;
  return getSignedUrl(
    s3Client(),
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
    { expiresIn }
  );
}

export function listingHtmlKey(userId: string, listingId: string): string {
  return `users/${userId}/marketplace/listings/${listingId}/page.html`;
}

export function listingImageKey(
  userId: string,
  listingId: string,
  index: number,
  ext = "jpg"
): string {
  return `users/${userId}/marketplace/listings/${listingId}/img-${index}.${ext}`;
}
