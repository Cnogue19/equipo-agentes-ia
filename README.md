# Equipo de agentes IA · Orquestador, Develop y Testing

Pequeño equipo de **3 agentes de IA** que trabajan juntos para modificar una web:

1. **🧭 Orquestador** — recibe una petición (p. ej. «Añade una página de contacto a esta web»), la divide en tareas con criterios de aceptación y se las reparte a los otros dos.
2. **🛠️ Develop** — hace las tareas de desarrollo: crea y modifica los ficheros HTML/CSS/JS de la web.
3. **🧪 Testing** — comprueba lo que ha hecho Develop (comprobaciones automáticas + revisión de cada criterio) y **le devuelve lo que falla, hasta que todo pasa**.

En pantalla se ve en tiempo real **qué hace cada agente** (estado, actividad, motor y tokens) y **en qué estado está cada tarea** (tablero Pendiente → Desarrollo → Pruebas → Hecha, con intentos y fallos devueltos), además del registro de actividad, la vista previa de la web resultante y el código con los cambios resaltados.

- **App:** https://equipo-agentes-ia-hazel.vercel.app (requiere usuario de prueba)
- **Stack:** Next.js 16 (App Router, TypeScript) · Neon Postgres (plan gratuito) · Vercel (plan Hobby) · SDK oficial de Anthropic (Claude) · Tailwind CSS · Vitest
- **Despliegue continuo:** el repositorio está conectado a Vercel; cada `git push` a `master` se publica automáticamente en producción.
- **Especificación (Spec-Driven Development):** [`docs/SPEC.md`](docs/SPEC.md) recoge los requisitos, las decisiones de diseño y los criterios de aceptación, cada uno enlazado con el test o la comprobación que lo verifica.

## Cómo funciona

```
Navegador ──► POST /api/runs            crea la ejecución (petición + copia de la web)
   │
   └─ bucle ► POST /api/runs/:id/step   UN paso de UN agente, guardado en Neon
   └─ cada 1,2 s ► GET /api/runs/:id    estado de agentes, tareas y eventos → pantalla

step():  Orquestador planifica ─► [por cada tarea]
             Orquestador asigna ─► Develop implementa ─► Testing comprueba
                                        ▲                      │
                                        └──── fallos ◄─────────┘  (máx. 4 intentos)
         ─► Orquestador hace la revisión final y publica los cambios en la web del usuario
```

- **Máquina de estados persistente** (`src/lib/engine.ts`): cada llamada a `step()` ejecuta una sola acción y la guarda en la base de datos. Así ninguna petición HTTP supera el límite de las funciones de Vercel, todo el progreso es visible y, si se cierra el navegador, la ejecución se reanuda donde estaba. Un bloqueo en BD (`lock_until`) impide que dos pestañas avancen la misma ejecución a la vez.
- **Testing tiene dos capas**: comprobaciones automáticas deterministas (`src/lib/agents/checks.ts`: HTML bien formado con *parse5*, enlaces rotos, `alt` en imágenes, `<label>` en formularios, ids duplicados, sintaxis JS con *acorn*, llaves CSS, páginas huérfanas) + evaluación de cada criterio de aceptación por el modelo. Una tarea solo pasa si **no hay errores automáticos y se cumplen todos los criterios**; si no, los fallos concretos vuelven a Develop.
- **Salida estructurada**: cada agente responde JSON validado con Zod (`src/lib/agents/prompts.ts`), usando la salida estructurada de la API de Claude.
- **Vista previa aislada**: la web generada se muestra en un `iframe` con `sandbox` (y CSP `sandbox` si se abre directamente), con CSS/JS/SVG incrustados; su código no puede leer la sesión ni llamar a la API.

### Motor de IA

`src/lib/ai/llm.ts` prueba los proveedores en orden y usa el primero disponible:

| Proveedor | Configuración | Notas |
|---|---|---|
| **Vercel AI Gateway** | Ninguna clave: en Vercel se autentica con el token OIDC del despliegue | Prueba en cascada `anthropic/claude-opus-5.5` → `recursive/flint-v1.0` → `nvidia/nemotron-3.5-lightning-free` (configurable con `AI_GATEWAY_MODELS`). El plan gratuito de la pasarela (requiere tarjeta registrada) **no incluye Claude**, así que en la demo trabajan los modelos abiertos gratuitos; con créditos de pago se usa Claude automáticamente |
| Claude vía **API de Anthropic** | `ANTHROPIC_API_KEY` | De pago |
| **Groq** (plan gratuito) | `GROQ_API_KEY` | Gratis, sin tarjeta |
| **Modo simulado** | — | Agentes deterministas sin IA (siempre disponible) |

Todas las llamadas usan el SDK oficial de Anthropic y la API de Messages (la pasarela la ofrece también para modelos que no son de Anthropic). Cada paso tiene un presupuesto de tiempo: si un modelo tarda demasiado, se prueba el siguiente sin superar el límite de 300 s de las funciones de Vercel. Si la IA no está disponible al empezar, el equipo continúa en **modo simulado** y lo indica en pantalla. En modo simulado, Develop comete a propósito un fallo en el primer intento de algunas tareas para que se vea el ciclo completo Testing → Develop.

## Base de datos (Neon Postgres)

Tablas (`src/lib/schema.sql`): `users`, `sites` (la web de cada usuario), `runs` (cada petición, con estado de los agentes y los ficheros), `tasks` (tareas con criterios, intentos, fallos y resultados de las pruebas) y `events` (registro de todo lo que hace cada agente).

## Seguridad

- **Ninguna clave en el repositorio**: `DATABASE_URL`, `SESSION_SECRET` y las claves de IA viven solo en variables de entorno de Vercel / `.env.local` (ignorado por git). Ver `.env.example`.
- Contraseñas con *scrypt*; sesión en cookie `httpOnly` firmada (JWT HS256).
- Develop solo puede escribir rutas relativas seguras con extensiones permitidas (`.html .css .js .svg .json .txt`), con tamaño y número de ficheros limitados.
- Límite de peticiones por usuario y día (`MAX_RUNS_PER_DAY`) para proteger el crédito de IA.

## Ejecutar en local

```bash
npm install
vercel link && vercel env pull .env.local     # o copia .env.example y rellénalo
DEMO_EMAIL=tu@email DEMO_PASSWORD=una-contraseña npm run db:setup
npm run dev
```

Tests y comprobaciones:

```bash
npm test            # 16 tests: comprobaciones de Testing, ciclo completo de los agentes, SDK de Claude contra un servidor falso
npm run typecheck && npm run lint && npm run build
```

## Cómo se ha usado Claude Code

Todo el proyecto se ha programado con **Claude Code** (app de escritorio, modelo Claude Opus 5.5) en una sola sesión:

1. **Lectura del enunciado y plan**: a partir de una captura del email, Claude Code extrajo los requisitos y mantuvo una lista de tareas visible (revisar herramientas → arquitectura → código → interfaz → BD y despliegue → GitHub → pruebas en producción → informe).
2. **Infraestructura desde la terminal**: instaló Vercel CLI y GitHub CLI, creó el proyecto de Vercel, aprovisionó Neon desde Vercel Marketplace (`vercel integration add neon`), generó `SESSION_SECRET` y lo guardó como variable cifrada de Vercel sin mostrarlo nunca, y creó el repositorio en GitHub. Los inicios de sesión y la aceptación de términos los hizo la persona usuaria en su navegador.
3. **Documentación antes de programar**: como Next.js 16 tiene cambios incompatibles, Claude Code leyó la documentación incluida en `node_modules/next/dist/docs` (Route Handlers, `RouteContext`, `maxDuration`, Cache Components) y la del AI Gateway y del SDK de Anthropic antes de escribir código.
4. **Programación y tests**: escribió el motor, los agentes, la interfaz y 16 tests con Vitest (incluido un servidor local que imita la API de Claude). Los tests encontraron un fallo real (el SDK parseaba el JSON antes de comprobar `max_tokens`), que se corrigió.
5. **Verificación en navegador**: arrancó la app en local y la probó con el navegador integrado de Claude Code (login, ejecución en directo, vista previa, código). Así detectó y corrigió un problema de maquetación y que la vista previa necesitaba incrustar CSS/JS.
6. **Pruebas en producción**: tras desplegar, ejecutó peticiones completas contra la URL pública; una de ellas destapó un fallo (repetir una petición sobre una web que ya tenía la página bloqueaba una tarea), que se corrigió con su test de regresión.

`CLAUDE.md` recoge las instrucciones del proyecto para futuras sesiones de Claude Code.
