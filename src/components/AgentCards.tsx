"use client";

import type { AgentId, AgentsState, Task } from "@/lib/types";
import { AGENTS, AGENT_STATUS } from "./ui";

const ORDER: AgentId[] = ["orquestador", "develop", "testing"];

/** Tarjetas de los tres agentes con su estado y actividad en tiempo real, unidas por el flujo de trabajo. */
export default function AgentCards({ agents, tasks }: { agents: AgentsState; tasks: Task[] }) {
  const busy = (id: AgentId) => ["pensando", "trabajando"].includes(agents[id].estado);
  const current = tasks.find((t) => t.status !== "hecha");
  const flowDevelop = current && ["en_desarrollo", "corrigiendo"].includes(current.status);
  const flowTesting = current?.status === "en_pruebas";

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2">
      {ORDER.map((id, i) => {
        const a = agents[id];
        const meta = AGENTS[id];
        const st = AGENT_STATUS[a.estado];
        return (
          <div key={id} className="contents">
            <section
              aria-label={`Agente ${meta.nombre}`}
              className={`min-w-0 rounded-2xl border bg-white p-4 shadow-sm transition ${busy(id) ? `ring-2 ${meta.ring}` : "border-slate-200"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`grid h-10 w-10 place-items-center rounded-xl text-xl ${meta.bg}`} aria-hidden>{meta.emoji}</span>
                  <div>
                    <h3 className="font-semibold leading-tight">{meta.nombre}</h3>
                    <p className="text-[11px] text-slate-500 leading-tight">{meta.rol}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>
                  {st.pulse && <span className="h-2 w-2 rounded-full bg-current animate-ping" />}
                  {st.label}
                </span>
              </div>
              <p className="mt-3 min-h-[2.5rem] text-sm text-slate-700" aria-live="polite">{a.actividad}</p>
              <dl className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-slate-500">
                <div><dt>Llamadas</dt><dd className="font-semibold text-slate-700">{a.llamadas}</dd></div>
                <div><dt>Tokens entrada</dt><dd className="font-semibold text-slate-700">{a.tokensEntrada.toLocaleString("es-ES")}</dd></div>
                <div><dt>Tokens salida</dt><dd className="font-semibold text-slate-700">{a.tokensSalida.toLocaleString("es-ES")}</dd></div>
              </dl>
              <p className="mt-2 truncate text-[11px] text-slate-400" title={a.motor ?? ""}>Motor: {a.motor ?? "—"}</p>
            </section>
            {i < ORDER.length - 1 && (
              <div className="hidden xl:flex flex-col items-center justify-center gap-1 text-[10px] text-slate-400 w-14" aria-hidden>
                <span>{i === 0 ? "asigna" : "entrega"}</span>
                <div className={`h-1 w-full rounded ${(i === 0 ? flowDevelop : flowTesting) ? "flecha-activa text-blue-500" : "bg-slate-200"}`} />
                <span>{i === 0 ? "tareas" : "→  ← fallos"}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
