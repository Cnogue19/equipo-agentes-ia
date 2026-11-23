import { NextResponse } from "next/server";
import { error, json, parseId, requireUser } from "@/lib/http";
import { dbStore, getRunState } from "@/lib/repo";
import { cancelRun } from "@/lib/engine";

/** Cancela una petición en curso. La web publicada no se modifica. */
export async function POST(_req: Request, ctx: RouteContext<"/api/runs/[id]/cancel">) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const id = parseId((await ctx.params).id);
  if (!id) return error("Id no válido");
  // Solo el dueño de la ejecución puede cancelarla.
  if (!(await getRunState(id, user.id))) return error("No encontrada", 404);
  const ok = await cancelRun(id, dbStore);
  return ok ? json({ ok: true }) : error("La petición ya había terminado", 409);
}
