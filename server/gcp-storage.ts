import { Storage } from "@google-cloud/storage";
import { randomBytes } from "crypto";

const projectId = process.env.GCP_PROJECT_ID || "reportgen-494420";
const bucketName = process.env.GCP_BUCKET_NAME || "reportgen-images-rahul";

let storage: any;
let bucket: any;

const creds = process.env.GCP_CREDENTIALS;
if (creds) {
  try {
    const credentials = JSON.parse(creds);
    storage = new Storage({ projectId, credentials });
    bucket = storage.bucket(bucketName);
  } catch (error: any) {}
}

export async function uploadImageToGCP(
  base64Data: string,
  filename: string,
): Promise<string | null> {
  if (!bucket || !base64Data) return null;

  try {
    // Remove data URL prefix if present
    const base64Content = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Content, "base64");

    // Generate unique filename with timestamp + random string to prevent collisions
    const randomSuffix = randomBytes(4).toString("hex");
    const uniqueFilename = `${Date.now()}-${randomSuffix}-${filename.replace(/[^a-zA-Z0-9.]/g, "_")}`;
    const file = bucket.file(uniqueFilename);

    // Upload with a hard timeout: on flaky/dead networks file.save() can
    // hang for minutes. On timeout we return null and the caller keeps the
    // base64 payload (queued offline, uploaded to GCP on a later sync).
    const SAVE_TIMEOUT_MS = 20000;
    await Promise.race([
      file.save(buffer, {
        contentType: getContentType(filename),
        metadata: {
          cacheControl: "public, max-age=31536000",
        },
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("GCP upload timed out")),
          SAVE_TIMEOUT_MS,
        ),
      ),
    ]);

    return `https://storage.googleapis.com/${bucketName}/${uniqueFilename}`;
  } catch (error: any) {
    console.error("GCP upload error:", error?.message || error);
    return null;
  }
}

function getContentType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  const types: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return types[ext || "jpg"] || "image/jpeg";
}

export function isGCPUrl(url: string): boolean {
  return url?.includes("storage.googleapis.com") || url?.includes("gs://");
}
