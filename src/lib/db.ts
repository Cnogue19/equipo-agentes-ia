import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | null = null;

/** Cliente SQL de Neon (HTTP). Se crea una vez por instancia de función. */
export function sql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL (base de datos Neon).");
    client = neon(url);
  }
  return client;
}
