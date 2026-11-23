import "server-only";
import { NextResponse } from "next/server";
import { getUser, type User } from "./auth";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });

export const error = (message: string, status = 400) => json({ error: message }, status);

/** Devuelve el usuario o una respuesta 401. */
export async function requireUser(): Promise<User | NextResponse> {
  const user = await getUser();
  return user ?? error("No has iniciado sesión", 401);
}

export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
