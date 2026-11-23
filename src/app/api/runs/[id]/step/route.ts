import { NextResponse } from "next/server";
import { error, json, parseId, requireUser } from "@/lib/http";
import { acquireLock, dbStore, releaseLock } from "@/lib/repo";
import { step } from "@/lib/engine";
import { callLlm } from "@/lib/ai/llm";

// Una llamada de un agente (sobre todo Develop) puede tardar varios minutos.
export const maxDuration = 300;

/** Ejecuta el siguiente paso de un agente. El navegador lo va llamando mientras la ejecución está activa. */
export async function POST(_req: Request, ctx: RouteContext<"/api/runs/[id]/step">) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const id = parseId((await ctx.params).id);
  if (!id) return error("Id no válido");
  if (!(await acquireLock(id, user.id))) return json({ busy: true });
  try {
    const result = await step(id, { store: dbStore, llm: callLlm });
    return json(result);
  } finally {
    await releaseLock(id);
  }
}
