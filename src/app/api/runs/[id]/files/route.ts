import { NextResponse } from "next/server";
import { error, json, parseId, requireUser } from "@/lib/http";
import { getRunFiles } from "@/lib/repo";

/** Ficheros de la web antes y después de la ejecución (para ver el código y los cambios). */
export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]/files">) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const id = parseId((await ctx.params).id);
  if (!id) return error("Id no válido");
  const files = await getRunFiles(id, user.id);
  return files ? json(files) : error("No encontrada", 404);
}
