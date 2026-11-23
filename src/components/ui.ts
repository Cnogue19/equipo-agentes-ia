import type { AgentId, AgentStatus, RunStatus, TaskStatus } from "@/lib/types";

export const AGENTS: Record<AgentId, { nombre: string; emoji: string; rol: string; ring: string; bg: string; text: string; border: string }> = {
  orquestador: {
    nombre: "Orquestador",
    emoji: "🧭",
    rol: "Recibe la petición, la divide en tareas y se las reparte a Develop y Testing",
    ring: "ring-indigo-400",
    bg: "bg-indigo-50",
    text: "text-indigo-700",
    border: "border-indigo-400",
  },
  develop: {
    nombre: "Develop",
    emoji: "🛠️",
    rol: "Hace las tareas de desarrollo: escribe y modifica el código de la web",
    ring: "ring-amber-400",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-400",
  },
  testing: {
    nombre: "Testing",
    emoji: "🧪",
    rol: "Comprueba lo que ha hecho Develop y le devuelve lo que falla hasta que todo pasa",
    ring: "ring-emerald-400",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-400",
  },
};

export const AGENT_STATUS: Record<AgentStatus, { label: string; cls: string; pulse: boolean }> = {
  inactivo: { label: "Inactivo", cls: "bg-slate-100 text-slate-600", pulse: false },
  pensando: { label: "Pensando", cls: "bg-violet-100 text-violet-700", pulse: true },
  trabajando: { label: "Trabajando", cls: "bg-blue-100 text-blue-700", pulse: true },
  esperando: { label: "Esperando", cls: "bg-slate-100 text-slate-700", pulse: false },
  terminado: { label: "Terminado", cls: "bg-green-100 text-green-700", pulse: false },
  error: { label: "Detenido", cls: "bg-red-100 text-red-700", pulse: false },
};

export const RUN_STATUS: Record<RunStatus, { label: string; cls: string }> = {
  pendiente: { label: "En cola", cls: "bg-slate-100 text-slate-700" },
  planificando: { label: "Planificando", cls: "bg-violet-100 text-violet-700" },
  en_curso: { label: "En curso", cls: "bg-blue-100 text-blue-700" },
  completada: { label: "Completada", cls: "bg-green-100 text-green-700" },
  fallida: { label: "Fallida", cls: "bg-red-100 text-red-700" },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-slate-100 text-slate-700" },
  en_desarrollo: { label: "En desarrollo", cls: "bg-amber-100 text-amber-800" },
  corrigiendo: { label: "Corrigiendo fallos", cls: "bg-orange-100 text-orange-800" },
  en_pruebas: { label: "En pruebas", cls: "bg-emerald-100 text-emerald-800" },
  hecha: { label: "Hecha ✓", cls: "bg-green-100 text-green-800" },
  bloqueada: { label: "Bloqueada", cls: "bg-red-100 text-red-700" },
};

export const ACTIVE_RUN: RunStatus[] = ["pendiente", "planificando", "en_curso"];

export function hora(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fecha(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Duración legible entre dos instantes (o hasta ahora si no ha terminado). */
export function duracion(desde: string, hasta: string | null, ahora: number) {
  const ms = (hasta ? new Date(hasta).getTime() : ahora) - new Date(desde).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}
