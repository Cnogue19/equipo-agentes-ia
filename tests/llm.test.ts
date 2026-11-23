/**
 * Test de integración de la llamada a Claude con el SDK oficial de Anthropic contra un servidor
 * local que imita la API de Messages (streaming SSE). Comprueba la petición que se envía y
 * cómo se interpretan las respuestas, sin gastar crédito.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { callClaude, ProviderUnavailableError } from "../src/lib/ai/llm";

type Handler = (body: Record<string, unknown>) => { status: number; sse?: string[]; json?: unknown };
let handler: Handler;
const bodies: Record<string, unknown>[] = [];
let server: Server;
let baseURL = "";

function sseMessage(text: string, stop = "end_turn") {
  const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  return [
    ev("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1 } } }),
    ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    ...text.match(/[\s\S]{1,20}/g)!.map((chunk) => ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: chunk } })),
    ev("content_block_stop", { type: "content_block_stop", index: 0 }),
    ev("message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 42 } }),
    ev("message_stop", { type: "message_stop" }),
  ];
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      bodies.push(body);
      const r = handler(body);
      if (r.sse) {
        res.writeHead(r.status, { "content-type": "text/event-stream" });
        res.end(r.sse.join(""));
      } else {
        res.writeHead(r.status, { "content-type": "application/json" });
        res.end(JSON.stringify(r.json));
      }
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const schema = z.object({ resumen: z.string(), tareas: z.array(z.string()) });
const req = { system: "sys", prompt: "haz algo", schema, effort: "low" as const, maxTokens: 1000 };
const client = () => new Anthropic({ apiKey: "test", baseURL, maxRetries: 0 });

describe("callClaude (SDK de Anthropic)", () => {
  it("envía salida estructurada + esfuerzo y devuelve el JSON validado con su uso de tokens", async () => {
    bodies.length = 0;
    handler = () => ({ status: 200, sse: sseMessage(JSON.stringify({ resumen: "ok", tareas: ["a", "b"] })) });
    let progress = 0;
    const r = await callClaude(client(), "anthropic/claude-opus-5.5", "motor", { ...req, onProgress: (p) => (progress = p.caracteres) });
    expect(r.data).toEqual({ resumen: "ok", tareas: ["a", "b"] });
    expect(r.tokensIn).toBe(120);
    expect(r.tokensOut).toBe(42);
    expect(progress).toBeGreaterThan(0);
    const sent = bodies[0] as { model: string; stream: boolean; output_config: { effort: string; format: { type: string } } };
    expect(sent.model).toBe("anthropic/claude-opus-5.5");
    expect(sent.stream).toBe(true);
    expect(sent.output_config.effort).toBe("low");
    expect(sent.output_config.format.type).toBe("json_schema");
  });

  it("informa de la fase de razonamiento y después de la de escritura", async () => {
    const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    const full = sseMessage(JSON.stringify({ resumen: "ok", tareas: [] }));
    // Inserta un bloque de razonamiento (índice 0) antes del texto, que pasa a ser el bloque 1.
    const text = full.slice(1).map((e) => e.replace('"index":0', '"index":1'));
    handler = () => ({
      status: 200,
      sse: [
        full[0],
        ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }),
        ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Pienso en el plan…" } }),
        ev("content_block_stop", { type: "content_block_stop", index: 0 }),
        ...text,
      ],
    });
    const fases: string[] = [];
    const r = await callClaude(client(), "recursive/flint-v1.0", "motor", { ...req, onProgress: (p) => fases.push(`${p.fase}:${p.modelo}`) });
    expect(r.data.resumen).toBe("ok");
    expect(fases[0]).toBe("razonando:recursive/flint-v1.0");
    expect(fases.at(-1)).toBe("escribiendo:recursive/flint-v1.0");
  });

  it("si el servidor rechaza los parámetros avanzados (400), reintenta en modo básico", async () => {
    bodies.length = 0;
    handler = (b) =>
      b.output_config
        ? { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "output_config no admitido" } } }
        : { status: 200, sse: sseMessage('Aquí va: {"resumen":"x","tareas":[]}') };
    const r = await callClaude(client(), "m", "motor", req);
    expect(r.data.resumen).toBe("x");
    expect(bodies).toHaveLength(2);
    expect(bodies[1].output_config).toBeUndefined();
  });

  it("un 403 por falta de tarjeta/crédito se convierte en proveedor no disponible", async () => {
    handler = () => ({ status: 403, json: { error: { type: "customer_verification_required", message: "AI Gateway requires a valid credit card" } } });
    await expect(callClaude(client(), "m", "motor", req)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("detecta respuestas cortadas por max_tokens", async () => {
    handler = () => ({ status: 200, sse: sseMessage('{"resumen":"a', "max_tokens") });
    await expect(callClaude(client(), "m", "motor", req)).rejects.toThrow(/max_tokens/);
  });
});
