import { Storage } from "@google-cloud/storage";
import { Readable } from "stream";
import { logger } from "./logger";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const gcs = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
} as ConstructorParameters<typeof Storage>[0]);

function getBucket() {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) {
    throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set. Please set up Object Storage.");
  }
  return gcs.bucket(bucketId);
}

const GCS_PREFIX = "section-images/";

export async function uploadSectionImage(
  filename: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const bucket = getBucket();
  const file = bucket.file(`${GCS_PREFIX}${filename}`);
  await file.save(buffer, { contentType, resumable: false });
  logger.info({ filename }, "Section image uploaded to GCS");
}

export async function sectionImageExists(filename: string): Promise<boolean> {
  try {
    const bucket = getBucket();
    const file = bucket.file(`${GCS_PREFIX}${filename}`);
    const [exists] = await file.exists();
    return exists;
  } catch {
    return false;
  }
}

export async function streamSectionImage(
  filename: string,
): Promise<{ stream: NodeJS.ReadableStream; contentType: string } | null> {
  try {
    const bucket = getBucket();
    const file = bucket.file(`${GCS_PREFIX}${filename}`);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [metadata] = await file.getMetadata();
    return {
      stream: file.createReadStream(),
      contentType: (metadata.contentType as string) || "image/png",
    };
  } catch (err) {
    logger.warn({ err, filename }, "Failed to stream section image from GCS");
    return null;
  }
}

export function extractFilenameFromUrl(imageUrl: string): string | null {
  const prefix = "/api/section-images/";
  if (!imageUrl.startsWith(prefix)) return null;
  return imageUrl.slice(prefix.length);
}
