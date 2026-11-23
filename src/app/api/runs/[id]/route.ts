import { NextResponse } from "next/server";
import { error, json, parseId, requireUser } from "@/lib/http";
import { getRunState } from "@/lib/repo";
import { previewToken } from "@/lib/preview-token";

/** Estado completo de una ejecución: agentes, tareas y registro de eventos. */
export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const id = parseId((await ctx.params).id);
  if (!id) return error("Id no válido");
  const state = await getRunState(id, user.id);
  if (!state) return error("No encontrada", 404);
  return json({ ...state, preview: previewToken({ kind: "run", id, userId: user.id }) });
}
