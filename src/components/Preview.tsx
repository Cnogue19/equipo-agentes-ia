"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Vista previa de la web generada. El HTML (con CSS/JS incrustados) se carga en un iframe
 * aislado mediante srcdoc + sandbox: su código no puede acceder a la sesión ni a la API.
 */
export default function Preview({ token, pages, version, label }: { token: string; pages: string[]; version: string; label: string }) {
  const [page, setPage] = useState("index.html");
  const [doc, setDoc] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const current = pages.includes(page) ? page : (pages[0] ?? "index.html");

  useEffect(() => {
    let cancel = false;
    fetch(`/preview/${token}/${current}?embed=1`, { cache: "no-store" })
      .then((r) => r.text())
      .then((t) => {
        if (!cancel) setDoc(t);
      });
    return () => {
      cancel = true;
    };
  }, [token, current, version]);

  // Navegación entre páginas dentro de la vista previa (enlaces del menú de la web).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const data = e.data as { tipo?: string; pagina?: string };
      if (data?.tipo === "navegar-preview" && typeof data.pagina === "string") {
        const target = data.pagina.replace(/^\.\//, "");
        if (pages.includes(target)) setPage(target);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pages]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="pagina" className="text-slate-600">Página:</label>
        <select id="pagina" value={current} onChange={(e) => setPage(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1">
          {pages.map((p) => <option key={p}>{p}</option>)}
        </select>
        <a href={`/preview/${token}/${current}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">Abrir en otra pestaña ↗</a>
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      {doc === null ? (
        <p className="p-6 text-sm text-slate-500">Cargando vista previa…</p>
      ) : (
        <iframe
          ref={frame}
          title={`Vista previa: ${current}`}
          srcDoc={doc}
          sandbox="allow-scripts allow-forms allow-modals"
          className="h-[600px] w-full rounded-lg border border-slate-200 bg-white"
        />
      )}
    </div>
  );
}
