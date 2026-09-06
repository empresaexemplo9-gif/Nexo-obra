import type { NextApiRequest, NextApiResponse } from "next";
import { verifySession, parseCookieHeader } from "../../lib/auth";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();
  try {
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies["__Host-session"];
    const session = verifySession(token);
    return res.status(200).json({ role: session?.role || null });
  } catch {
    return res.status(200).json({ role: null });
  }
}
