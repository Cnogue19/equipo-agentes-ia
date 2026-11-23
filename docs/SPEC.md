# Especificación · Equipo de agentes IA

> Metodología: **Spec-Driven Development (SDD)**. Primero se fija *qué* hay que construir y *cómo se comprueba* (requisitos y criterios de aceptación verificables); después se implementa y se verifica contra esta especificación. Cada criterio enlaza con el test o la comprobación que lo demuestra.
>
> Nota de transparencia: la especificación se siguió durante el desarrollo (requisitos del enunciado → criterios → código → tests), pero este documento se redactó de forma explícita al final para dejarla por escrito en el repositorio.

## 1. Objetivo

Construir un pequeño equipo de **3 agentes de IA** que reciba una petición sobre una web (p. ej. «Añade una página de contacto a esta web»), la divida en tareas, la implemente y la verifique hasta que todo pase, mostrando en pantalla qué hace cada agente y en qué estado está cada tarea.

## 2. Requisitos del enunciado

| ID | Requisito | Origen |
|---|---|---|
| R1 | **Orquestador**: recibe una petición, la divide en tareas y se las reparte a los otros dos agentes | Enunciado |
| R2 | **Develop**: hace las tareas de desarrollo | Enunciado |
| R3 | **Testing**: comprueba lo que ha hecho Develop y devuelve lo que falla, hasta que todo pasa | Enunciado |
| R4 | Hecho en **Next.js** | Enunciado |
| R5 | Programado con **Claude Code** o Codex, explicando cómo se usó | Enunciado |
| R6 | **Base de datos gratuita** (Supabase, Neon, Turso, Firebase…) | Enunciado |
| R7 | **Publicado en Vercel** con una dirección accesible | Enunciado |
| R8 | En pantalla se ve **qué hace cada agente** y **en qué estado está cada tarea** | Enunciado |
| R9 | Sin gastar dinero: **planes gratuitos** | Enunciado |
| R10 | **No subir claves de API** al repositorio | Enunciado |
| R11 | Entregar dirección de la app, repositorio de GitHub y **usuario de prueba** | Enunciado |

## 3. Requisitos derivados (decisiones de diseño)

| ID | Requisito derivado | Motivo |
|---|---|---|
| D1 | Los agentes trabajan sobre una **web estática de ejemplo** (HTML/CSS/JS) guardada en la base de datos | Se puede previsualizar al instante sin compilar ni desplegar nada |
| D2 | El trabajo avanza en **pasos persistentes**: cada paso ejecuta una acción de un agente y se guarda en BD | Ninguna petición supera el límite de las funciones de Vercel; el progreso es visible y se reanuda si se cierra el navegador |
| D3 | Solo un proceso puede avanzar una ejecución a la vez (**bloqueo en BD**) | Varias pestañas no deben duplicar trabajo |
| D4 | Cada agente responde **JSON con un esquema fijo** (Zod / salida estructurada) | Respuestas fiables y procesables por código |
| D5 | Testing combina **comprobaciones deterministas** + revisión de **criterios de aceptación** | Lo automático no se puede «convencer»; los criterios cubren lo funcional |
| D6 | Máximo **4 intentos** por tarea | «Hasta que todo pasa» sin bucles infinitos ni gasto descontrolado |
| D7 | Motor de IA con **proveedores y modelos en cascada** (Claude → modelos gratuitos de la pasarela) y **modo simulado** de respaldo, con presupuesto de tiempo por paso | La app debe funcionar siempre, sin coste, y sin superar el límite de 300 s de Vercel |
| D8 | **Login** con usuario de prueba y límite de peticiones por día | Proteger el crédito de IA de una URL pública (y R11) |
| D9 | La web generada se muestra **aislada** (sandbox) | El código que escribe la IA no puede acceder a la sesión ni a la API |
| D10 | Develop solo puede escribir **rutas seguras** con extensiones web y tamaño limitado | Evitar que la IA escriba ficheros peligrosos |

## 4. Modelo de dominio

- **Ejecución (`runs`)**: una petición del usuario. Estados: `pendiente → planificando → en_curso → completada | fallida`. Guarda la copia de trabajo de la web, la original y el estado de cada agente.
- **Tarea (`tasks`)**: unidad de trabajo creada por el Orquestador, con título, descripción y **criterios de aceptación**. Estados: `pendiente → en_desarrollo → en_pruebas → hecha`, con `corrigiendo` (Testing devolvió fallos) y `bloqueada` (agotó intentos).
- **Agente**: estado `inactivo | pensando | trabajando | esperando | terminado | error`, actividad actual, motor usado, llamadas y tokens.
- **Evento (`events`)**: registro cronológico de todo lo que hace cada agente (planes, asignaciones, entregas, comprobaciones, fallos, aprobaciones).
- **Web (`sites`)**: la web de cada usuario; se actualiza solo cuando una ejecución termina con todas las tareas verificadas.

## 5. Flujo

```
Orquestador planifica (1–4 tareas con criterios)
  └─ por cada tarea:
       Orquestador asigna → Develop implementa → Testing comprueba
                                 ▲                     │ falla (y quedan intentos)
                                 └──── lista de fallos ◄┘
       Testing aprueba → siguiente tarea
Orquestador: revisión final → publica los cambios en la web del usuario
```

## 6. Criterios de aceptación y cómo se verifican

| ID | Criterio de aceptación | Verificación |
|---|---|---|
| CA1 (R1) | Ante una petición, el Orquestador crea entre 1 y 4 tareas, cada una con criterios de aceptación, y las asigna a Develop en orden | `tests/engine.test.ts` → «Añade una página de contacto: planifica, desarrolla, detecta fallos, corrige y termina»; eventos `plan` y `asignacion` |
| CA2 (R2) | Develop crea o modifica ficheros de la web y la ejecución guarda qué ficheros cambiaron | Mismo test (la web final contiene `contacto.html` con formulario y el enlace en todas las páginas); pestaña «Código y cambios» |
| CA3 (R3) | Si Testing detecta un fallo, la tarea pasa a `corrigiendo`, Develop recibe la lista de fallos y vuelve a entregar; la tarea solo pasa a `hecha` cuando no hay errores automáticos y se cumplen todos los criterios | `engine.test.ts` → mismo test (tareas 1 y 2 necesitan 2 intentos) y «usa las respuestas del modelo y repite Develop→Testing hasta que pasa» |
| CA4 (R3, D6) | Una tarea que sigue fallando tras 4 intentos queda `bloqueada` y la ejecución termina como `fallida` con el motivo | Lógica en `src/lib/engine.ts` (`MAX_ATTEMPTS`); visible en el tablero y en el registro |
| CA5 (D5) | Testing detecta: HTML mal formado, enlaces rotos, imágenes sin `alt`, campos sin `<label>`, ids duplicados, JS con errores de sintaxis, CSS sin cerrar | `tests/checks.test.ts` (5 tests) |
| CA6 (R8) | La pantalla muestra, en tiempo real, el estado y la actividad de cada agente y el estado de cada tarea (con intentos y fallos devueltos) | Componentes `AgentCards`, `TaskBoard` y `ActivityLog`; refresco cada 1,2 s; verificado en navegador |
| CA7 (R8) | Se puede ver la web resultante y el código cambiado | Componentes `Preview` (iframe aislado y navegable) y `CodeView` (diff); verificado en navegador |
| CA8 (D7) | Si la IA no está disponible al planificar, la ejecución continúa en modo simulado y lo indica | `engine.test.ts` → «si la IA no está disponible al planificar, continúa en modo simulado» |
| CA9 (D4, D7) | La llamada al modelo usa el SDK oficial de Anthropic con salida estructurada e informa del progreso (fase de razonamiento y de escritura); si el intermediario rechaza parámetros avanzados reintenta en modo básico; un error de crédito o permiso marca el proveedor como no disponible; una respuesta cortada se detecta | `tests/llm.test.ts` (5 tests contra un servidor que imita la API de Claude) |
| CA10 (D10) | Develop no puede escribir rutas como `../../etc/passwd` ni extensiones no permitidas | `engine.test.ts` → «descarta rutas peligrosas que proponga Develop» + `checks.test.ts` (`isSafePath`) |
| CA11 | Repetir una petición sobre una web que ya la incluye también termina bien | `engine.test.ts` → «repetir la misma petición…» (test de regresión de un fallo encontrado en producción) |
| CA12 | El modo simulado genera contenido real (5 preguntas frecuentes, tabla de precios) que pasa las comprobaciones | `engine.test.ts` → «genera contenido real…» |
| CA13 (R6) | Todo el estado (usuarios, webs, ejecuciones, tareas, eventos) se guarda en Neon Postgres | `src/lib/schema.sql`, `src/lib/repo.ts`; probado en producción |
| CA14 (R7) | La app está publicada en Vercel y cada `git push` a `master` se despliega solo | https://equipo-agentes-ia-hazel.vercel.app; despliegue automático comprobado |
| CA15 (D8, R11) | Sin sesión, la API y la app devuelven 401 o redirigen al login; con el usuario de prueba se accede | Probado en producción (`/api/runs` → 401 sin sesión) |
| CA16 (D9) | La vista previa no puede acceder a la sesión ni a la API: iframe con `sandbox` y CSP `sandbox`; enlace firmado y con caducidad | `src/app/preview/...`, `src/lib/preview-token.ts`; enlace no válido → 401 |
| CA17 (R10) | El repositorio no contiene claves, contraseñas ni cadenas de conexión | Secretos solo en variables de entorno de Vercel / `.env.local` (ignorado); revisión del repositorio antes de publicarlo |
| CA18 (R8) | Una petición en curso se puede cancelar: los agentes se detienen, la web publicada no cambia y un paso que siguiera en marcha no puede reactivarla | `engine.test.ts` → «cancelar una petición…»; botón «Cancelar» en la interfaz; `POST /api/runs/:id/cancel` |
| CA19 (R8) | Mientras la IA razona o escribe, la tarjeta del agente muestra la fase y el tiempo transcurrido | `llm.test.ts` → «informa de la fase de razonamiento…»; actividad «Razonando con <modelo>… N s» |
| CA20 (R3, D7) | Un fallo puntual de la IA a mitad de una petición (respuesta cortada, JSON no válido) no la detiene: el agente reintenta el mismo paso hasta 3 veces seguidas sin gastar intentos de la tarea; si sigue fallando, la petición termina con el motivo | `engine.test.ts` → «fallos puntuales de la IA…» (2 tests); fallo detectado en una prueba real en producción |
| CA21 (R2) | Develop modifica ficheros existentes con ediciones «buscar → reemplazar»; una edición cuyo fragmento no existe vuelve a Develop sin pasar por Testing | `engine.test.ts` → «ediciones puntuales de Develop…» (2 tests) |
| CA22 (D2, D7) | Ninguna llamada a la IA supera su tiempo asignado aunque el modelo ya esté escribiendo: el stream se corta y se prueba otro modelo o se reintenta | `llm.test.ts` → «corta el stream si el modelo no termina a tiempo…» |
| CA23 (D2, D3) | Una petición sin actividad durante más de 20 minutos (y sin ningún paso en marcha) se marca como detenida, no bloquea nuevas peticiones y la web publicada no cambia | `src/lib/repo.ts` → `expireStaleRuns`; consulta validada contra la base de datos |
| CA24 (R8) | El panel muestra la duración de cada petición y el título de la pestaña refleja su progreso | `Dashboard` (verificado en navegador) |

## 7. Fuera de alcance

- Envío real de formularios o emails desde la web generada (es estática).
- Registro público de usuarios (solo usuarios de prueba).
- Edición manual del código desde la interfaz.

## 8. Comprobación de que se cumple la especificación

```bash
npm test             # 23 tests (CA1–CA5, CA8–CA12, CA18–CA22)
npm run typecheck && npm run lint && npm run build
```

Los criterios de interfaz y despliegue (CA6, CA7, CA13–CA16) se verificaron manualmente en el navegador y contra la URL de producción.
