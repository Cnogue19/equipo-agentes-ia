/**
 * Capa de IA: llama a un modelo de lenguaje y devuelve JSON validado con Zod.
 *
 * Proveedores (se prueban en orden; si uno no está disponible se pasa al siguiente):
 *  1. "gateway"   → Claude vía Vercel AI Gateway (SDK oficial de Anthropic, autenticado con el
 *                   token OIDC del propio despliegue de Vercel: no hace falta ninguna clave).
 *  2. "anthropic" → Claude con ANTHROPIC_API_KEY (SDK oficial de Anthropic).
 *  3. "groq"      → Groq (plan gratuito) con GROQ_API_KEY, API compatible con OpenAI.
 * Si ninguno funciona, los agentes usan su modo "simulado" (lógica determinista, sin IA).
 *
 * Ninguna clave está en el repositorio: todas se leen de variables de entorno.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export type LlmRequest<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  effort: "low" | "medium" | "high";
  maxTokens: number;
  /** Se llama mientras el modelo trabaja: si está razonando o escribiendo, caracteres y segundos. */
  onProgress?: (p: LlmProgress) => void;
};

export type LlmProgress = { fase: "razonando" | "escribiendo"; caracteres: number; segundos: number; modelo: string };

export type LlmResult<T> = { data: T; motor: string; tokensIn: number; tokensOut: number };

type Provider = {
  id: "gateway" | "anthropic" | "groq";
  label: string;
  configured: () => boolean;
  call: <T>(req: LlmRequest<T>) => Promise<LlmResult<T>>;
};

/** Error que indica que el proveedor no se puede usar (sin crédito, sin permiso…). */
export class ProviderUnavailableError extends Error {}

const GATEWAY_URL = "https://ai-gateway.vercel.sh";

/** Proveedores desactivados temporalmente tras un error de cuenta/crédito. */
const disabledUntil = new Map<string, { until: number; reason: string }>();

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("La respuesta del modelo no contiene JSON");
  return JSON.parse(text.slice(start, end + 1));
}

function schemaHint<T>(schema: z.ZodType<T>) {
  return `\n\nResponde ÚNICAMENTE con un objeto JSON válido que cumpla este JSON Schema (sin texto antes ni después, sin bloques de código):\n${JSON.stringify(z.toJSONSchema(schema))}`;
}

async function gatewayToken(): Promise<string | null> {
  if (process.env.AI_GATEWAY_API_KEY) return process.env.AI_GATEWAY_API_KEY;
  try {
    const { getVercelOidcToken } = await import("@vercel/oidc");
    return await getVercelOidcToken();
  } catch {
    return process.env.VERCEL_OIDC_TOKEN ?? null;
  }
}

/** JSON Schema del esquema Zod (sin el auto-parseo del SDK: el resultado se valida aquí, tras mirar stop_reason). */
function jsonFormat<T>(schema: z.ZodType<T>) {
  const { type, schema: jsonSchema } = zodOutputFormat(schema);
  return { type, schema: jsonSchema };
}

export async function callClaude<T>(
  client: Anthropic,
  model: string,
  motor: string,
  req: LlmRequest<T>,
  basic = false,
  timeoutMs?: number,
): Promise<LlmResult<T>> {
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.prompt + schemaHint(req.schema) }],
        // Salida estructurada (JSON Schema) + nivel de esfuerzo. En modo "basic" se omiten por si
        // el intermediario (p. ej. la pasarela) no los admite; el esquema sigue en el prompt.
        ...(basic ? {} : { output_config: { effort: req.effort, format: jsonFormat(req.schema) } }),
      },
      timeoutMs ? { timeout: timeoutMs, maxRetries: 0 } : undefined,
    );
    // El timeout del SDK solo cubre hasta recibir las cabeceras; si el modelo sigue escribiendo,
    // se corta aquí el stream para no superar el límite de tiempo de la función de Vercel.
    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        stream.abort();
      }, timeoutMs);
    }
    let chars = 0;
    let thinking = 0;
    const report = (fase: LlmProgress["fase"], caracteres: number) =>
      req.onProgress?.({ fase, caracteres, segundos: Math.round((Date.now() - t0) / 1000), modelo: model });
    // Los modelos que razonan pasan un rato "pensando" antes de escribir: se informa de ambas fases.
    stream.on("thinking", (delta) => {
      thinking += delta.length;
      report("razonando", thinking);
    });
    stream.on("text", (delta) => {
      chars += delta.length;
      report("escribiendo", chars);
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("El modelo rechazó la petición (refusal)");
    if (msg.stop_reason === "max_tokens") throw new Error("La respuesta se cortó por max_tokens");
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const data = req.schema.parse(extractJson(text));
    return { data, motor, tokensIn: msg.usage.input_tokens, tokensOut: msg.usage.output_tokens };
  } catch (e) {
    if (timedOut) throw new Error(`${motor}: sin terminar tras ${Math.round((timeoutMs ?? 0) / 1000)} s (tiempo agotado)`);
    if (!basic && e instanceof Anthropic.BadRequestError) {
      const remaining = timeoutMs ? timeoutMs - (Date.now() - t0) : undefined;
      return callClaude(client, model, motor, req, true, remaining);
    }
    if (
      e instanceof Anthropic.AuthenticationError ||
      e instanceof Anthropic.PermissionDeniedError ||
      e instanceof Anthropic.NotFoundError ||
      (e instanceof Anthropic.APIError && (e.status === 402 || e.status === 403))
    ) {
      throw new ProviderUnavailableError(`${motor}: ${e.message.slice(0, 300)}`);
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Modelos que se prueban en la pasarela, en orden. Claude primero; si la cuenta está en el plan
 * gratuito de AI Gateway (que no incluye Claude), se usan modelos abiertos gratuitos de la misma
 * pasarela, con el mismo SDK y la misma API de Messages.
 */
function gatewayModels(): string[] {
  const list = process.env.AI_GATEWAY_MODELS || process.env.AI_GATEWAY_MODEL;
  return (list || "anthropic/claude-opus-5.5,recursive/flint-v1.0,nvidia/nemotron-3.5-lightning-free")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

const GATEWAY_BUDGET_MS = 260_000;
const PER_MODEL_MAX_MS = 170_000;

/** Modelos de la pasarela no disponibles para esta cuenta (p. ej. Claude en el plan gratuito). */
const modelUnavailable = new Map<string, number>();
/** Último modelo de la pasarela que respondió bien (se muestra en pantalla). */
let lastGatewayModel: string | null = null;

const providers: Provider[] = [
  {
    id: "gateway",
    label: "Vercel AI Gateway",
    configured: () => Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN),
    call: async (req) => {
      const token = await gatewayToken();
      if (!token) throw new ProviderUnavailableError("gateway: sin token OIDC ni AI_GATEWAY_API_KEY");
      const client = new Anthropic({ apiKey: token, baseURL: GATEWAY_URL, maxRetries: 0 });
      // Presupuesto de tiempo por paso: la función de Vercel se corta a los 300 s.
      const deadline = Date.now() + GATEWAY_BUDGET_MS;
      const models = gatewayModels().filter((m) => (modelUnavailable.get(m) ?? 0) <= Date.now());
      const reasons: string[] = [];
      for (const [i, model] of models.entries()) {
        const remaining = deadline - Date.now();
        if (remaining < 20_000) break;
        // Si quedan más modelos detrás, este no puede gastarse todo el tiempo.
        const timeout = i < models.length - 1 ? Math.min(remaining, PER_MODEL_MAX_MS) : remaining;
        try {
          const result = await callClaude(client, model, `${model} · AI Gateway`, req, false, timeout);
          lastGatewayModel = model;
          return result;
        } catch (e) {
          if (!(e instanceof ProviderUnavailableError)) {
            // Lento o respuesta no válida: probar con el siguiente modelo dentro del mismo paso.
            reasons.push(`${model}: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
            continue;
          }
          modelUnavailable.set(model, Date.now() + 10 * 60_000);
          reasons.push(e.message.slice(0, 160));
        }
      }
      // Si algún modelo existía pero falló (lento o respuesta no válida), no se desactiva la pasarela.
      const anyTried = models.some((m) => (modelUnavailable.get(m) ?? 0) <= Date.now());
      const msg = reasons.join(" | ") || "gateway: ningún modelo disponible";
      throw anyTried ? new Error(msg) : new ProviderUnavailableError(msg);
    },
  },
  {
    id: "anthropic",
    label: "Claude (API de Anthropic)",
    configured: () => Boolean(process.env.ANTHROPIC_API_KEY),
    call: async (req) => {
      const model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
      const client = new Anthropic({ maxRetries: 1, timeout: 240_000 });
      return callClaude(client, model, `${model} · API Anthropic`, req);
    },
  },
  {
    id: "groq",
    label: "Groq (plan gratuito)",
    configured: () => Boolean(process.env.GROQ_API_KEY),
    call: async <T>(req: LlmRequest<T>): Promise<LlmResult<T>> => {
      const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model,
          max_completion_tokens: req.maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.prompt + schemaHint(req.schema) },
          ],
        }),
        signal: AbortSignal.timeout(240_000),
      });
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        throw new ProviderUnavailableError(`groq: HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`groq: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as {
        choices: { message: { content: string } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      const text = json.choices[0]?.message?.content ?? "";
      req.onProgress?.({ fase: "escribiendo", caracteres: text.length, segundos: 0, modelo: model });
      const data = req.schema.parse(extractJson(text));
      return { data, motor: `${model} · Groq`, tokensIn: json.usage?.prompt_tokens ?? 0, tokensOut: json.usage?.completion_tokens ?? 0 };
    },
  },
];

/** Motor elegido por configuración: AI_ENGINE=auto (por defecto) | simulado | gateway | anthropic | groq */
function enabledProviders(): Provider[] {
  const mode = (process.env.AI_ENGINE || "auto").toLowerCase();
  if (mode === "simulado") return [];
  const list = mode === "auto" ? providers : providers.filter((p) => p.id === mode);
  return list.filter((p) => p.configured());
}

export type EngineInfo = {
  modo: string;
  proveedores: { id: string; nombre: string; disponible: boolean; estado: string }[];
};

const probedAt = new Map<string, number>();

/** Prueba rápida (cacheada 10 min) de que el proveedor responde: una llamada mínima al modelo. */
async function probe(p: Provider) {
  const last = probedAt.get(p.id) ?? 0;
  if (Date.now() - last < 10 * 60_000) return;
  probedAt.set(p.id, Date.now());
  try {
    await p.call({
      system: "Responde solo con el JSON pedido.",
      prompt: 'Devuelve {"ok": true}',
      schema: z.object({ ok: z.boolean() }),
      effort: "low",
      maxTokens: 400,
    });
    disabledUntil.delete(p.id);
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 300) : String(e);
    disabledUntil.set(p.id, { until: Date.now() + 10 * 60_000, reason });
  }
}

export async function engineInfo(): Promise<EngineInfo> {
  const list = enabledProviders();
  await Promise.all(list.map(probe));
  const now = Date.now();
  return {
    modo: process.env.AI_ENGINE || "auto",
    proveedores: list.map((p) => {
      const d = disabledUntil.get(p.id);
      const disponible = !(d && d.until > now);
      const nombre = p.id === "gateway" && disponible && lastGatewayModel ? `${p.label} · ${lastGatewayModel}` : p.label;
      return { id: p.id, nombre, disponible, estado: disponible ? "disponible" : `no disponible: ${d!.reason}` };
    }),
  };
}

/**
 * Llama al primer proveedor disponible. Devuelve null si no hay ninguno (→ modo simulado),
 * junto con el motivo para mostrarlo en pantalla.
 */
export async function callLlm<T>(req: LlmRequest<T>): Promise<{ result: LlmResult<T> | null; reason: string }> {
  const reasons: string[] = [];
  const now = Date.now();
  for (const p of enabledProviders()) {
    const d = disabledUntil.get(p.id);
    if (d && d.until > now) {
      reasons.push(d.reason);
      continue;
    }
    let lastError: unknown;
    // Hasta 2 intentos por proveedor (p. ej. si el JSON no valida a la primera).
    const started = Date.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { result: await p.call(req), reason: "" };
      } catch (e) {
        lastError = e;
        if (e instanceof ProviderUnavailableError) break;
        // Solo se reintenta si el primer intento fue rápido (no pasarse del límite de Vercel).
        if (Date.now() - started > 60_000) break;
      }
    }
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    if (lastError instanceof ProviderUnavailableError) {
      disabledUntil.set(p.id, { until: now + 10 * 60_000, reason: msg });
    }
    reasons.push(msg.slice(0, 300));
  }
  return { result: null, reason: reasons.length ? reasons.join(" | ") : "No hay ningún proveedor de IA configurado" };
}
