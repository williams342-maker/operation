/**
 * iter453 — Chunked digital-file upload (proxy-safe, 100MB support).
 * init → PUT 4MB chunks → complete (assemble + security scan server-side).
 */
import { API } from "./api";

const CHUNK = 4 * 1024 * 1024;

export async function uploadDigitalFile({ productSlug, file, replaceFileId, releaseNotes, onProgress }) {
  const token = localStorage.getItem("cm_maker_jwt");
  const auth = { Authorization: `Bearer ${token}` };
  const base = `${API}/maker/listings/${encodeURIComponent(productSlug)}/digital-uploads`;
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK));

  const initRes = await fetch(`${base}/init`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name, size_bytes: file.size, total_chunks: totalChunks,
      replace_file_id: replaceFileId || null, release_notes: releaseNotes || null,
    }),
  });
  if (!initRes.ok) {
    const d = await initRes.json().catch(() => ({}));
    throw new Error(d.detail || `Upload init failed (HTTP ${initRes.status})`);
  }
  const { upload_id } = await initRes.json();

  for (let i = 0; i < totalChunks; i++) {
    const blob = file.slice(i * CHUNK, Math.min((i + 1) * CHUNK, file.size));
    const r = await fetch(`${base}/${upload_id}/chunks/${i}`, {
      method: "PUT", headers: { ...auth, "Content-Type": "application/octet-stream" },
      body: blob,
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.detail || `Chunk ${i + 1}/${totalChunks} failed`);
    }
    onProgress?.(Math.round(((i + 1) / (totalChunks + 1)) * 100));
  }

  const done = await fetch(`${base}/${upload_id}/complete`, { method: "POST", headers: auth });
  if (!done.ok) {
    const d = await done.json().catch(() => ({}));
    throw new Error(d.detail || `Finalize failed (HTTP ${done.status})`);
  }
  onProgress?.(100);
  return done.json(); // manifest entry (new file or new version)
}
