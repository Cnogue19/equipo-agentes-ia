import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Token firmado para la vista previa. Va en la URL (/preview/<token>/index.html) para que
 * el iframe aislado (sandbox, sin cookies) pueda cargar también styles.css, script.js, etc.
 */
type Target = { kind: "web" | "run"; id: number; userId: number };

const TTL_MS = 12 * 60 * 60 * 1000;

function sign(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Falta SESSION_SECRET");
  return createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 32);
}

export function previewToken(t: Target): string {
  const payload = Buffer.from(`${t.kind}.${t.id}.${t.userId}.${Date.now() + TTL_MS}`).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readPreviewToken(token: string): Target | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [kind, id, userId, exp] = Buffer.from(payload, "base64url").toString().split(".");
  if ((kind !== "web" && kind !== "run") || Number(exp) < Date.now()) return null;
  return { kind, id: Number(id), userId: Number(userId) };
}
