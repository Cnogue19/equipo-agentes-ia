import { login } from "@/lib/auth";
import { error, json } from "@/lib/http";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return error("Introduce email y contraseña");
  const user = await login(email, password);
  if (!user) {
    await new Promise((r) => setTimeout(r, 400)); // freno simple a la fuerza bruta
    return error("Email o contraseña incorrectos", 401);
  }
  return json({ user });
}
