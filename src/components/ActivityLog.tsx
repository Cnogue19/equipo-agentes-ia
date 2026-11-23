"use client";

import { useEffect, useRef } from "react";
import type { CheckResult, RunEvent } from "@/lib/types";
import { AGENTS, hora } from "./ui";

const SYSTEM = { nombre: "Sistema", emoji: "⚙️", border: "border-slate-300", text: "text-slate-600" };

/** Registro cronológico de todo lo que hace cada agente. */
export default function ActivityLog({ events }: { events: RunEvent[] }) {
  const box = useRef<HTMLOListElement>(null);
  const count = events.length;
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [count]);

  return (
    <ol ref={box} className="max-h-[520px] space-y-2 overflow-y-auto pr-1" aria-live="polite">
      {events.map((e) => {
        const meta = e.agent === "sistema" ? SYSTEM : AGENTS[e.agent];
        const data = (e.data ?? {}) as { fallos?: string[]; archivos?: string[]; automaticas?: CheckResult[]; tareas?: string[] };
        const isError = e.kind === "error" || e.kind === "bloqueada";
        const isOk = e.kind === "aprobado" || e.kind === "fin";
        return (
          <li key={e.id} className={`rounded-lg border-l-4 bg-white p-3 shadow-sm ${meta.border} ${isError ? "bg-red-50" : isOk ? "bg-green-50" : ""}`}>
            <div className="flex items-center justify-between text-[11px]">
              <span className={`font-semibold ${meta.text}`}>{meta.emoji} {meta.nombre}</span>
              <time className="text-slate-400">{hora(e.created_at)}</time>
            </div>
            <p className="mt-1 text-sm text-slate-800">{e.message}</p>
            {data.tareas && (
              <ol className="mt-1 list-decimal pl-5 text-[12px] text-slate-600">{data.tareas.map((t, i) => <li key={i}>{t}</li>)}</ol>
            )}
            {data.fallos && (
              <ul className="mt-1 space-y-0.5 text-[12px] text-red-800">{data.fallos.map((f, i) => <li key={i}>✗ {f}</li>)}</ul>
            )}
            {data.automaticas && (
              <details className="mt-1 text-[12px]">
                <summary className="cursor-pointer text-slate-500">Ver las {data.automaticas.length} comprobaciones automáticas</summary>
                <ul className="mt-1 space-y-0.5">
                  {data.automaticas.map((c) => (
                    <li key={c.id} className={c.estado === "error" ? "text-red-700" : c.estado === "aviso" ? "text-amber-700" : "text-slate-600"}>
                      {c.estado === "ok" ? "✓" : c.estado === "error" ? "✗" : "!"} {c.nombre}: {c.detalle}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}
