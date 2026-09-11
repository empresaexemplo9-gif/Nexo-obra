const encoder = new TextEncoder();

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function requestEvidenceHashes(request: Request) {
  const ip = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]
    ?? "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  return {
    ipHash: await digest(ip.trim()),
    userAgentHash: await digest(userAgent.slice(0, 300)),
  };
}
