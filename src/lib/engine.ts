/**
 * Motor del equipo de agentes. Funciona como una máquina de estados: cada llamada a `step()`
 * ejecuta UNA acción de UN agente y guarda el resultado en la base de datos. Así:
 *  - ninguna petición HTTP dura demasiado (límite de las funciones de Vercel),
 *  - todo el progreso queda guardado y se puede ver en pantalla en tiempo real,
 *  - si se cierra el navegador, la ejecución se reanuda donde estaba.
 *
 * Flujo: Orquestador planifica → por cada tarea: Orquestador asigna → Develop implementa →
 * Testing comprueba → (si falla, vuelve a Develop con los fallos) → … → Orquestador cierra.
 */
import type { AgentId, AgentState, AgentsState, CheckResult, CriterionResult, Files, Run, RunStatus, Task } from "./types";
import { MAX_AI_RETRIES, MAX_ATTEMPTS } from "./types";
import { runAutomaticChecks, isSafePath } from "./agents/checks";
import { simulatedCriteria, simulatedDevelop, simulatedPlan, type Plan } from "./agents/simulated";
import { DEVELOP_SYSTEM, DevSchema, ORQUESTADOR_SYSTEM, PlanSchema, TESTING_SYSTEM, TestSchema, renderFiles } from "./agents/prompts";
import type { callLlm, LlmProgress } from "./ai/llm";

export type RunRow = Run & { user_id: number; mode: "ia" | "simulado"; files: Files; base_files: Files };

export type RunPatch = Partial<{
  status: RunStatus;
  summary: string;
  agents: AgentsState;
  error: string | null;
  files: Files;
  mode: "ia" | "simulado";
  steps: number;
  finished: boolean;
}>;

export type TaskPatch = Partial<Pick<Task, "status" | "assignee" | "attempts" | "feedback" | "checks" | "changed">>;

export interface Store {
  getRun(id: number): Promise<RunRow | null>;
  patchRun(id: number, patch: RunPatch): Promise<void>;
  getTasks(runId: number): Promise<Task[]>;
  createTasks(runId: number, tasks: { title: string; description: string; criteria: string[] }[]): Promise<void>;
  patchTask(id: number, patch: TaskPatch): Promise<void>;
  addEvent(runId: number, ev: { taskId?: number | null; agent: AgentId | "sistema"; kind: string; message: string; data?: unknown }): Promise<void>;
  saveSite(userId: number, files: Files): Promise<void>;
}

export type Deps = {
  store: Store;
  llm: typeof callLlm;
  /** Pausa artificial del modo simulado para que se vea el trabajo de cada agente. */
  sleep?: (ms: number) => Promise<void>;
};

const MAX_STEPS = 60;
const MAX_FILES_PER_CHANGE = 12;
const MAX_FILE_SIZE = 120_000;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function step(runId: number, deps: Deps): Promise<{ status: RunStatus; done: boolean }> {
  const { store } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const run = await store.getRun(runId);
  if (!run) throw new Error("Ejecución no encontrada");
  if (run.status === "completada" || run.status === "fallida") return { status: run.status, done: true };

  const steps = run.steps + 1;
  await store.patchRun(run.id, { steps });
  if (steps > MAX_STEPS) return fail(run, deps, "Se ha superado el número máximo de pasos.");

  const agents = run.agents;
  const setAgent = async (id: AgentId, patch: Partial<AgentState>) => {
    agents[id] = { ...agents[id], ...patch };
    await store.patchRun(run.id, { agents });
  };
  const addUsage = (id: AgentId, motor: string, tin: number, tout: number) => {
    agents[id] = {
      ...agents[id],
      fallosSeguidos: 0,
      motor,
      llamadas: agents[id].llamadas + 1,
      tokensEntrada: agents[id].tokensEntrada + tin,
      tokensSalida: agents[id].tokensSalida + tout,
    };
  };
  /** Actualiza la actividad del agente mientras el modelo escribe (como mucho cada 1,5 s). */
  const progress = (id: AgentId, label: string) => {
    let last = 0;
    return (p: LlmProgress) => {
      const now = Date.now();
      if (now - last < 1500) return;
      last = now;
      const modelo = p.modelo.split("/").pop();
      const actividad =
        p.fase === "razonando"
          ? `Razonando con ${modelo}… ${p.segundos} s`
          : `${label}… ${(p.caracteres / 1000).toFixed(1)} mil caracteres (${p.segundos} s)`;
      void setAgent(id, { actividad }).catch(() => {});
    };
  };

  try {
    // ───────────── 1. Orquestador: planificar ─────────────
    if (run.status === "pendiente" || run.status === "planificando") {
      await store.patchRun(run.id, { status: "planificando" });
      await store.addEvent(run.id, { agent: "orquestador", kind: "inicio", message: `Recibo la petición: «${run.request}»` });
      await setAgent("orquestador", { estado: "pensando", actividad: "Analizando la petición y la web actual" });

      let plan: Plan | null = null;
      let mode = run.mode;
      if (mode === "ia") {
        const { result, reason } = await deps.llm({
          system: ORQUESTADOR_SYSTEM,
          prompt: `PETICIÓN DEL USUARIO:\n${run.request}\n\nFICHEROS ACTUALES DE LA WEB:\n${renderFiles(run.files, 6000)}`,
          schema: PlanSchema,
          effort: "low",
          maxTokens: 24000,
          onProgress: progress("orquestador", "Planificando"),
        });
        if (result) {
          plan = result.data;
          addUsage("orquestador", result.motor, result.tokensIn, result.tokensOut);
        } else {
          mode = "simulado";
          await store.patchRun(run.id, { mode });
          await store.addEvent(run.id, { agent: "sistema", kind: "aviso", message: `La IA no está disponible (${reason}). El equipo continúa en modo simulado.` });
        }
      }
      if (!plan) {
        await sleep(1500);
        plan = simulatedPlan(run.request);
        addUsage("orquestador", "simulado (sin IA)", 0, 0);
      }
      const tareas = plan.tareas.slice(0, 4).filter((t) => t.titulo && t.descripcion);
      if (!tareas.length) return fail(run, deps, "El Orquestador no ha generado ninguna tarea.");
      await store.createTasks(
        run.id,
        tareas.map((t) => ({ title: t.titulo, description: t.descripcion, criteria: t.criterios.slice(0, 5) })),
      );
      await store.addEvent(run.id, {
        agent: "orquestador",
        kind: "plan",
        message: plan.resumen || `He dividido la petición en ${tareas.length} tareas.`,
        data: { tareas: tareas.map((t) => t.titulo) },
      });
      await setAgent("orquestador", { estado: "esperando", actividad: `Coordinando ${tareas.length} tareas` });
      await store.patchRun(run.id, { status: "en_curso", summary: plan.resumen });
      return { status: "en_curso", done: false };
    }

    // ───────────── 2. Bucle de tareas ─────────────
    const tasks = await store.getTasks(run.id);
    const task = tasks.find((t) => t.status !== "hecha");

    if (!task) return finish(run, tasks, deps, setAgent, sleep);
    if (task.status === "bloqueada") return fail(run, deps, `La tarea «${task.title}» está bloqueada.`);

    // 2a. Orquestador asigna la tarea y Develop la implementa (o corrige)
    if (task.status === "pendiente" || task.status === "corrigiendo" || task.status === "en_desarrollo") {
      const n = task.idx + 1;
      if (task.status === "pendiente") {
        await setAgent("orquestador", { estado: "trabajando", actividad: `Asignando la tarea ${n} a Develop` });
        await store.addEvent(run.id, { taskId: task.id, agent: "orquestador", kind: "asignacion", message: `Asigno la tarea ${n}/${tasks.length} a Develop: «${task.title}»` });
        await setAgent("orquestador", { estado: "esperando", actividad: `Supervisando la tarea ${n}/${tasks.length}` });
      }
      // Si la tarea ya estaba "en_desarrollo" es un reintento por fallo de la IA: no cuenta como intento nuevo.
      const attempt = task.status === "en_desarrollo" ? Math.max(task.attempts, 1) : task.attempts + 1;
      await store.patchTask(task.id, { status: "en_desarrollo", assignee: "develop", attempts: attempt });
      await setAgent("develop", {
        estado: "trabajando",
        actividad: attempt === 1 ? `Implementando la tarea ${n}: ${task.title}` : `Corrigiendo la tarea ${n} (intento ${attempt})`,
      });
      await setAgent("testing", { estado: "esperando", actividad: `Esperando la entrega de la tarea ${n}` });

      let output: { resumen: string; archivos: { ruta: string; contenido: string }[] };
      if (run.mode === "ia") {
        const fb = task.feedback?.length ? `\n\nFALLOS QUE TE HA DEVUELTO TESTING EN EL INTENTO ANTERIOR (corrígelos todos):\n${task.feedback.map((f) => `- ${f}`).join("\n")}` : "";
        const { result, reason } = await deps.llm({
          system: DEVELOP_SYSTEM,
          prompt: `TAREA ${n} de ${tasks.length}: ${task.title}\nDescripción: ${task.description}\nCriterios de aceptación:\n${task.criteria.map((c) => `- ${c}`).join("\n")}${fb}\n\nPETICIÓN ORIGINAL DEL USUARIO: ${run.request}\n\nFICHEROS ACTUALES DE LA WEB:\n${renderFiles(run.files)}`,
          schema: DevSchema,
          effort: "medium",
          maxTokens: 32000,
          onProgress: progress("develop", "Escribiendo código"),
        });
        if (!result) return aiFailed(run, deps, "develop", reason);
        output = result.data;
        addUsage("develop", result.motor, result.tokensIn, result.tokensOut);
      } else {
        await sleep(2000);
        output = simulatedDevelop(run.request, task.idx, attempt, run.files);
        addUsage("develop", "simulado (sin IA)", 0, 0);
      }

      const files = { ...run.files };
      const changed: string[] = [];
      const rejected: string[] = [];
      for (const f of output.archivos.slice(0, MAX_FILES_PER_CHANGE)) {
        const ruta = f.ruta.trim().replace(/^\.\//, "");
        if (!isSafePath(ruta) || f.contenido.length > MAX_FILE_SIZE) {
          rejected.push(ruta);
          continue;
        }
        if (files[ruta] !== f.contenido) {
          files[ruta] = f.contenido;
          changed.push(ruta);
        }
      }
      await store.patchRun(run.id, { files });
      await store.patchTask(task.id, { status: "en_pruebas", changed });
      await store.addEvent(run.id, {
        taskId: task.id,
        agent: "develop",
        kind: "entrega",
        message: `${output.resumen || "Cambios entregados."} (${changed.length ? `ficheros: ${changed.join(", ")}` : "sin cambios en ficheros"})`,
        data: { archivos: changed, rechazados: rejected, intento: attempt },
      });
      if (rejected.length) {
        await store.addEvent(run.id, { taskId: task.id, agent: "sistema", kind: "aviso", message: `Se han descartado ficheros no permitidos: ${rejected.join(", ")}` });
      }
      await setAgent("develop", { estado: "esperando", actividad: `Esperando el resultado de Testing (tarea ${n})` });
      return { status: "en_curso", done: false };
    }

    // 2b. Testing comprueba lo que ha hecho Develop
    if (task.status === "en_pruebas") {
      const n = task.idx + 1;
      await store.patchTask(task.id, { assignee: "testing" });
      await setAgent("testing", { estado: "trabajando", actividad: `Ejecutando comprobaciones automáticas (tarea ${n})` });
      const automaticas = runAutomaticChecks(run.files);
      const errores = automaticas.filter((c) => c.estado === "error");
      const avisos = automaticas.filter((c) => c.estado === "aviso");
      await store.addEvent(run.id, {
        taskId: task.id,
        agent: "testing",
        kind: "comprobaciones",
        message: `Comprobaciones automáticas: ${automaticas.length - errores.length - avisos.length} correctas, ${errores.length} con errores, ${avisos.length} avisos`,
        data: { automaticas },
      });

      await setAgent("testing", { estado: "pensando", actividad: `Revisando los criterios de aceptación de la tarea ${n}` });
      let criterios: CriterionResult[];
      if (run.mode === "ia") {
        const { result, reason } = await deps.llm({
          system: TESTING_SYSTEM,
          prompt: `TAREA ${n}: ${task.title}\nDescripción: ${task.description}\n\nCRITERIOS A EVALUAR (uno por uno, en este orden):\n${task.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nFICHEROS CAMBIADOS POR DEVELOP EN ESTE INTENTO: ${(task.changed ?? []).join(", ") || "ninguno"}\n\nRESULTADO DE LAS COMPROBACIONES AUTOMÁTICAS:\n${automaticas.map((c) => `- [${c.estado}] ${c.nombre}: ${c.detalle}`).join("\n")}\n\nFICHEROS ACTUALES DE LA WEB:\n${renderFiles(run.files)}`,
          schema: TestSchema,
          effort: "low",
          maxTokens: 24000,
          onProgress: progress("testing", "Redactando el informe"),
        });
        if (!result) return aiFailed(run, deps, "testing", reason);
        addUsage("testing", result.motor, result.tokensIn, result.tokensOut);
        criterios = task.criteria.map((c, i) => {
          const r = result.data.criterios[i];
          return { criterio: c, cumple: Boolean(r?.cumple), motivo: r?.motivo ?? "Sin evaluación" };
        });
      } else {
        await sleep(1500);
        criterios = simulatedCriteria(task.description, task.criteria, run.files);
        addUsage("testing", "simulado (sin IA)", 0, 0);
      }

      const fallos = [
        ...errores.map((c: CheckResult) => `[Automática] ${c.nombre}: ${c.detalle}`),
        ...criterios.filter((c) => !c.cumple).map((c) => `[Criterio] ${c.criterio} → ${c.motivo}`),
      ];
      await store.patchTask(task.id, { checks: { automaticas, criterios }, feedback: fallos.length ? fallos : null });

      if (!fallos.length) {
        await store.patchTask(task.id, { status: "hecha", assignee: null });
        await store.addEvent(run.id, {
          taskId: task.id,
          agent: "testing",
          kind: "aprobado",
          message: `Tarea ${n} superada: ${criterios.length}/${criterios.length} criterios cumplidos y sin errores automáticos${task.attempts > 1 ? ` (tras ${task.attempts} intentos)` : ""}.`,
        });
        await setAgent("testing", { estado: "esperando", actividad: "Esperando la siguiente entrega" });
        return { status: "en_curso", done: false };
      }

      if (task.attempts >= MAX_ATTEMPTS) {
        await store.patchTask(task.id, { status: "bloqueada" });
        await store.addEvent(run.id, { taskId: task.id, agent: "testing", kind: "bloqueada", message: `La tarea ${n} sigue fallando tras ${task.attempts} intentos.`, data: { fallos } });
        return fail(run, deps, `La tarea «${task.title}» no ha pasado las pruebas tras ${task.attempts} intentos.`);
      }

      await store.patchTask(task.id, { status: "corrigiendo", assignee: "develop" });
      await store.addEvent(run.id, {
        taskId: task.id,
        agent: "testing",
        kind: "fallos",
        message: `Tarea ${n}: devuelvo ${fallos.length} fallo${fallos.length === 1 ? "" : "s"} a Develop.`,
        data: { fallos },
      });
      await setAgent("testing", { estado: "esperando", actividad: `Esperando la corrección de la tarea ${n}` });
      return { status: "en_curso", done: false };
    }

    return { status: run.status, done: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(run, deps, `Error inesperado: ${msg.slice(0, 400)}`);
  }
}

async function finish(
  run: RunRow,
  tasks: Task[],
  deps: Deps,
  setAgent: (id: AgentId, p: Partial<AgentState>) => Promise<void>,
  sleep: (ms: number) => Promise<void>,
): Promise<{ status: RunStatus; done: boolean }> {
  const { store } = deps;
  // Si la ejecución se canceló mientras este paso estaba en marcha, no se publica nada.
  const fresh = await store.getRun(run.id);
  if (!fresh || fresh.status === "fallida") return { status: "fallida", done: true };
  await setAgent("orquestador", { estado: "trabajando", actividad: "Revisión final de toda la web" });
  if (run.mode === "simulado") await sleep(800);
  const finalChecks = runAutomaticChecks(run.files);
  const errores = finalChecks.filter((c) => c.estado === "error").length;
  await store.saveSite(run.user_id, run.files);
  const changed = Object.keys(run.files).filter((p) => run.files[p] !== run.base_files[p]);
  await store.addEvent(run.id, {
    agent: "orquestador",
    kind: "fin",
    message: `Trabajo terminado: ${tasks.length} tareas completadas y verificadas por Testing. Ficheros nuevos o modificados: ${changed.join(", ") || "ninguno"}. ${errores ? `Quedan ${errores} errores automáticos.` : "Revisión final sin errores."} La web publicada ya incluye los cambios.`,
    data: { finalChecks },
  });
  for (const id of ["orquestador", "develop", "testing"] as AgentId[]) {
    await setAgent(id, { estado: "terminado", actividad: "Trabajo terminado" });
  }
  await store.patchRun(run.id, { status: "completada", finished: true });
  return { status: "completada", done: true };
}

/**
 * Fallo puntual de la IA a mitad de una ejecución (respuesta cortada, JSON no válido, modelo lento…).
 * La tarea se queda como estaba y el siguiente paso lo vuelve a intentar; solo se detiene la
 * ejecución tras MAX_AI_RETRIES fallos seguidos del mismo agente.
 */
async function aiFailed(run: RunRow, deps: Deps, id: AgentId, reason: string): Promise<{ status: RunStatus; done: boolean }> {
  const nombre = id === "develop" ? "Develop" : "Testing";
  const fallos = (run.agents[id].fallosSeguidos ?? 0) + 1;
  if (fallos >= MAX_AI_RETRIES) return fail(run, deps, `${nombre} no ha podido usar la IA tras ${fallos} intentos: ${reason}`);
  const agents = run.agents;
  agents[id] = { ...agents[id], fallosSeguidos: fallos, estado: "esperando", actividad: `La IA no respondió bien; reintentando (${fallos}/${MAX_AI_RETRIES - 1})` };
  await deps.store.addEvent(run.id, { agent: "sistema", kind: "reintento", message: `La IA de ${nombre} no ha dado una respuesta válida (${reason.slice(0, 200)}). Se reintenta el mismo paso (${fallos}/${MAX_AI_RETRIES - 1}).` });
  await deps.store.patchRun(run.id, { agents });
  return { status: run.status, done: false };
}

async function fail(run: RunRow, deps: Deps, message: string): Promise<{ status: RunStatus; done: boolean }> {
  const agents = run.agents;
  for (const id of ["orquestador", "develop", "testing"] as AgentId[]) {
    agents[id] = { ...agents[id], estado: id === "orquestador" ? "error" : "inactivo", actividad: id === "orquestador" ? "Ejecución detenida" : "Sin trabajo" };
  }
  await deps.store.addEvent(run.id, { agent: "sistema", kind: "error", message });
  await deps.store.patchRun(run.id, { status: "fallida", error: message, agents, finished: true });
  return { status: "fallida", done: true };
}

/**
 * Cancela una ejecución en curso a petición del usuario. Devuelve false si ya había terminado.
 * El almacén no deja que un paso que todavía estuviera en marcha vuelva a cambiar el estado final.
 */
export async function cancelRun(runId: number, store: Store): Promise<boolean> {
  const run = await store.getRun(runId);
  if (!run || run.status === "completada" || run.status === "fallida") return false;
  const agents = run.agents;
  for (const id of ["orquestador", "develop", "testing"] as AgentId[]) {
    agents[id] = { ...agents[id], estado: "inactivo", actividad: "Petición cancelada" };
  }
  await store.addEvent(run.id, { agent: "sistema", kind: "cancelada", message: "Petición cancelada por el usuario. La web publicada no se ha modificado." });
  await store.patchRun(run.id, { status: "fallida", error: "Cancelada por el usuario", agents, finished: true });
  return true;
}
