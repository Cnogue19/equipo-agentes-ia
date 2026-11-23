"use client";

import { useState } from "react";
import type { Task, TaskStatus } from "@/lib/types";
import { MAX_ATTEMPTS } from "@/lib/types";
import { AGENTS, TASK_STATUS } from "./ui";

const COLUMNS: { titulo: string; estados: TaskStatus[] }[] = [
  { titulo: "Pendiente", estados: ["pendiente"] },
  { titulo: "Desarrollo", estados: ["en_desarrollo", "corrigiendo"] },
  { titulo: "Pruebas", estados: ["en_pruebas"] },
  { titulo: "Hecha", estados: ["hecha", "bloqueada"] },
];

/** Tablero con todas las tareas y el estado de cada una. */
export default function TaskBoard({ tasks }: { tasks: Task[] }) {
  if (!tasks.length) {
    return <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">El Orquestador todavía no ha creado las tareas.</p>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => col.estados.includes(t.status));
        return (
          <div key={col.titulo} className="rounded-xl bg-slate-100/70 p-2">
            <h4 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {col.titulo} <span className="text-slate-400">({items.length})</span>
            </h4>
            <div className="space-y-2">
              {items.map((t) => <TaskCard key={t.id} task={t} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const st = TASK_STATUS[task.status];
  const assignee = task.assignee ? AGENTS[task.assignee] : null;
  const criteriaResults = task.checks?.criterios;
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h5 className="font-medium leading-snug">
          <span className="text-slate-400">#{task.idx + 1}</span> {task.title}
        </h5>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${st.cls}`}>{st.label}</span>
        {task.attempts > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Intento {task.attempts}/{MAX_ATTEMPTS}</span>}
        {assignee && <span className={`rounded-full px-2 py-0.5 ${assignee.bg} ${assignee.text}`}>{assignee.emoji} {assignee.nombre}</span>}
      </div>
      {task.status === "corrigiendo" && task.feedback?.length ? (
        <ul className="mt-2 space-y-1 rounded-md bg-orange-50 p-2 text-[11px] text-orange-900">
          {task.feedback.slice(0, 4).map((f, i) => <li key={i}>• {f}</li>)}
        </ul>
      ) : null}
      <button type="button" onClick={() => setOpen(!open)} className="mt-2 text-[11px] font-medium text-indigo-600 hover:underline" aria-expanded={open}>
        {open ? "Ocultar detalles" : "Ver criterios y pruebas"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-[12px]">
          <p className="text-slate-600">{task.description}</p>
          <ul className="space-y-1">
            {task.criteria.map((c, i) => {
              const r = criteriaResults?.[i];
              return (
                <li key={i} className="flex gap-1.5">
                  <span aria-hidden>{r ? (r.cumple ? "✅" : "❌") : "⬜"}</span>
                  <span>
                    {c}
                    {r && <span className="block text-slate-500">{r.motivo}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {task.checks?.automaticas && (
            <p className="text-slate-500">
              Comprobaciones automáticas: {task.checks.automaticas.filter((c) => c.estado === "ok").length} ok ·{" "}
              {task.checks.automaticas.filter((c) => c.estado === "error").length} errores ·{" "}
              {task.checks.automaticas.filter((c) => c.estado === "aviso").length} avisos
            </p>
          )}
          {task.changed?.length ? <p className="text-slate-500">Ficheros: {task.changed.join(", ")}</p> : null}
        </div>
      )}
    </article>
  );
}
