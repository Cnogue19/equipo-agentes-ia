import "server-only";
import { sql } from "./db";
import type { RunPatch, RunRow, Store, TaskPatch } from "./engine";
import { SITE_NAME, templateFiles } from "./site-template";
import { initialAgents, type Files, type Run, type RunEvent, type Task } from "./types";

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const j = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

function toRun(r: Record<string, unknown>): RunRow {
  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    request: r.request as string,
    status: r.status as Run["status"],
    mode: r.mode as RunRow["mode"],
    summary: (r.summary as string) ?? null,
    agents: r.agents as Run["agents"],
    error: (r.error as string) ?? null,
    steps: Number(r.steps),
    created_at: iso(r.created_at),
    finished_at: r.finished_at ? iso(r.finished_at) : null,
    files: (r.files as Files) ?? {},
    base_files: (r.base_files as Files) ?? {},
  };
}

function toTask(r: Record<string, unknown>): Task {
  return {
    id: Number(r.id),
    run_id: Number(r.run_id),
    idx: Number(r.idx),
    title: r.title as string,
    description: r.description as string,
    criteria: r.criteria as string[],
    status: r.status as Task["status"],
    assignee: (r.assignee as Task["assignee"]) ?? null,
    attempts: Number(r.attempts),
    feedback: (r.feedback as string[]) ?? null,
    checks: (r.checks as Task["checks"]) ?? null,
    changed: (r.changed as string[]) ?? null,
  };
}

/** Implementación del almacenamiento del motor sobre Neon Postgres. */
export const dbStore: Store = {
  async getRun(id) {
    const rows = await sql()`SELECT * FROM runs WHERE id = ${id}`;
    return rows[0] ? toRun(rows[0]) : null;
  },
  async patchRun(id, p: RunPatch) {
    await sql()`UPDATE runs SET
      status = CASE WHEN status IN ('completada', 'fallida') THEN status ELSE COALESCE(${p.status ?? null}, status) END,
      summary = COALESCE(${p.summary ?? null}, summary),
      agents = COALESCE(${j(p.agents)}::jsonb, agents),
      error = CASE WHEN ${p.error !== undefined} THEN ${p.error ?? null} ELSE error END,
      files = COALESCE(${j(p.files)}::jsonb, files),
      mode = COALESCE(${p.mode ?? null}, mode),
      steps = COALESCE(${p.steps ?? null}::int, steps),
      finished_at = CASE WHEN ${p.finished === true} THEN now() ELSE finished_at END
      WHERE id = ${id}`;
  },
  async getTasks(runId) {
    const rows = await sql()`SELECT * FROM tasks WHERE run_id = ${runId} ORDER BY idx`;
    return rows.map(toTask);
  },
  async createTasks(runId, tasks) {
    for (const [idx, t] of tasks.entries()) {
      await sql()`INSERT INTO tasks (run_id, idx, title, description, criteria)
        VALUES (${runId}, ${idx}, ${t.title}, ${t.description}, ${JSON.stringify(t.criteria)}::jsonb)`;
    }
  },
  async patchTask(id, p: TaskPatch) {
    await sql()`UPDATE tasks SET
      status = COALESCE(${p.status ?? null}, status),
      assignee = CASE WHEN ${p.assignee !== undefined} THEN ${p.assignee ?? null} ELSE assignee END,
      attempts = COALESCE(${p.attempts ?? null}::int, attempts),
      feedback = CASE WHEN ${p.feedback !== undefined} THEN ${j(p.feedback)}::jsonb ELSE feedback END,
      checks = COALESCE(${j(p.checks)}::jsonb, checks),
      changed = COALESCE(${j(p.changed)}::jsonb, changed),
      updated_at = now()
      WHERE id = ${id}`;
  },
  async addEvent(runId, ev) {
    await sql()`INSERT INTO events (run_id, task_id, agent, kind, message, data)
      VALUES (${runId}, ${ev.taskId ?? null}, ${ev.agent}, ${ev.kind}, ${ev.message}, ${j(ev.data)}::jsonb)`;
  },
  async saveSite(userId, files) {
    await sql()`UPDATE sites SET files = ${JSON.stringify(files)}::jsonb, updated_at = now() WHERE user_id = ${userId}`;
  },
};

export async function getOrCreateSite(userId: number): Promise<{ name: string; files: Files; updated_at: string }> {
  const rows = await sql()`SELECT name, files, updated_at FROM sites WHERE user_id = ${userId}`;
  if (rows[0]) return { name: rows[0].name as string, files: rows[0].files as Files, updated_at: iso(rows[0].updated_at) };
  const files = templateFiles();
  await sql()`INSERT INTO sites (user_id, name, files) VALUES (${userId}, ${SITE_NAME}, ${JSON.stringify(files)}::jsonb)
    ON CONFLICT (user_id) DO NOTHING`;
  return getOrCreateSite(userId);
}

export async function resetSite(userId: number) {
  await getOrCreateSite(userId);
  await sql()`UPDATE sites SET files = ${JSON.stringify(templateFiles())}::jsonb, updated_at = now() WHERE user_id = ${userId}`;
}

/**
 * Marca como detenidas las peticiones del usuario que llevan más de 20 minutos sin ninguna
 * actividad (p. ej. se cerró la pestaña a mitad). Así no se quedan «En curso» para siempre ni
 * impiden lanzar otra. Un paso en marcha (bloqueo activo) nunca se considera abandonado.
 */
export async function expireStaleRuns(userId: number) {
  const rows = await sql()`UPDATE runs r SET status = 'fallida', finished_at = now(),
      error = 'Detenida: sin actividad durante más de 20 minutos (se cerró la pestaña a mitad).'
    WHERE r.user_id = ${userId} AND r.status IN ('pendiente', 'planificando', 'en_curso')
      AND (r.lock_until IS NULL OR r.lock_until < now())
      AND GREATEST(r.created_at, COALESCE((SELECT max(e.created_at) FROM events e WHERE e.run_id = r.id), r.created_at))
          < now() - interval '20 minutes'
    RETURNING r.id`;
  for (const row of rows) {
    await dbStore.addEvent(Number(row.id), { agent: "sistema", kind: "error", message: "Petición detenida por falta de actividad (más de 20 minutos). La web publicada no se ha modificado." });
  }
}

export async function hasActiveRun(userId: number): Promise<boolean> {
  await expireStaleRuns(userId);
  const rows = await sql()`SELECT 1 FROM runs WHERE user_id = ${userId}
    AND status IN ('pendiente', 'planificando', 'en_curso') LIMIT 1`;
  return rows.length > 0;
}

export async function runsToday(userId: number): Promise<number> {
  const rows = await sql()`SELECT count(*)::int AS n FROM runs WHERE user_id = ${userId} AND created_at > now() - interval '24 hours'`;
  return Number(rows[0]?.n ?? 0);
}

export async function createRun(userId: number, request: string, mode: "ia" | "simulado"): Promise<number> {
  const site = await getOrCreateSite(userId);
  const files = JSON.stringify(site.files);
  const rows = await sql()`INSERT INTO runs (user_id, request, mode, base_files, files, agents)
    VALUES (${userId}, ${request}, ${mode}, ${files}::jsonb, ${files}::jsonb, ${JSON.stringify(initialAgents())}::jsonb)
    RETURNING id`;
  const id = Number(rows[0].id);
  await dbStore.addEvent(id, { agent: "sistema", kind: "creada", message: `Nueva petición registrada (modo ${mode === "ia" ? "IA" : "simulado"}).` });
  return id;
}

export async function listRuns(userId: number) {
  await expireStaleRuns(userId);
  const rows = await sql()`SELECT id, request, status, mode, created_at, finished_at,
      (SELECT count(*)::int FROM tasks t WHERE t.run_id = runs.id) AS total,
      (SELECT count(*)::int FROM tasks t WHERE t.run_id = runs.id AND t.status = 'hecha') AS hechas
    FROM runs WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 30`;
  return rows.map((r) => ({
    id: Number(r.id),
    request: r.request as string,
    status: r.status as string,
    mode: r.mode as string,
    created_at: iso(r.created_at),
    finished_at: r.finished_at ? iso(r.finished_at) : null,
    total: Number(r.total),
    hechas: Number(r.hechas),
  }));
}

/** Estado completo de una ejecución para la pantalla (sin el contenido de los ficheros). */
export async function getRunState(runId: number, userId: number) {
  const rows = await sql()`SELECT id, user_id, request, status, mode, summary, agents, error, steps, created_at, finished_at,
      lock_until > now() AS ocupado,
      (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(files) k) AS ficheros
    FROM runs WHERE id = ${runId} AND user_id = ${userId}`;
  const r = rows[0];
  if (!r) return null;
  const tasks = (await sql()`SELECT * FROM tasks WHERE run_id = ${runId} ORDER BY idx`).map(toTask);
  const events = (await sql()`SELECT id, task_id, agent, kind, message, data, created_at FROM events WHERE run_id = ${runId} ORDER BY id`).map(
    (e): RunEvent => ({
      id: Number(e.id),
      task_id: e.task_id ? Number(e.task_id) : null,
      agent: e.agent as RunEvent["agent"],
      kind: e.kind as string,
      message: e.message as string,
      data: e.data,
      created_at: iso(e.created_at),
    }),
  );
  return {
    run: {
      id: Number(r.id),
      request: r.request as string,
      status: r.status as Run["status"],
      mode: r.mode as string,
      summary: (r.summary as string) ?? null,
      agents: r.agents as Run["agents"],
      error: (r.error as string) ?? null,
      steps: Number(r.steps),
      created_at: iso(r.created_at),
      finished_at: r.finished_at ? iso(r.finished_at) : null,
      ocupado: Boolean(r.ocupado),
      ficheros: (r.ficheros as string[]) ?? [],
    },
    tasks,
    events,
  };
}

export async function getRunFiles(runId: number, userId: number) {
  const rows = await sql()`SELECT files, base_files FROM runs WHERE id = ${runId} AND user_id = ${userId}`;
  if (!rows[0]) return null;
  return { files: rows[0].files as Files, base: rows[0].base_files as Files };
}

/** Bloqueo para que solo un proceso avance una ejecución a la vez. */
export async function acquireLock(runId: number, userId: number): Promise<boolean> {
  const rows = await sql()`UPDATE runs SET lock_until = now() + interval '310 seconds'
    WHERE id = ${runId} AND user_id = ${userId} AND status NOT IN ('completada','fallida')
      AND (lock_until IS NULL OR lock_until < now())
    RETURNING id`;
  return rows.length > 0;
}

export async function releaseLock(runId: number) {
  await sql()`UPDATE runs SET lock_until = NULL WHERE id = ${runId}`;
}

/** Estado de una ejecución del usuario (o null si no existe). */
export async function runStatus(runId: number, userId: number): Promise<string | null> {
  const rows = await sql()`SELECT status FROM runs WHERE id = ${runId} AND user_id = ${userId}`;
  return rows[0] ? (rows[0].status as string) : null;
}
