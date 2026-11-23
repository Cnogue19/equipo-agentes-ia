import { NextResponse } from "next/server";
import { getOrCreateSite, getRunFiles } from "@/lib/repo";
import { readPreviewToken } from "@/lib/preview-token";
import { inlinePage } from "@/lib/preview-inline";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
};

// "sandbox" ejecuta la web generada en un origen aislado: su JavaScript no puede leer
// las cookies ni llamar a la API de la app aunque alguien abra la URL directamente.
const CSP = "sandbox allow-scripts allow-forms allow-modals; connect-src 'none'";

/**
 * Sirve la web generada por los agentes para verla en un iframe.
 * El primer segmento es un token firmado que identifica la web del usuario o una ejecución.
 */
export async function GET(req: Request, ctx: RouteContext<"/preview/[id]/[[...path]]">) {
  const { id, path } = await ctx.params;
  const target = readPreviewToken(id);
  if (!target) return new NextResponse("Enlace de vista previa no válido o caducado", { status: 401 });
  const file = (path ?? []).map(decodeURIComponent).join("/") || "index.html";

  const files =
    target.kind === "web"
      ? (await getOrCreateSite(target.userId)).files
      : ((await getRunFiles(target.id, target.userId))?.files ?? null);
  if (!files) return new NextResponse("No encontrado", { status: 404 });

  const content = files[file];
  if (content === undefined) {
    const safe = file.replace(/[<>&"']/g, "");
    return new NextResponse(
      `<!DOCTYPE html><html lang="es"><meta charset="utf-8"><title>No existe</title><p style="font-family:sans-serif;padding:2rem">No existe <b>${safe}</b> en esta web.</p></html>`,
      { status: 404, headers: { "content-type": TYPES.html, "content-security-policy": CSP } },
    );
  }
  const ext = file.split(".").pop()?.toLowerCase() ?? "txt";
  // Las páginas HTML se sirven con CSS/JS/SVG incrustados (no dependen de más peticiones).
  const body = ext === "html" ? inlinePage(files, file, new URL(req.url).searchParams.has("embed")) : content;
  return new NextResponse(body, {
    headers: {
      "content-type": TYPES[ext] ?? "text/plain; charset=utf-8",
      "content-security-policy": CSP,
      "cache-control": "no-store",
    },
  });
}
