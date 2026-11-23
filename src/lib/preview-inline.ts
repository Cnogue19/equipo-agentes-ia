import type { Files } from "./types";
import { resolveLocal } from "./agents/checks";

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];

/** Script que avisa a la app cuando se pulsa un enlace interno dentro de la vista previa. */
const NAV_SCRIPT = `<script>document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var h=a.getAttribute("href")||"";if(/^(https?:|mailto:|tel:|#|javascript:|data:)/i.test(h))return;e.preventDefault();parent.postMessage({tipo:"navegar-preview",pagina:h.split("#")[0].split("?")[0]},"*");});</script>`;

/**
 * Devuelve el HTML de una página con sus CSS, JS e imágenes locales incrustados,
 * para poder mostrarla en un iframe aislado sin hacer más peticiones.
 */
export function inlinePage(files: Files, page: string, embed: boolean): string {
  let html = files[page] ?? "";
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = attr(tag, "rel")?.toLowerCase();
    const href = attr(tag, "href");
    const target = href ? resolveLocal(page, href) : null;
    if (rel === "stylesheet" && target && files[target] !== undefined) return `<style>/* ${target} */\n${files[target].replace(/<\/style/gi, "<\\/style")}</style>`;
    return tag;
  });
  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a: string, src: string, b: string) => {
    const target = resolveLocal(page, src);
    if (!target || files[target] === undefined) return tag;
    return `<script${a}${b}>/* ${target} */\n${files[target].replace(/<\/script/gi, "<\\/script")}</script>`;
  });
  html = html.replace(/(<(?:img|source|image)\b[^>]*?\b(?:src|href)\s*=\s*["'])([^"']+)(["'])/gi, (m, pre: string, src: string, post: string) => {
    const target = resolveLocal(page, src);
    if (!target || files[target] === undefined || !target.endsWith(".svg")) return m;
    return `${pre}data:image/svg+xml;charset=utf-8,${encodeURIComponent(files[target])}${post}`;
  });
  if (embed) html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${NAV_SCRIPT}</body>`) : html + NAV_SCRIPT;
  return html;
}
