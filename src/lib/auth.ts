import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { sql } from "./db";
import { verifyPassword } from "./password";

const COOKIE = "sesion";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 días

export type User = { id: number; email: string; name: string };

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("Falta SESSION_SECRET (mínimo 32 caracteres).");
  return new TextEncoder().encode(s);
}

export async function login(email: string, password: string): Promise<User | null> {
  const rows = await sql()`SELECT id, email, name, password_hash FROM users WHERE email = ${email.trim().toLowerCase()}`;
  const row = rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash as string))) return null;
  const user: User = { id: Number(row.id), email: row.email as string, name: row.name as string };
  const token = await new SignJWT({ name: user.name, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return user;
}

export async function logout() {
  (await cookies()).delete(COOKIE);
}

/** Usuario de la sesión actual o null. */
export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return { id: Number(payload.sub), email: String(payload.email), name: String(payload.name) };
  } catch {
    return null;
  }
}
