import { NextResponse } from "next/server";
import { json, requireUser } from "@/lib/http";
import { getOrCreateSite, hasActiveRun, resetSite } from "@/lib/repo";
import { engineInfo } from "@/lib/ai/llm";
import { previewToken } from "@/lib/preview-token";

/** La web actual del usuario y el motor de IA configurado. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const site = await getOrCreateSite(user.id);
  return json({ user, site: { name: site.name, ficheros: Object.keys(site.files).sort(), updated_at: site.updated_at, preview: previewToken({ kind: "web", id: 0, userId: user.id }) }, motor: await engineInfo() });
}

/** Restaura la web de ejemplo a su estado original. */
export async function DELETE() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  if (await hasActiveRun(user.id)) return json({ error: "Hay una petición en marcha" }, 409);
  await resetSite(user.id);
  return json({ ok: true });
}
