import type { NextApiRequest, NextApiResponse } from "next";
import { signSession, createSessionCookie } from "../../lib/auth";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { login, password } = req.body || {};
  const adminLogin = process.env.ADMIN_LOGIN;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminLogin || !adminPassword) return res.status(500).json({ error: "Admin credentials not configured (ADMIN_LOGIN/ADMIN_PASSWORD)" });
  if (login !== adminLogin || password !== adminPassword) return res.status(401).json({ error: "Invalid credentials" });
  try {
    const token = signSession({ user: login, role: "admin" });
    const cookie = createSessionCookie(token);
    res.setHeader("Set-Cookie", cookie);
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "server error" });
  }
}
