import type { Files } from "./types";

/**
 * Web de ejemplo sobre la que trabajan los agentes: una panadería con dos páginas.
 * Es HTML/CSS/JS estático para poder previsualizarla al instante sin compilar nada.
 */
export const SITE_NAME = "Panadería La Espiga";

const nav = (active: "inicio" | "productos") => `    <nav class="menu" aria-label="Principal">
      <a href="index.html"${active === "inicio" ? ' aria-current="page"' : ""}>Inicio</a>
      <a href="productos.html"${active === "productos" ? ' aria-current="page"' : ""}>Productos</a>
    </nav>`;

export function templateFiles(): Files {
  return {
    "index.html": `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Panadería La Espiga · Pan artesano</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="cabecera">
    <a class="logo" href="index.html">🌾 La Espiga</a>
${nav("inicio")}
  </header>
  <main>
    <section class="hero">
      <h1>Pan artesano recién hecho cada mañana</h1>
      <p>Masa madre, harinas ecológicas y 30 años horneando en el barrio.</p>
      <a class="boton" href="productos.html">Ver productos</a>
    </section>
    <section class="destacados">
      <article class="tarjeta">
        <h2>Masa madre</h2>
        <p>Fermentación lenta de 24 horas para un pan más sabroso y digestivo.</p>
      </article>
      <article class="tarjeta">
        <h2>Bollería</h2>
        <p>Croissants de mantequilla y napolitanas recién salidas del horno.</p>
      </article>
      <article class="tarjeta">
        <h2>Encargos</h2>
        <p>Tartas y roscones por encargo para tus celebraciones.</p>
      </article>
    </section>
  </main>
  <footer class="pie">
    <p>C/ Mayor 12 · Abierto de lunes a sábado de 7:30 a 14:30</p>
    <p>&copy; <span id="anio"></span> Panadería La Espiga</p>
  </footer>
  <script src="script.js"></script>
</body>
</html>
`,
    "productos.html": `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Productos · Panadería La Espiga</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="cabecera">
    <a class="logo" href="index.html">🌾 La Espiga</a>
${nav("productos")}
  </header>
  <main>
    <h1>Nuestros productos</h1>
    <ul class="lista-productos">
      <li><strong>Hogaza de masa madre</strong> <span>4,50 €</span></li>
      <li><strong>Barra rústica</strong> <span>1,20 €</span></li>
      <li><strong>Croissant de mantequilla</strong> <span>1,40 €</span></li>
      <li><strong>Tarta de queso (encargo)</strong> <span>22,00 €</span></li>
    </ul>
  </main>
  <footer class="pie">
    <p>C/ Mayor 12 · Abierto de lunes a sábado de 7:30 a 14:30</p>
    <p>&copy; <span id="anio"></span> Panadería La Espiga</p>
  </footer>
  <script src="script.js"></script>
</body>
</html>
`,
    "styles.css": `:root {
  --marron: #7a4b25;
  --crema: #fdf6ec;
  --texto: #2b2118;
  --acento: #d98e32;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: var(--texto); background: var(--crema); line-height: 1.6; }
.cabecera { display: flex; justify-content: space-between; align-items: center; padding: 1rem 2rem; background: var(--marron); color: #fff; flex-wrap: wrap; gap: .5rem; }
.logo { color: #fff; font-weight: 700; font-size: 1.3rem; text-decoration: none; }
.menu { display: flex; gap: 1.2rem; }
.menu a { color: #fff; text-decoration: none; }
.menu a[aria-current="page"] { border-bottom: 2px solid var(--acento); }
main { max-width: 960px; margin: 0 auto; padding: 2rem; }
.hero { text-align: center; padding: 3rem 1rem; }
.hero h1 { font-size: 2.2rem; margin-bottom: .5rem; }
.boton { display: inline-block; background: var(--acento); color: #fff; padding: .7rem 1.4rem; border-radius: 999px; text-decoration: none; font-weight: 600; }
.destacados { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
.tarjeta { background: #fff; padding: 1.2rem; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
.lista-productos { list-style: none; padding: 0; }
.lista-productos li { display: flex; justify-content: space-between; background: #fff; margin-bottom: .5rem; padding: .8rem 1rem; border-radius: 8px; }
.pie { text-align: center; padding: 2rem; color: #6b5a4a; font-size: .9rem; }
`,
    "script.js": `// Año actual en el pie de página
document.querySelectorAll("#anio").forEach(function (el) {
  el.textContent = String(new Date().getFullYear());
});
`,
  };
}
