import { NextResponse } from "next/server";
import { error, json, requireUser } from "@/lib/http";
import { createRun, hasActiveRun, listRuns, runsToday } from "@/lib/repo";

const MAX_RUNS_PER_DAY = Number(process.env.MAX_RUNS_PER_DAY || 20);

export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  return json({ runs: await listRuns(user.id) });
}

/** Crea una ejecución nueva a partir de la petición del usuario. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const body = (await req.json().catch(() => null)) as { request?: unknown; mode?: unknown } | null;
  const request = typeof body?.request === "string" ? body.request.trim() : "";
  if (request.length < 5) return error("Escribe una petición un poco más larga");
  if (request.length > 600) return error("La petición es demasiado larga (máx. 600 caracteres)");
  const mode = body?.mode === "simulado" || process.env.AI_ENGINE === "simulado" ? "simulado" : "ia";
  if (await hasActiveRun(user.id)) return error("Ya hay una petición en marcha. Espera a que termine.", 409);
  if ((await runsToday(user.id)) >= MAX_RUNS_PER_DAY) return error("Has alcanzado el límite de peticiones de hoy.", 429);
  const id = await createRun(user.id, request, mode);
  return json({ id }, 201);
}
