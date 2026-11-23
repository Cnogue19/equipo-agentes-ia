/** Tipos compartidos entre servidor y cliente. */

export type Files = Record<string, string>;

export type AgentId = "orquestador" | "develop" | "testing";

export type AgentStatus = "inactivo" | "pensando" | "trabajando" | "esperando" | "terminado" | "error";

export type AgentState = {
  estado: AgentStatus;
  actividad: string;
  motor: string | null;
  llamadas: number;
  tokensEntrada: number;
  tokensSalida: number;
};

export type AgentsState = Record<AgentId, AgentState>;

export type RunStatus = "pendiente" | "planificando" | "en_curso" | "completada" | "fallida";

export type TaskStatus = "pendiente" | "en_desarrollo" | "en_pruebas" | "corrigiendo" | "hecha" | "bloqueada";

export type CheckResult = {
  id: string;
  nombre: string;
  estado: "ok" | "error" | "aviso";
  detalle: string;
};

export type CriterionResult = { criterio: string; cumple: boolean; motivo: string };

export type Run = {
  id: number;
  request: string;
  status: RunStatus;
  summary: string | null;
  agents: AgentsState;
  error: string | null;
  steps: number;
  created_at: string;
  finished_at: string | null;
};

export type Task = {
  id: number;
  run_id: number;
  idx: number;
  title: string;
  description: string;
  criteria: string[];
  status: TaskStatus;
  assignee: AgentId | null;
  attempts: number;
  feedback: string[] | null;
  checks: { automaticas: CheckResult[]; criterios: CriterionResult[] } | null;
  changed: string[] | null;
};

export type RunEvent = {
  id: number;
  task_id: number | null;
  agent: AgentId | "sistema";
  kind: string;
  message: string;
  data: unknown;
  created_at: string;
};

export const MAX_ATTEMPTS = 4;

export function initialAgents(): AgentsState {
  const base = (): AgentState => ({
    estado: "inactivo",
    actividad: "Esperando trabajo",
    motor: null,
    llamadas: 0,
    tokensEntrada: 0,
    tokensSalida: 0,
  });
  return { orquestador: base(), develop: base(), testing: base() };
}
