import { describe, expect, it } from "vitest";
import { isSafePath, resolveLocal, runAutomaticChecks, hasErrors } from "../src/lib/agents/checks";
import { templateFiles } from "../src/lib/site-template";

describe("comprobaciones automáticas de Testing", () => {
  it("la web de ejemplo pasa sin errores", () => {
    const checks = runAutomaticChecks(templateFiles());
    expect(hasErrors(checks)).toBe(false);
  });

  it("detecta enlaces rotos, imágenes sin alt y campos sin label", () => {
    const files = templateFiles();
    files["contacto.html"] = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>C</title></head>
      <body><a href="noexiste.html">x</a><img src="a.svg"><form><input name="email" id="email"></form></body></html>`;
    files["a.svg"] = "<svg xmlns='http://www.w3.org/2000/svg'></svg>";
    const checks = runAutomaticChecks(files);
    const detail = checks.find((c) => c.id === "a11y:contacto.html")!;
    expect(detail.estado).toBe("error");
    expect(detail.detalle).toContain("Enlace roto");
    expect(detail.detalle).toContain("sin atributo alt");
    expect(detail.detalle).toContain("sin etiqueta <label>");
  });

  it("detecta JavaScript con errores de sintaxis y CSS desequilibrado", () => {
    const files = templateFiles();
    files["script.js"] = "function ( {";
    files["styles.css"] = "body { color: red;";
    const checks = runAutomaticChecks(files);
    expect(checks.find((c) => c.id === "js:script.js")!.estado).toBe("error");
    expect(checks.find((c) => c.id === "css:styles.css")!.estado).toBe("error");
  });

  it("detecta HTML sin doctype e ids duplicados", () => {
    const files = templateFiles();
    files["index.html"] = `<html lang="es"><head><title>x</title></head><body><p id="a"></p><p id="a"></p></body></html>`;
    const checks = runAutomaticChecks(files);
    expect(checks.find((c) => c.id === "html:index.html")!.estado).toBe("error");
    expect(checks.find((c) => c.id === "a11y:index.html")!.detalle).toContain("id duplicado");
  });

  it("valida rutas seguras y resuelve enlaces relativos", () => {
    expect(isSafePath("contacto.html")).toBe(true);
    expect(isSafePath("../secreto.html")).toBe(false);
    expect(isSafePath("/etc/passwd")).toBe(false);
    expect(isSafePath("script.php")).toBe(false);
    expect(resolveLocal("blog/a.html", "../styles.css?v=1")).toBe("styles.css");
    expect(resolveLocal("index.html", "https://example.com")).toBeNull();
    expect(resolveLocal("index.html", "#arriba")).toBeNull();
  });
});
