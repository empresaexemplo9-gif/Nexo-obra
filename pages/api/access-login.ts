import type { NextApiRequest, NextApiResponse } from "next";
import { signSession, createSessionCookie } from "../../lib/auth";

type Body = { login?: string; password?: string };

function getRoleForCredentials(login?: string, password?: string): "admin" | "consultant" | null {
  // Support environment variables for credentials. In production use a users database and hashed passwords.
  const adminLogin = process.env.ADMIN_LOGIN;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const consultantLogin = process.env.CONSULTANT_LOGIN;
  const consultantPassword = process.env.CONSULTANT_PASSWORD;

  if (!adminLogin && !consultantLogin) return null;

  if (adminLogin && adminPassword && login === adminLogin && password === adminPassword) return "admin";
  if (consultantLogin && consultantPassword && login === consultantLogin && password === consultantPassword) return "consultant";
  return null;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const body = req.body as Body;
  const role = getRoleForCredentials(body?.login, body?.password);
  if (!role) return res.status(401).json({ error: "Invalid credentials" });
  try {
    const token = signSession({ user: body.login || "", role });
    const cookie = createSessionCookie(token);
    res.setHeader("Set-Cookie", cookie);
    return res.status(200).json({ role });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "server error" });
  }
}
