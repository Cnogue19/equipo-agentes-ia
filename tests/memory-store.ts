import type { RunRow, Store } from "../src/lib/engine";
import { initialAgents, type Files, type RunEvent, type Task } from "../src/lib/types";

/** Almacén en memoria para probar el motor sin base de datos. */
export function memoryStore(request: string, files: Files, mode: "ia" | "simulado") {
  const run: RunRow = {
    id: 1,
    user_id: 1,
    request,
    status: "pendiente",
    mode,
    summary: null,
    agents: initialAgents(),
    error: null,
    steps: 0,
    created_at: new Date().toISOString(),
    finished_at: null,
    files: { ...files },
    base_files: { ...files },
  };
  const tasks: Task[] = [];
  const events: (Omit<RunEvent, "id" | "created_at">)[] = [];
  let site: Files = files;

  const store: Store = {
    async getRun() {
      return structuredClone(run);
    },
    async patchRun(_id, p) {
      // Igual que en la BD: un estado final (completada/fallida) ya no se cambia.
      if (p.status && run.status !== "completada" && run.status !== "fallida") run.status = p.status;
      if (p.summary) run.summary = p.summary;
      if (p.agents) run.agents = structuredClone(p.agents);
      if (p.error !== undefined) run.error = p.error;
      if (p.files) run.files = { ...p.files };
      if (p.mode) run.mode = p.mode;
      if (p.steps !== undefined) run.steps = p.steps;
      if (p.finished) run.finished_at = new Date().toISOString();
    },
    async getTasks() {
      return structuredClone(tasks);
    },
    async createTasks(_runId, list) {
      list.forEach((t, idx) =>
        tasks.push({ id: tasks.length + 1, run_id: 1, idx, title: t.title, description: t.description, criteria: t.criteria, status: "pendiente", assignee: null, attempts: 0, feedback: null, checks: null, changed: null }),
      );
    },
    async patchTask(id, p) {
      Object.assign(tasks.find((t) => t.id === id)!, structuredClone(p));
    },
    async addEvent(_runId, ev) {
      events.push({ task_id: ev.taskId ?? null, agent: ev.agent, kind: ev.kind, message: ev.message, data: ev.data ?? null });
    },
    async saveSite(_u, f) {
      site = { ...f };
    },
  };
  return { store, run, tasks, events, site: () => site };
}
