/**
 * Comprobaciones automáticas (deterministas) que ejecuta el agente Testing
 * sobre los ficheros de la web antes de revisar los criterios de aceptación.
 * No usan IA: son las mismas siempre y no se pueden "convencer".
 */
import { parse } from "parse5";
import * as acorn from "acorn";
import type { CheckResult, Files } from "../types";

type El = {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: El[];
  value?: string;
  content?: El;
};

const SEVERE_PARSE_ERRORS = new Set([
  "missing-doctype",
  "end-tag-without-matching-open-element",
  "closing-of-element-with-open-child-elements",
  "eof-in-element-that-can-contain-only-text",
  "duplicate-attribute",
  "eof-in-tag",
  "unexpected-solidus-in-tag",
]);

const ALLOWED_EXT = /\.(html|css|js|svg|json|txt|ico|webmanifest)$/i;

export function isSafePath(p: string): boolean {
  return (
    p.length > 0 &&
    p.length <= 80 &&
    !p.startsWith("/") &&
    !p.includes("..") &&
    !p.includes("\\") &&
    /^[a-zA-Z0-9._\-/]+$/.test(p) &&
    ALLOWED_EXT.test(p)
  );
}

function walk(node: El, fn: (el: El) => void) {
  fn(node);
  node.childNodes?.forEach((c) => walk(c, fn));
  if (node.content) walk(node.content, fn);
}

const attr = (el: El, name: string) => el.attrs?.find((a) => a.name === name)?.value;

function textOf(el: El): string {
  let t = "";
  walk(el, (n) => {
    if (n.nodeName === "#text") t += n.value ?? "";
  });
  return t.trim();
}

/** Resuelve un enlace relativo respecto a la página que lo contiene. */
export function resolveLocal(from: string, href: string): string | null {
  const h = href.trim();
  if (!h || /^(https?:|mailto:|tel:|data:|javascript:|#|\/\/)/i.test(h)) return null;
  const clean = h.split("#")[0].split("?")[0];
  if (!clean) return null;
  const base = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
  const parts = (clean.startsWith("/") ? clean.slice(1) : base + clean).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

function checkJs(code: string): string | null {
  for (const sourceType of ["script", "module"] as const) {
    try {
      acorn.parse(code, { ecmaVersion: "latest", sourceType });
      return null;
    } catch (e) {
      if (sourceType === "module") return (e as Error).message;
    }
  }
  return null;
}

function checkCssBraces(css: string): string | null {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
  let depth = 0;
  for (const ch of noComments) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth < 0) return "hay una llave '}' de más";
  }
  return depth === 0 ? null : "hay llaves '{' sin cerrar";
}

/** Ejecuta todas las comprobaciones automáticas sobre la web. */
export function runAutomaticChecks(files: Files): CheckResult[] {
  const results: CheckResult[] = [];
  const add = (id: string, nombre: string, estado: CheckResult["estado"], detalle: string) =>
    results.push({ id, nombre, estado, detalle });

  const paths = Object.keys(files);
  const bad = paths.filter((p) => !isSafePath(p));
  add("rutas", "Rutas de fichero válidas", bad.length ? "error" : "ok", bad.length ? `Rutas no permitidas: ${bad.join(", ")}` : `${paths.length} ficheros`);

  const empty = paths.filter((p) => !files[p]?.trim());
  if (empty.length) add("vacios", "Ficheros no vacíos", "error", `Ficheros vacíos: ${empty.join(", ")}`);

  const htmlPages = paths.filter((p) => p.endsWith(".html"));
  if (!htmlPages.includes("index.html")) add("index", "Existe index.html", "error", "La web no tiene página de inicio");

  const linkedFrom = new Map<string, Set<string>>();

  for (const page of htmlPages) {
    const html = files[page] ?? "";
    const parseErrors: string[] = [];
    const doc = parse(html, {
      onParseError: (e) => {
        if (SEVERE_PARSE_ERRORS.has(e.code)) parseErrors.push(`${e.code} (línea ${e.startLine})`);
      },
    }) as unknown as El;

    add(`html:${page}`, `HTML bien formado · ${page}`, parseErrors.length ? "error" : "ok", parseErrors.length ? parseErrors.slice(0, 5).join("; ") : "Sin errores de estructura");

    const problems: string[] = [];
    const warnings: string[] = [];
    const ids = new Map<string, number>();
    const labelsFor = new Set<string>();
    const controls: { el: El; insideLabel: boolean }[] = [];
    let title = "";
    let lang = "";
    let viewport = false;

    const visit = (node: El, insideLabel: boolean) => {
      const tag = node.tagName;
      if (tag) {
        const id = attr(node, "id");
        if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
        if (tag === "html") lang = attr(node, "lang") ?? "";
        if (tag === "title") title = textOf(node);
        if (tag === "meta" && attr(node, "name") === "viewport") viewport = true;
        if (tag === "label" && attr(node, "for")) labelsFor.add(attr(node, "for")!);
        if (tag === "img" && attr(node, "alt") === undefined) problems.push(`<img src="${attr(node, "src") ?? "?"}"> sin atributo alt`);
        if (["input", "select", "textarea"].includes(tag)) {
          const type = (attr(node, "type") ?? "text").toLowerCase();
          if (!["hidden", "submit", "button", "reset", "image"].includes(type)) controls.push({ el: node, insideLabel });
        }
        for (const a of ["href", "src"]) {
          const v = attr(node, a);
          if (v === undefined || tag === "base") continue;
          const target = resolveLocal(page, v);
          if (target === null) continue;
          if (!(target in files)) problems.push(`Enlace roto: ${a}="${v}" (no existe ${target})`);
          else {
            if (!linkedFrom.has(target)) linkedFrom.set(target, new Set());
            linkedFrom.get(target)!.add(page);
          }
        }
        if (tag === "script" && !attr(node, "src")) {
          const type = attr(node, "type");
          if (!type || type === "module" || type === "text/javascript") {
            const err = checkJs(textOf(node));
            if (err) problems.push(`Error de sintaxis en <script> en línea: ${err}`);
          }
        }
      }
      node.childNodes?.forEach((c) => visit(c, insideLabel || tag === "label"));
      if (node.content) visit(node.content, insideLabel);
    };
    visit(doc, false);

    if (!lang) problems.push('Falta el atributo lang en <html>');
    if (!title) problems.push("Falta un <title> con texto");
    if (!viewport) warnings.push("Falta <meta name=\"viewport\"> (móvil)");
    for (const [id, n] of ids) if (n > 1) problems.push(`id duplicado: "${id}" aparece ${n} veces`);
    for (const { el, insideLabel } of controls) {
      const id = attr(el, "id");
      const ok = insideLabel || (id && labelsFor.has(id)) || attr(el, "aria-label") || attr(el, "aria-labelledby");
      if (!ok) problems.push(`Campo de formulario sin etiqueta <label>: <${el.tagName} name="${attr(el, "name") ?? "?"}">`);
      if (!attr(el, "name")) warnings.push(`Campo <${el.tagName}${id ? ` id="${id}"` : ""}> sin atributo name`);
    }

    add(`a11y:${page}`, `Enlaces, accesibilidad y formularios · ${page}`, problems.length ? "error" : warnings.length ? "aviso" : "ok", [...problems, ...warnings].join("; ") || "Todo correcto");
  }

  for (const page of htmlPages) {
    if (page === "index.html") continue;
    const from = [...(linkedFrom.get(page) ?? [])].filter((p) => p !== page);
    if (!from.length) add(`huerfana:${page}`, `Página enlazada · ${page}`, "aviso", "Ninguna otra página enlaza a esta página");
  }

  for (const p of paths.filter((x) => x.endsWith(".js"))) {
    const err = checkJs(files[p] ?? "");
    add(`js:${p}`, `JavaScript válido · ${p}`, err ? "error" : "ok", err ?? "Sintaxis correcta");
  }
  for (const p of paths.filter((x) => x.endsWith(".css"))) {
    const err = checkCssBraces(files[p] ?? "");
    add(`css:${p}`, `CSS válido · ${p}`, err ? "error" : "ok", err ?? "Llaves equilibradas");
  }

  return results;
}

export const hasErrors = (checks: CheckResult[]) => checks.some((c) => c.estado === "error");

/** Lista de páginas HTML que contienen un enlace a `target`. */
export function pagesLinkingTo(files: Files, target: string): string[] {
  const out: string[] = [];
  for (const page of Object.keys(files).filter((p) => p.endsWith(".html"))) {
    const re = /href\s*=\s*["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(files[page]))) {
      if (resolveLocal(page, m[1]) === target) {
        out.push(page);
        break;
      }
    }
  }
  return out;
}
