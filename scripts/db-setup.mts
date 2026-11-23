/**
 * Crea las tablas y el usuario de prueba.
 * Uso:  DEMO_EMAIL=... DEMO_PASSWORD=... npm run db:setup
 * (lee DATABASE_URL de .env.local; las credenciales nunca se guardan en el repositorio)
 */
import { readFileSync, existsSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { hashPassword } from "../src/lib/password.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");
const sql = neon(url);

const schema = readFileSync(new URL("../src/lib/schema.sql", import.meta.url), "utf8");
const statements = schema
  .split(/;\s*$/m)
  .map((s) => s.replace(/--.*$/gm, "").trim())
  .filter(Boolean);
for (const st of statements) await sql.query(st);
console.log(`Esquema aplicado (${statements.length} sentencias).`);

const email = process.env.DEMO_EMAIL?.trim().toLowerCase();
const password = process.env.DEMO_PASSWORD;
if (email && password) {
  const hash = await hashPassword(password);
  await sql`INSERT INTO users (email, name, password_hash) VALUES (${email}, ${process.env.DEMO_NAME ?? "Evaluador"}, ${hash})
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name`;
  console.log(`Usuario de prueba listo: ${email}`);
} else {
  console.log("(Sin DEMO_EMAIL/DEMO_PASSWORD: no se crea usuario de prueba)");
}
