"use client";

import { useEffect, useMemo, useState } from "react";
import type { Files } from "@/lib/types";

type Line = { t: "=" | "+" | "-"; s: string };

/** Diff por líneas (LCS). Suficiente para los ficheros pequeños de la web. */
function diffLines(a: string, b: string): Line[] {
  const x = a.split("\n");
  const y = b.split("\n");
  if (x.length * y.length > 4_000_000) return y.map((s) => ({ t: "+", s }));
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Line[] = [];
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { out.push({ t: "=", s: x[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "-", s: x[i++] });
    else out.push({ t: "+", s: y[j++] });
  }
  while (i < x.length) out.push({ t: "-", s: x[i++] });
  while (j < y.length) out.push({ t: "+", s: y[j++] });
  return out;
}

/** Ficheros de la web con los cambios hechos por Develop en esta ejecución. */
export default function CodeView({ runId, version }: { runId: number; version: string }) {
  const [data, setData] = useState<{ files: Files; base: Files } | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [onlyDiff, setOnlyDiff] = useState(true);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/runs/${runId}/files`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (!cancel) setData(d); });
    return () => { cancel = true; };
  }, [runId, version]);

  const list = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.files).sort().map((p) => ({
      path: p,
      estado: !(p in data.base) ? "nuevo" : data.base[p] !== data.files[p] ? "modificado" : "igual",
    }));
  }, [data]);

  const current = selected || list.find((f) => f.estado !== "igual")?.path || list[0]?.path || "";
  const lines = useMemo(() => {
    if (!data || !current) return [];
    return onlyDiff ? diffLines(data.base[current] ?? "", data.files[current] ?? "") : (data.files[current] ?? "").split("\n").map((s) => ({ t: "=" as const, s }));
  }, [data, current, onlyDiff]);

  if (!data) return <p className="p-4 text-sm text-slate-500">Cargando ficheros…</p>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3">
      <ul className="space-y-1 text-sm">
        {list.map((f) => (
          <li key={f.path}>
            <button type="button" onClick={() => setSelected(f.path)}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left ${current === f.path ? "bg-indigo-100 text-indigo-900" : "hover:bg-slate-100"}`}>
              <span className="truncate font-mono text-[12px]">{f.path}</span>
              {f.estado !== "igual" && (
                <span className={`ml-2 rounded px-1.5 text-[10px] font-semibold ${f.estado === "nuevo" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                  {f.estado}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0">
        <label className="mb-2 flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          Resaltar cambios respecto a la web original
        </label>
        <pre className="max-h-[520px] overflow-auto rounded-lg bg-slate-900 p-3 text-[12px] leading-5 text-slate-100">
          {lines.map((l, i) => (
            <div key={i} className={l.t === "+" ? "bg-green-900/60" : l.t === "-" ? "bg-red-900/50 line-through opacity-70" : ""}>
              <span className="mr-3 inline-block w-4 select-none text-slate-500">{l.t === "=" ? " " : l.t}</span>
              {l.s || " "}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
