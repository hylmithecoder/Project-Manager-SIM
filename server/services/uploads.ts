import fs from "node:fs/promises";
import path from "node:path";

/** Attachments are stored on disk and served by Bun under /uploads/<id>/<name>. */
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024);

export function getUploadDir(): string {
  return path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"));
}

export function sanitizeFileName(name: string): string {
  const base = path.basename(name || "file").replace(/[^\w.\- ]+/g, "_").trim();
  return (base || "file").slice(0, 120);
}

export async function saveUpload(params: {
  fileName: string;
  base64: string;
}): Promise<{ id: string; fileName: string; url: string; size: number }> {
  const bytes = Buffer.from(params.base64.replace(/^data:[^,]*,/, ""), "base64");
  if (bytes.length === 0) throw new Error("File kosong");
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Ukuran file maksimal ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
  }
  const id = crypto.randomUUID();
  const fileName = sanitizeFileName(params.fileName);
  const dir = path.join(getUploadDir(), id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), bytes);
  return { id, fileName, url: `/uploads/${id}/${encodeURIComponent(fileName)}`, size: bytes.length };
}

export async function deleteUpload(fileUrl: string): Promise<void> {
  const match = /^\/uploads\/([0-9a-f-]{36})\//.exec(fileUrl);
  if (!match) return;
  await fs.rm(path.join(getUploadDir(), match[1]), { recursive: true, force: true });
}

/** Resolves an /uploads/... request path to a file inside the upload dir. */
export function resolveUploadPath(pathname: string): string | null {
  const match = /^\/uploads\/([0-9a-f-]{36})\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  const root = getUploadDir();
  const full = path.resolve(root, match[1], sanitizeFileName(decodeURIComponent(match[2])));
  return full.startsWith(root + path.sep) ? full : null;
}
