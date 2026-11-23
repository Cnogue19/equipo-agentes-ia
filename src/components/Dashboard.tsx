"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@/lib/auth";
import type { AgentsState, Run, RunEvent, Task } from "@/lib/types";
import { initialAgents } from "@/lib/types";
import AgentCards from "./AgentCards";
import TaskBoard from "./TaskBoard";
import ActivityLog from "./ActivityLog";
import CodeView from "./CodeView";
import Preview from "./Preview";
import { ACTIVE_RUN, RUN_STATUS, fecha } from "./ui";

type RunState = {
  run: Omit<Run, "agents"> & { agents: AgentsState; mode: string; ocupado: boolean; ficheros: string[] };
  tasks: Task[];
  events: RunEvent[];
  preview: string;
};
type RunListItem = { id: number; request: string; status: Run["status"]; mode: string; created_at: string; total: number; hechas: number };
type SiteInfo = {
  site: { name: string; ficheros: string[]; updated_at: string; preview: string };
  motor: { modo: string; proveedores: { id: string; nombre: string; disponible: boolean; estado: string }[] };
};

const EJEMPLOS = [
  "Añade una página de contacto a esta web",
  "Añade una página de preguntas frecuentes con 5 preguntas sobre la panadería",
  "Añade una página de precios con una tabla y un aviso de alérgenos",
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string): Promise<T | null> {
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 401) {
    // Sesión caducada: al recargar, el servidor redirige al login.
    window.location.reload();
    return null;
  }
  return r.ok ? ((await r.json()) as T) : null;
}

export default function Dashboard({ user }: { user: User }) {
  const router = useRouter();
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const [state, setState] = useState<RunState | null>(null);
  const [request, setRequest] = useState(EJEMPLOS[0]);
  const [mode, setMode] = useState<"ia" | "simulado">("ia");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<"actividad" | "preview" | "codigo">("actividad");
  const modeTouched = useRef(false);
  const autoSelected = useRef(false);

  const [listVersion, setListVersion] = useState(0);
  const [runVersion, setRunVersion] = useState(0);
  const refreshLists = useCallback(() => setListVersion((v) => v + 1), []);

  // Web actual, motor de IA e historial (se recargan al cambiar listVersion).
  useEffect(() => {
    let cancel = false;
    void getJson<SiteInfo>("/api/site").then((d) => {
      if (cancel || !d) return;
      setInfo(d);
      if (!modeTouched.current) setMode(d.motor.proveedores.some((p) => p.disponible) ? "ia" : "simulado");
    });
    void getJson<{ runs: RunListItem[] }>("/api/runs").then((d) => {
      if (cancel || !d) return;
      setRuns(d.runs);
      // al entrar (solo la primera vez), abrir la más reciente
      const first = autoSelected.current ? null : (d.runs[0]?.id ?? null);
      autoSelected.current = true;
      setRunId((prev) => prev ?? first);
    });
    return () => {
      cancel = true;
    };
  }, [listVersion]);

  const status = state?.run.status;
  const active = Boolean(status && ACTIVE_RUN.includes(status));

  // Estado de la ejecución seleccionada; en tiempo real (cada 1,2 s) mientras los agentes trabajan.
  useEffect(() => {
    if (!runId) return;
    let cancel = false;
    const load = () =>
      getJson<RunState>(`/api/runs/${runId}`).then((d) => {
        if (!cancel && d) setState(d);
      });
    void load();
    const t = active ? setInterval(load, 1200) : undefined;
    return () => {
      cancel = true;
      if (t) clearInterval(t);
    };
  }, [runId, active, runVersion]);

  // Motor: mientras la ejecución está activa, el navegador va pidiendo el siguiente paso de los agentes.
  useEffect(() => {
    if (!runId || !active) return;
    let cancelled = false;
    (async () => {
      while (!cancelled) {
        try {
          const r = await fetch(`/api/runs/${runId}/step`, { method: "POST" });
          const d = (await r.json().catch(() => ({}))) as { done?: boolean; busy?: boolean };
          if (cancelled) break;
          if (d.done || !r.ok) break;
          if (d.busy) await wait(2500);
        } catch {
          await wait(3000);
        }
      }
      if (!cancelled) {
        setRunVersion((v) => v + 1);
        refreshLists();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, active, refreshLists]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSending(true);
    const r = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request, mode }),
    });
    const d = (await r.json().catch(() => ({}))) as { id?: number; error?: string };
    setSending(false);
    if (!r.ok || !d.id) return setError(d.error ?? "No se ha podido crear la petición");
    setTab("actividad");
    setState(null);
    setRunId(d.id);
    refreshLists();
  }

  async function cancelRun() {
    if (!runId || !confirm("¿Cancelar esta petición? Los agentes se detendrán y la web publicada no cambiará.")) return;
    const r = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
    if (!r.ok) setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se ha podido cancelar");
    setRunVersion((v) => v + 1);
    refreshLists();
  }

  async function resetSite() {
    if (!confirm("¿Restaurar la web de ejemplo a su estado original? Se perderán los cambios hechos por los agentes.")) return;
    const r = await fetch("/api/site", { method: "DELETE" });
    if (!r.ok) return setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "No se ha podido restaurar");
    setState(null);
    setRunId(null);
    setTab("preview");
    refreshLists();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const agents = state?.run.agents ?? initialAgents();
  const tasks = state?.tasks ?? [];
  const done = tasks.filter((t) => t.status === "hecha").length;
  const htmlPages = (state?.run.ficheros ?? info?.site.ficheros ?? []).filter((f) => f.endsWith(".html"));
  const previewToken = state?.preview ?? info?.site.preview;
  const motorIA = (info?.motor.proveedores ?? []).filter((p) => p.disponible);
  const motorTitle = (info?.motor.proveedores ?? []).map((p) => `${p.nombre}: ${p.estado}`).join("\n") || "No hay ningún proveedor de IA configurado";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="shrink-0 whitespace-nowrap text-2xl" aria-hidden>🧭🛠️🧪</span>
            <div>
              <h1 className="font-bold leading-tight">Equipo de agentes IA</h1>
              <p className="text-xs text-slate-500">Orquestador · Develop · Testing — trabajando sobre «{info?.site.name ?? "…"}»</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${motorIA.length ? "bg-indigo-100 text-indigo-800" : "bg-amber-100 text-amber-800"}`}
              title={motorTitle}
            >
              {info ? (motorIA.length ? `IA: ${motorIA.map((p) => p.nombre).join(" → ")}` : "IA no disponible · modo simulado") : "Comprobando IA…"}
            </span>
            <span className="text-slate-600">{user.name}</span>
            <button onClick={logout} className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-100">Salir</button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 p-4 lg:grid-cols-[320px_1fr]">
        {/* Columna izquierda: nueva petición e historial */}
        <aside className="space-y-4">
          <form onSubmit={submit} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <label htmlFor="peticion" className="block font-semibold">Nueva petición para el equipo</label>
            <textarea id="peticion" value={request} onChange={(e) => setRequest(e.target.value)} rows={4} maxLength={600}
              className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <div className="flex flex-wrap gap-1">
              {EJEMPLOS.map((ej) => (
                <button key={ej} type="button" onClick={() => setRequest(ej)} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-200">
                  {ej.length > 38 ? ej.slice(0, 38) + "…" : ej}
                </button>
              ))}
            </div>
            <fieldset className="text-sm">
              <legend className="mb-1 text-xs font-medium text-slate-500">Motor de los agentes</legend>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="modo" checked={mode === "ia"} onChange={() => { modeTouched.current = true; setMode("ia"); }} /> IA real
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="modo" checked={mode === "simulado"} onChange={() => { modeTouched.current = true; setMode("simulado"); }} /> Simulado (sin IA)
                </label>
              </div>
            </fieldset>
            {info && !motorIA.length && (
              <p className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-800">
                La IA real no está disponible ahora mismo ({motorTitle.slice(0, 160)}). Si eliges «IA real», el equipo pasará automáticamente al modo simulado.
              </p>
            )}
            {error &&<p role="alert" className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={sending || active}
              className="w-full rounded-lg bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {active ? "El equipo está trabajando…" : sending ? "Enviando…" : "Enviar al Orquestador"}
            </button>
          </form>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">Historial</h2>
              <button type="button" onClick={resetSite} className="text-xs text-slate-500 hover:text-red-600 hover:underline">Restaurar web de ejemplo</button>
            </div>
            {runs.length === 0 && <p className="text-sm text-slate-500">Todavía no hay peticiones.</p>}
            <ul className="space-y-1">
              {runs.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => { setRunId(r.id); setState(null); }}
                    className={`w-full rounded-lg p-2 text-left text-sm ${r.id === runId ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-slate-50"}`}>
                    <span className="line-clamp-2">{r.request}</span>
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                      <span className={`rounded-full px-1.5 py-0.5 font-semibold ${RUN_STATUS[r.status].cls}`}>{RUN_STATUS[r.status].label}</span>
                      <span>{r.hechas}/{r.total} tareas</span>
                      <span>{r.mode === "simulado" ? "simulado" : "IA"}</span>
                      <span className="ml-auto">{fecha(r.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        {/* Zona principal */}
        <main className="min-w-0 space-y-4">
          {state ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">Petición #{state.run.id} · {state.run.mode === "simulado" ? "modo simulado (sin IA)" : "modo IA"}</p>
                  <h2 className="truncate text-lg font-semibold">«{state.run.request}»</h2>
                </div>
                <div className="flex items-center gap-2">
                  {active && (
                    <button type="button" onClick={cancelRun}
                      className="rounded-lg border border-red-200 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50">
                      Cancelar
                    </button>
                  )}
                  <span className={`rounded-full px-3 py-1 text-sm font-semibold ${RUN_STATUS[state.run.status].cls}`}>{RUN_STATUS[state.run.status].label}</span>
                </div>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={tasks.length || 1} aria-valuenow={done} aria-label="Tareas completadas">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all" style={{ width: `${tasks.length ? (done / tasks.length) * 100 : active ? 5 : 0}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-500">{done} de {tasks.length || "?"} tareas terminadas y verificadas</p>
              {state.run.error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{state.run.error}</p>}
            </section>
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Cómo trabaja el equipo</h2>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
                <li><b>Orquestador</b> recibe tu petición, la divide en tareas con criterios de aceptación y se las reparte.</li>
                <li><b>Develop</b> implementa cada tarea modificando el código de la web.</li>
                <li><b>Testing</b> ejecuta comprobaciones automáticas y revisa los criterios; si algo falla, se lo devuelve a Develop.</li>
                <li>El ciclo se repite hasta que todo pasa. Después, la web publicada se actualiza.</li>
              </ol>
              <p className="mt-3 text-sm text-slate-500">Escribe una petición a la izquierda (por ejemplo «Añade una página de contacto a esta web») y pulsa «Enviar al Orquestador».</p>
            </section>
          )}

          <AgentCards agents={agents} tasks={tasks} />

          {state && (
            <section>
              <h3 className="mb-2 font-semibold">Tareas</h3>
              <TaskBoard tasks={tasks} />
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div role="tablist" className="mb-3 flex gap-1 border-b border-slate-200">
              {([
                ["actividad", "Actividad de los agentes"],
                ["preview", "Vista previa de la web"],
                ["codigo", "Código y cambios"],
              ] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                  {label}
                </button>
              ))}
            </div>

            {tab === "actividad" && (state ? <ActivityLog events={state.events} /> : <p className="text-sm text-slate-500">Aquí verás, en tiempo real, cada paso de cada agente.</p>)}

            {tab === "preview" && previewToken && (
              <Preview
                token={previewToken}
                pages={htmlPages}
                version={`${state?.run.id ?? "web"}-${state?.run.steps ?? info?.site.updated_at ?? ""}`}
                label={state ? `Versión de la petición #${state.run.id}` : "Web actual"}
              />
            )}

            {tab === "codigo" && (state ? <CodeView runId={state.run.id} version={`${state.run.steps}`} /> : <p className="text-sm text-slate-500">Elige una petición para ver sus cambios.</p>)}
          </section>
        </main>
      </div>
    </div>
  );
}
