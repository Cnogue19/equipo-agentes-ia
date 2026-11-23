import { describe, expect, it } from "vitest";
import { cancelRun, step, type Deps } from "../src/lib/engine";
import { templateFiles } from "../src/lib/site-template";
import { hasErrors, runAutomaticChecks } from "../src/lib/agents/checks";
import type { LlmRequest } from "../src/lib/ai/llm";
import { memoryStore } from "./memory-store";

const noSleep = async () => {};

async function runToEnd(deps: Deps, max = 60) {
  for (let i = 0; i < max; i++) {
    const r = await step(1, deps);
    if (r.done) return r;
  }
  throw new Error("No terminó");
}

describe("equipo de agentes en modo simulado", () => {
  it("«Añade una página de contacto»: planifica, desarrolla, detecta fallos, corrige y termina", async () => {
    const m = memoryStore("Añade una página de contacto a esta web", templateFiles(), "simulado");
    const llm = async () => ({ result: null, reason: "sin IA" });
    const r = await runToEnd({ store: m.store, llm, sleep: noSleep });

    expect(r.status).toBe("completada");
    expect(m.tasks).toHaveLength(3);
    expect(m.tasks.every((t) => t.status === "hecha")).toBe(true);
    // Testing devolvió fallos al menos una vez y Develop los corrigió
    expect(m.events.some((e) => e.agent === "testing" && e.kind === "fallos")).toBe(true);
    expect(m.tasks[0].attempts).toBe(2);
    expect(m.tasks[1].attempts).toBe(2);
    // La web final tiene la página, enlazada desde todas las páginas, y pasa las comprobaciones
    const site = m.site();
    expect(site["contacto.html"]).toContain("<form");
    for (const p of ["index.html", "productos.html", "contacto.html"]) expect(site[p]).toContain('href="contacto.html"');
    expect(site["script.js"]).toContain('addEventListener("submit"');
    expect(hasErrors(runAutomaticChecks(site))).toBe(false);
    // Los tres agentes participaron y quedaron en estado terminado
    for (const id of ["orquestador", "develop", "testing"] as const) {
      expect(m.events.some((e) => e.agent === id)).toBe(true);
      expect(m.run.agents[id].estado).toBe("terminado");
    }
  });

  it("repetir la misma petición sobre una web que ya tiene la página también termina bien", async () => {
    const first = memoryStore("Añade una página de contacto a esta web", templateFiles(), "simulado");
    await runToEnd({ store: first.store, llm: async () => ({ result: null, reason: "" }), sleep: noSleep });
    const second = memoryStore("Añade una página de contacto a esta web", first.site(), "simulado");
    const r = await runToEnd({ store: second.store, llm: async () => ({ result: null, reason: "" }), sleep: noSleep });
    expect(r.status).toBe("completada");
    expect(second.site()["contacto.html"]).toMatch(/href="contacto.html" aria-current="page"/);
    expect(hasErrors(runAutomaticChecks(second.site()))).toBe(false);
  });

  it("genera contenido real: 5 preguntas frecuentes y una tabla de precios", async () => {
    const faq = memoryStore("Añade una página de preguntas frecuentes", templateFiles(), "simulado");
    await runToEnd({ store: faq.store, llm: async () => ({ result: null, reason: "" }), sleep: noSleep });
    expect(faq.run.status).toBe("completada");
    expect(faq.site()["preguntas-frecuentes.html"].match(/<details>/g)).toHaveLength(5);
    const precios = memoryStore("Añade una página de precios", templateFiles(), "simulado");
    await runToEnd({ store: precios.store, llm: async () => ({ result: null, reason: "" }), sleep: noSleep });
    expect(precios.run.status).toBe("completada");
    expect(precios.site()["precios.html"]).toContain("<table>");
    expect(hasErrors(runAutomaticChecks(precios.site()))).toBe(false);
  });

  it("funciona con peticiones que no reconoce (página genérica)", async () => {
    const m = memoryStore("Crea una sección de recetas caseras", templateFiles(), "simulado");
    const r = await runToEnd({ store: m.store, llm: async () => ({ result: null, reason: "" }), sleep: noSleep });
    expect(r.status).toBe("completada");
    expect(Object.keys(m.site()).some((p) => p.startsWith("recetas"))).toBe(true);
  });
});

describe("fallos puntuales de la IA a mitad de una petición", () => {
  const plan = { resumen: "", tareas: [{ titulo: "t", descripcion: "Crear contacto.html", criterios: ["c"] }] };
  const dev = { resumen: "Hecho", archivos: [{ ruta: "contacto.html", contenido: templateFiles()["index.html"] }] };
  const ok = (data: unknown) => ({ reason: "", result: { motor: "f", tokensIn: 1, tokensOut: 1, data } });

  it("si Testing falla dos veces (p. ej. respuesta cortada por max_tokens), reintenta y termina", async () => {
    const m = memoryStore("Añade contacto", templateFiles(), "ia");
    let testingCalls = 0;
    const llm = (async (req: LlmRequest<unknown>) => {
      if (req.system.includes("ORQUESTADOR")) return ok(plan);
      if (req.system.includes("DEVELOP")) return ok(dev);
      testingCalls++;
      if (testingCalls <= 2) return { result: null, reason: "La respuesta se cortó por max_tokens" };
      return ok({ observaciones: "", criterios: [{ criterio: "c", cumple: true, motivo: "ok" }] });
    }) as unknown as Deps["llm"];
    const r = await runToEnd({ store: m.store, llm, sleep: noSleep });
    expect(r.status).toBe("completada");
    expect(testingCalls).toBe(3);
    expect(m.events.filter((e) => e.kind === "reintento")).toHaveLength(2);
    expect(m.tasks[0].attempts).toBe(1); // los reintentos de la IA no gastan intentos de la tarea
    expect(m.run.agents.testing.fallosSeguidos).toBe(0);
  });

  it("si Develop falla 3 veces seguidas, la petición se detiene con el motivo", async () => {
    const m = memoryStore("Añade contacto", templateFiles(), "ia");
    const llm = (async (req: LlmRequest<unknown>) =>
      req.system.includes("ORQUESTADOR") ? ok(plan) : { result: null, reason: "modelo caído" }) as unknown as Deps["llm"];
    const r = await runToEnd({ store: m.store, llm, sleep: noSleep });
    expect(r.status).toBe("fallida");
    expect(m.run.error).toContain("tras 3 intentos");
    expect(m.tasks[0].attempts).toBe(1);
  });
});

describe("ediciones puntuales de Develop (buscar → reemplazar)", () => {
  const plan = { resumen: "", tareas: [{ titulo: "Menú", descripcion: "Añadir Contacto al menú", criterios: ["c"] }] };
  const ok = (data: unknown) => ({ reason: "", result: { motor: "f", tokensIn: 1, tokensOut: 1, data } });
  const navLine = '      <a href="productos.html">Productos</a>';

  it("aplica ediciones en varias páginas sin reescribirlas", async () => {
    const m = memoryStore("Añade contacto al menú", templateFiles(), "ia");
    const edicion = (ruta: string, line: string) => ({ ruta, buscar: line, reemplazar: `${line}\n      <a href="index.html#contacto">Contacto</a>` });
    const llm = (async (req: LlmRequest<unknown>) => {
      if (req.system.includes("ORQUESTADOR")) return ok(plan);
      if (req.system.includes("DEVELOP"))
        return ok({ resumen: "Enlace añadido", archivos: [], ediciones: [edicion("index.html", navLine), edicion("productos.html", '      <a href="productos.html" aria-current="page">Productos</a>')] });
      return ok({ observaciones: "", criterios: [{ criterio: "c", cumple: true, motivo: "ok" }] });
    }) as unknown as Deps["llm"];
    const r = await runToEnd({ store: m.store, llm, sleep: noSleep });
    expect(r.status).toBe("completada");
    expect(m.site()["index.html"]).toContain('<a href="index.html#contacto">Contacto</a>');
    expect(m.site()["productos.html"]).toContain('<a href="index.html#contacto">Contacto</a>');
    expect(m.tasks[0].changed).toEqual(["index.html", "productos.html"]);
  });

  it("si un fragmento no existe, la edición vuelve a Develop sin pasar por Testing", async () => {
    const m = memoryStore("Añade contacto al menú", templateFiles(), "ia");
    let devCalls = 0;
    let testingCalls = 0;
    const llm = (async (req: LlmRequest<unknown>) => {
      if (req.system.includes("ORQUESTADOR")) return ok(plan);
      if (req.system.includes("DEVELOP")) {
        devCalls++;
        const buscar = devCalls === 1 ? "<nav>NO EXISTE</nav>" : navLine;
        return ok({ resumen: "", archivos: [], ediciones: [{ ruta: "index.html", buscar, reemplazar: `${navLine}\n      <a href="#">X</a>` }] });
      }
      testingCalls++;
      return ok({ observaciones: "", criterios: [{ criterio: "c", cumple: true, motivo: "ok" }] });
    }) as unknown as Deps["llm"];
    const r = await runToEnd({ store: m.store, llm, sleep: noSleep });
    expect(r.status).toBe("completada");
    expect(devCalls).toBe(2);
    expect(testingCalls).toBe(1);
    expect(m.events.some((e) => e.kind === "fallos" && e.agent === "sistema")).toBe(true);
    expect(m.tasks[0].attempts).toBe(2);
  });
});

describe("cancelar una petición", () => {
  it("detiene la ejecución, no publica cambios y un paso posterior no la reactiva", async () => {
    const m = memoryStore("Añade una página de contacto a esta web", templateFiles(), "simulado");
    const llm = async () => ({ result: null, reason: "" });
    await step(1, { store: m.store, llm, sleep: noSleep }); // planifica
    await step(1, { store: m.store, llm, sleep: noSleep }); // Develop entrega la tarea 1
    expect(await cancelRun(1, m.store)).toBe(true);
    expect(m.run.status).toBe("fallida");
    expect(m.run.error).toBe("Cancelada por el usuario");
    const after = await step(1, { store: m.store, llm, sleep: noSleep });
    expect(after).toEqual({ status: "fallida", done: true });
    expect(m.site()["contacto.html"]).toBeUndefined(); // la web publicada no cambia
    expect(await cancelRun(1, m.store)).toBe(false); // ya estaba terminada
    expect(m.events.at(-1)?.kind).toBe("cancelada");
  });
});

describe("equipo de agentes con IA (modelo falso)", () => {
  it("usa las respuestas del modelo y repite Develop→Testing hasta que pasa", async () => {
    const m = memoryStore("Añade una página de contacto", templateFiles(), "ia");
    let testingCalls = 0;
    const llm = (async (req: LlmRequest<unknown>) => {
      const motor = "modelo-falso";
      if (req.system.includes("ORQUESTADOR")) {
        return { reason: "", result: { motor, tokensIn: 10, tokensOut: 5, data: { resumen: "Una tarea", tareas: [{ titulo: "Crear contacto.html", descripcion: "Página de contacto", criterios: ["Existe contacto.html con formulario"] }] } } };
      }
      if (req.system.includes("DEVELOP")) {
        const html = templateFiles()["index.html"].replace("<title>Panadería La Espiga · Pan artesano</title>", "<title>Contacto</title>");
        return { reason: "", result: { motor, tokensIn: 10, tokensOut: 5, data: { resumen: "Hecho", archivos: [{ ruta: "contacto.html", contenido: html }] } } };
      }
      testingCalls++;
      const cumple = testingCalls > 1; // la primera revisión falla
      return { reason: "", result: { motor, tokensIn: 10, tokensOut: 5, data: { observaciones: "", criterios: [{ criterio: "x", cumple, motivo: cumple ? "ok" : "falta el formulario" }] } } };
    }) as unknown as Deps["llm"];

    const r = await runToEnd({ store: m.store, llm, sleep: noSleep });
    expect(r.status).toBe("completada");
    expect(testingCalls).toBe(2);
    expect(m.tasks[0].attempts).toBe(2);
    expect(m.events.find((e) => e.kind === "fallos")?.data).toMatchObject({ fallos: [expect.stringContaining("falta el formulario")] });
    expect(m.run.agents.develop.llamadas).toBe(2);
    expect(m.run.agents.orquestador.tokensEntrada).toBe(10);
  });

  it("si la IA no está disponible al planificar, continúa en modo simulado", async () => {
    const m = memoryStore("Añade una página de contacto", templateFiles(), "ia");
    const r = await runToEnd({ store: m.store, llm: async () => ({ result: null, reason: "sin crédito" }), sleep: noSleep });
    expect(r.status).toBe("completada");
    expect(m.run.mode).toBe("simulado");
    expect(m.events.some((e) => e.kind === "aviso" && e.message.includes("sin crédito"))).toBe(true);
  });

  it("descarta rutas peligrosas que proponga Develop", async () => {
    const m = memoryStore("x página", templateFiles(), "ia");
    const llm = (async (req: LlmRequest<unknown>) => {
      if (req.system.includes("ORQUESTADOR")) return { reason: "", result: { motor: "f", tokensIn: 0, tokensOut: 0, data: { resumen: "", tareas: [{ titulo: "t", descripcion: "d", criterios: ["c"] }] } } };
      if (req.system.includes("DEVELOP")) return { reason: "", result: { motor: "f", tokensIn: 0, tokensOut: 0, data: { resumen: "", archivos: [{ ruta: "../../etc/passwd", contenido: "x" }, { ruta: "api.php", contenido: "x" }] } } };
      return { reason: "", result: { motor: "f", tokensIn: 0, tokensOut: 0, data: { observaciones: "", criterios: [{ criterio: "c", cumple: true, motivo: "" }] } } };
    }) as unknown as Deps["llm"];
    await runToEnd({ store: m.store, llm, sleep: noSleep });
    expect(Object.keys(m.site())).not.toContain("../../etc/passwd");
    expect(m.events.some((e) => e.message.includes("descartado"))).toBe(true);
  });
});
