@AGENTS.md

# Equipo de agentes IA — guía para Claude Code

App Next.js 16 (App Router) con 3 agentes (Orquestador, Develop, Testing) que modifican una web estática de ejemplo.

## Comandos
- `npm run dev` — servidor local (necesita `.env.local`; se obtiene con `vercel env pull`)
- `npm test` — tests (Vitest): comprobaciones de Testing y ciclo completo del motor con un almacén en memoria
- `npm run typecheck` · `npm run lint` · `npm run build`
- `DEMO_EMAIL=… DEMO_PASSWORD=… npm run db:setup` — crea tablas y usuario de prueba

## Arquitectura (dónde está cada cosa)
- `src/lib/engine.ts` — máquina de estados: cada `step()` ejecuta UNA acción de UN agente y la guarda en BD.
- `src/lib/agents/prompts.ts` — system prompts y esquemas Zod de cada agente.
- `src/lib/agents/checks.ts` — comprobaciones automáticas deterministas de Testing (parse5 + acorn).
- `src/lib/agents/simulated.ts` — agentes sin IA (fallback y tests).
- `src/lib/ai/llm.ts` — proveedores de IA (Claude vía Vercel AI Gateway / API de Anthropic / Groq).
- `src/lib/repo.ts` — acceso a Neon Postgres; `src/lib/schema.sql` — esquema.
- `src/components/*` — panel: tarjetas de agentes, tablero de tareas, actividad, vista previa, código.

## Reglas
- Nunca subir claves: todo secreto va en variables de entorno (Vercel) o `.env.local` (ignorado).
- Textos visibles en español.
- El motor no puede depender de la BD directamente: usa la interfaz `Store` (así se testea en memoria).
- Antes de terminar un cambio: `npm test && npm run typecheck && npm run lint && npm run build`.
