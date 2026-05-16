import { S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";

/**
 * Process-wide S3 client. The AWS SDK uses the standard credential chain
 * (env vars / EC2/ECS task role / shared credentials file), so production
 * just needs the ECS task IAM role; in dev set AWS_PROFILE or AWS_*
 * env vars before starting the server.
 *
 * `S3_ENDPOINT` is provided as an escape hatch for LocalStack / Minio. When
 * set we also enable `forcePathStyle` because non-AWS endpoints rarely
 * support the virtual-hosted bucket style.
 */
let _client: S3Client | null = null;

export function s3Client(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: config.AWS_REGION,
    ...(config.S3_ENDPOINT
      ? { endpoint: config.S3_ENDPOINT, forcePathStyle: true }
      : {}),
  });
  return _client;
}

export function s3Bucket(): string {
  if (!config.S3_BUCKET) {
    const err = new Error("s3_not_configured") as Error & { statusCode: number };
    err.statusCode = 503;
    throw err;
  }
  return config.S3_BUCKET;
}
