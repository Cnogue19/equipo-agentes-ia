/**
 * Modo simulado: los tres agentes funcionan con lógica determinista, sin IA.
 * Sirve para que la aplicación funcione siempre (aunque no haya crédito de IA) y para los tests.
 * Develop comete a propósito un fallo en el primer intento de algunas tareas para que se vea
 * el ciclo completo: Testing lo detecta, se lo devuelve y Develop lo corrige.
 */
import type { CriterionResult, Files } from "../types";
import { pagesLinkingTo, resolveLocal } from "./checks";

export type PlannedTask = { titulo: string; descripcion: string; criterios: string[] };
export type Plan = { resumen: string; tareas: PlannedTask[] };
export type DevOutput = { resumen: string; archivos: { ruta: string; contenido: string }[] };

type Feature = { slug: string; titulo: string; form: boolean; intro: string };

const FEATURES: { re: RegExp; f: Feature }[] = [
  { re: /contact/i, f: { slug: "contacto", titulo: "Contacto", form: true, intro: "Escríbenos y te responderemos en menos de 24 horas." } },
  { re: /precio|tarifa/i, f: { slug: "precios", titulo: "Precios", form: false, intro: "Precios actualizados de nuestros productos." } },
  { re: /galer|foto/i, f: { slug: "galeria", titulo: "Galería", form: false, intro: "Algunas imágenes de nuestro obrador." } },
  { re: /faq|pregunta/i, f: { slug: "preguntas-frecuentes", titulo: "Preguntas frecuentes", form: false, intro: "Respuestas a las dudas más habituales." } },
  { re: /nosotros|quien|quién|historia|sobre/i, f: { slug: "nosotros", titulo: "Sobre nosotros", form: false, intro: "Tres generaciones horneando pan en el barrio." } },
  { re: /horario|ubicaci|mapa|d[oó]nde/i, f: { slug: "donde-estamos", titulo: "Dónde estamos", form: false, intro: "Ven a vernos a la calle Mayor 12." } },
  { re: /blog|noticia/i, f: { slug: "noticias", titulo: "Noticias", form: false, intro: "Novedades de la panadería." } },
  { re: /reserva|encargo|pedido/i, f: { slug: "encargos", titulo: "Encargos", form: true, intro: "Haz tu encargo con 48 horas de antelación." } },
];

const STOP = new Set(["añade", "anade", "crea", "una", "un", "la", "el", "de", "del", "a", "esta", "este", "web", "página", "pagina", "nueva", "nuevo", "con", "para", "en", "y", "sección", "seccion", "mi", "que"]);

export function detectFeature(request: string): Feature {
  for (const { re, f } of FEATURES) if (re.test(request)) return f;
  const words = request
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  const slug = (words.slice(0, 3).join("-") || "novedades").slice(0, 40);
  const titulo = slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  return { slug, titulo, form: false, intro: `Nueva sección: ${titulo}.` };
}

export function simulatedPlan(request: string): Plan {
  const f = detectFeature(request);
  const page = `${f.slug}.html`;
  const tareas: PlannedTask[] = [
    {
      titulo: `Crear la página «${f.titulo}»`,
      descripcion: `Página: ${page}. Crear ${page} con la misma cabecera, menú, pie y hoja de estilos que el resto de la web.${f.form ? " Debe incluir un formulario con nombre, email y mensaje." : ""}`,
      criterios: [
        `Existe el fichero ${page}`,
        `${page} usa styles.css y la misma cabecera y pie que index.html`,
        ...(f.form ? [`${page} tiene un formulario con campos nombre, email y mensaje, cada uno con su <label>`] : []),
      ],
    },
    {
      titulo: `Añadir «${f.titulo}» al menú de navegación`,
      descripcion: `Página: ${page}. Añadir el enlace a ${page} en el menú de TODAS las páginas de la web.`,
      criterios: [`Todas las páginas HTML enlazan a ${page} desde el menú`, `En ${page} el enlace del menú está marcado con aria-current="page"`],
    },
    {
      titulo: f.form ? "Validar el formulario y darle estilo" : `Dar estilo a la sección «${f.titulo}»`,
      descripcion: `Página: ${page}. ${f.form ? "Añadir validación en JavaScript (campos obligatorios y email válido) con mensaje de confirmación, y estilos del formulario." : "Añadir estilos propios de la nueva sección en styles.css, adaptados a móvil."}`,
      criterios: f.form
        ? ["script.js valida el formulario al enviarlo (campos obligatorios y email)", `styles.css tiene estilos para .${f.slug}`]
        : [`styles.css tiene estilos para .${f.slug}`],
    },
  ];
  return { resumen: `He dividido la petición en ${tareas.length} tareas: crear ${page}, enlazarla en el menú y darle estilo/comportamiento.`, tareas };
}

function navLinks(html: string): string {
  const m = html.match(/<nav[^>]*class="menu"[^>]*>([\s\S]*?)<\/nav>/);
  return m ? m[1] : "";
}

function addNavLink(html: string, page: string, titulo: string, current: boolean): string {
  if (new RegExp(`href="${page}"`).test(navLinks(html))) {
    // El enlace ya existe (p. ej. de una petición anterior): en su propia página debe ir marcado.
    if (!current) return html;
    return html.replace(/(<nav[^>]*class="menu"[^>]*>[\s\S]*?<\/nav>)/, (nav) =>
      nav.replace(new RegExp(`<a href="${page}"(?![^>]*aria-current)`), `<a href="${page}" aria-current="page"`),
    );
  }
  return html.replace(/(<nav[^>]*class="menu"[^>]*>[\s\S]*?)(\s*<\/nav>)/, `$1\n      <a href="${page}"${current ? ' aria-current="page"' : ""}>${titulo}</a>$2`);
}

function pageFromTemplate(files: Files, f: Feature, bug: boolean): string {
  const base = files["index.html"] ?? "";
  const header = base.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  const footer = base.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
  const headerNoCurrent = header.replace(/ aria-current="page"/g, "");
  const body = f.form
    ? `    <section class="${f.slug}">
      <h1>${f.titulo}</h1>
      <p>${f.intro}</p>
      <form id="form-${f.slug}" class="formulario" novalidate>
        <label for="nombre">Nombre</label>
        <input id="nombre" name="nombre" type="text" required>
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required>
        ${bug ? "" : '<label for="mensaje">Mensaje</label>\n        '}<textarea id="mensaje" name="mensaje" rows="5" required></textarea>
        <button type="submit" class="boton">Enviar</button>
        <p class="aviso" role="status" aria-live="polite"></p>
      </form>
    </section>`
    : `    <section class="${f.slug}">
      <h1>${f.titulo}</h1>
      <p>${f.intro}</p>
      <img src="espiga.svg" ${bug ? "" : 'alt="Ilustración de una espiga de trigo" '}width="120" height="120">
    </section>`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${f.titulo} · Panadería La Espiga</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  ${headerNoCurrent}
  <main>
${body}
  </main>
  ${footer}
  <script src="script.js"></script>
</body>
</html>
`;
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#fdf6ec" stroke="#d98e32" stroke-width="4"/><path d="M60 100V30" stroke="#7a4b25" stroke-width="4"/><g fill="#d98e32"><ellipse cx="50" cy="45" rx="8" ry="14" transform="rotate(-30 50 45)"/><ellipse cx="70" cy="45" rx="8" ry="14" transform="rotate(30 70 45)"/><ellipse cx="50" cy="65" rx="8" ry="14" transform="rotate(-30 50 65)"/><ellipse cx="70" cy="65" rx="8" ry="14" transform="rotate(30 70 65)"/><ellipse cx="60" cy="28" rx="7" ry="12"/></g></svg>`;

/** Develop simulado. `attempt` empieza en 1. */
export function simulatedDevelop(request: string, taskIdx: number, attempt: number, files: Files): DevOutput {
  const f = detectFeature(request);
  const page = `${f.slug}.html`;
  const bug = attempt === 1; // primer intento con un fallo deliberado (para enseñar el ciclo de pruebas)
  if (taskIdx === 0) {
    const archivos = [{ ruta: page, contenido: pageFromTemplate(files, f, bug) }];
    if (!f.form) archivos.push({ ruta: "espiga.svg", contenido: SVG });
    return {
      resumen: bug ? `He creado ${page} con la estructura común de la web.` : `He corregido ${page} siguiendo el informe de Testing.`,
      archivos,
    };
  }
  if (taskIdx === 1) {
    const archivos: DevOutput["archivos"] = [];
    for (const p of Object.keys(files).filter((x) => x.endsWith(".html"))) {
      if (bug && p === "productos.html") continue; // se le "olvida" una página
      const updated = addNavLink(files[p], page, f.titulo, p === page);
      if (updated !== files[p]) archivos.push({ ruta: p, contenido: updated });
    }
    return { resumen: bug ? "He añadido el enlace al menú." : "He añadido el enlace que faltaba en el menú de productos.html.", archivos };
  }
  // Tarea 3: estilos (+ validación si hay formulario)
  let css = files["styles.css"] ?? "";
  if (!css.includes(`.${f.slug}`)) {
    css += f.form
      ? `\n/* Sección ${f.titulo} */\n.${f.slug} { max-width: 560px; margin: 0 auto; }\n.formulario { display: grid; gap: .6rem; background: #fff; padding: 1.5rem; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.06); }\n.formulario input, .formulario textarea { font: inherit; padding: .6rem; border: 1px solid #d8c8b4; border-radius: 8px; }\n.formulario .aviso { min-height: 1.5em; font-weight: 600; }\n@media (max-width: 600px) { .${f.slug} { padding: 0 .5rem; } }\n`
      : `\n/* Sección ${f.titulo} */\n.${f.slug} { text-align: center; background: #fff; padding: 2rem; border-radius: 12px; }\n.${f.slug} img { margin-top: 1rem; }\n@media (max-width: 600px) { .${f.slug} { padding: 1rem; } }\n`;
  }
  const archivos = [{ ruta: "styles.css", contenido: css }];
  if (f.form) {
    let js = files["script.js"] ?? "";
    if (!js.includes('addEventListener("submit"')) {
      js += `\n// Validación del formulario de ${f.titulo.toLowerCase()}\nvar form = document.getElementById("form-${f.slug}");\nif (form) {\n  form.addEventListener("submit", function (ev) {\n    ev.preventDefault();\n    var aviso = form.querySelector(".aviso");\n    var email = form.querySelector("#email").value.trim();\n    var vacios = Array.prototype.filter.call(form.querySelectorAll("[required]"), function (c) { return !c.value.trim(); });\n    if (vacios.length) { aviso.textContent = "Rellena todos los campos."; return; }\n    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) { aviso.textContent = "El email no es válido."; return; }\n    aviso.textContent = "¡Gracias! Hemos recibido tu mensaje.";\n    form.reset();\n  });\n}\n`;
    }
    archivos.push({ ruta: "script.js", contenido: js });
  }
  return { resumen: f.form ? "He añadido la validación del formulario y sus estilos." : "He añadido los estilos de la nueva sección.", archivos };
}

/** Testing simulado: evalúa los criterios con reglas sobre el código. */
export function simulatedCriteria(description: string, criteria: string[], files: Files): CriterionResult[] {
  const page = description.match(/([a-z0-9-]+\.html)/i)?.[1] ?? "";
  const slug = page.replace(/\.html$/, "");
  const html = files[page] ?? "";
  return criteria.map((criterio) => {
    const c = criterio.toLowerCase();
    if (c.startsWith("existe")) {
      const ok = page in files;
      return { criterio, cumple: ok, motivo: ok ? `${page} existe` : `No se ha creado ${page}` };
    }
    if (c.includes("todas las páginas")) {
      const all = Object.keys(files).filter((p) => p.endsWith(".html"));
      const linking = new Set(pagesLinkingTo(files, page).filter((p) => navLinks(files[p]).includes(`href="${page}"`)));
      const missing = all.filter((p) => !linking.has(p));
      return { criterio, cumple: missing.length === 0, motivo: missing.length ? `Falta el enlace en el menú de: ${missing.join(", ")}` : "Todas las páginas tienen el enlace en el menú" };
    }
    if (c.includes("aria-current")) {
      const ok = new RegExp(`href="${page}"\\s+aria-current="page"`).test(html);
      return { criterio, cumple: ok, motivo: ok ? "El enlace propio está marcado" : `En ${page} el enlace no tiene aria-current="page"` };
    }
    if (c.includes("formulario") && c.includes("label")) {
      const ok = /<form/.test(html) && ["nombre", "email", "mensaje"].every((n) => new RegExp(`<label for="${n}"`).test(html));
      return { criterio, cumple: ok, motivo: ok ? "Formulario con los tres campos etiquetados" : "Falta algún campo o alguna <label> en el formulario" };
    }
    if (c.includes("usa styles.css")) {
      const ok = /href="styles\.css"/.test(html) && /<header/.test(html) && /<footer/.test(html);
      return { criterio, cumple: ok, motivo: ok ? "Comparte hoja de estilos, cabecera y pie" : "No usa la estructura común" };
    }
    if (c.includes("valida")) {
      const ok = (files["script.js"] ?? "").includes('addEventListener("submit"');
      return { criterio, cumple: ok, motivo: ok ? "script.js gestiona el envío y valida los campos" : "No hay validación del formulario" };
    }
    if (c.includes("styles.css tiene estilos")) {
      const ok = (files["styles.css"] ?? "").includes(`.${slug}`);
      return { criterio, cumple: ok, motivo: ok ? `Hay reglas para .${slug}` : `No hay reglas para .${slug}` };
    }
    // Criterio desconocido: se comprueba al menos que los enlaces de la página resuelvan.
    const ok = page ? page in files && resolveLocal(page, "styles.css") !== null : true;
    return { criterio, cumple: ok, motivo: ok ? "Revisado" : "No se pudo comprobar" };
  });
}
