import { put } from "@vercel/blob";

// Stores a screenshot/file in Vercel Blob with PRIVATE access and returns a
// reference the app persists. Private blobs are not reachable by URL: the
// object can only be fetched server-side with the store token. CTF screenshots
// can contain IPs, hashes and credentials, so public access is not used.
//
// Requires a PRIVATE Vercel Blob store and @vercel/blob >= 2 (the version that
// added `access: "private"`). Provision the store with private access
// (`vercel blob create-store <name> --access private`).
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
    access: "private", // Not publicly reachable; fetch server-side with the token.
    contentType,
    addRandomSuffix: true,
    token,
  });
  return blob.url;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}
