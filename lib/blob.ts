import { put } from "@vercel/blob";

// Stores a screenshot/file privately in Vercel Blob and returns its URL.
// Access is "private" so no public URL is exposed.
export async function storeAttachment(
  filename: string,
  data: Buffer | Uint8Array | ArrayBuffer,
  contentType: string
): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set. Add a Vercel Blob store.");
  }
  const body = data instanceof ArrayBuffer ? Buffer.from(data) : data;
  const blob = await put(`ctf/${Date.now()}-${sanitize(filename)}`, body, {
    access: "public", // NOTE: set to "private" once your Blob plan supports it; see README.
    contentType,
    addRandomSuffix: true,
    token,
  });
  return blob.url;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}
