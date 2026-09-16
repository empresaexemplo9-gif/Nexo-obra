import { runtimeEnv } from "@/lib/server/runtime";

type EmailConfig = {
  BREVO_API_KEY?: string;
  HOIKOS_EMAIL_FROM?: string;
  HOIKOS_EMAIL_FROM_NAME?: string;
  HOIKOS_EMAIL_REPLY_TO?: string;
};

export type TransactionalEmailResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: "not_configured" | "provider_error" };

function emailConfig() {
  return runtimeEnv() as EmailConfig;
}

export function transactionalEmailConfigured() {
  const config = emailConfig();
  return Boolean(config.BREVO_API_KEY?.trim() && config.HOIKOS_EMAIL_FROM?.trim());
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

export async function sendTransactionalEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<TransactionalEmailResult> {
  const config = emailConfig();
  const apiKey = config.BREVO_API_KEY?.trim();
  const from = config.HOIKOS_EMAIL_FROM?.trim();
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "application/json",
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          email: from,
          name: config.HOIKOS_EMAIL_FROM_NAME?.trim() || "H.OIKOS",
        },
        to: [{ email: input.to }],
        subject: input.subject,
        textContent: input.text,
        htmlContent: input.html,
        ...(config.HOIKOS_EMAIL_REPLY_TO?.trim()
          ? { replyTo: { email: config.HOIKOS_EMAIL_REPLY_TO.trim() } }
          : {}),
      }),
    });

    if (!response.ok) return { sent: false, reason: "provider_error" };
    const payload = await response.json().catch(() => ({})) as { messageId?: unknown };
    return { sent: true, id: typeof payload.messageId === "string" ? payload.messageId : null };
  } catch {
    return { sent: false, reason: "provider_error" };
  }
}

export async function sendDrapReadyEmail(input: {
  to: string;
  displayName: string;
  organizationName: string;
}) {
  const name = escapeHtml(input.displayName || input.to);
  const organization = escapeHtml(input.organizationName);
  const subject = "Soluções financeiras DRAP disponíveis na H.OIKOS";
  const message = "Você já pode usar as soluções financeiras DRAP no seu ecossistema H.OIKOS.";

  return sendTransactionalEmail({
    to: input.to,
    subject,
    text: [
      `Olá, ${input.displayName || input.to}.`,
      "",
      `A conexão da empresa ${input.organizationName} com a DRAP foi confirmada.`,
      message,
      "",
      "Acesse a área Financeiro da H.OIKOS para começar.",
      "",
      "H.OIKOS",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#111827;line-height:1.6">
        <p>Olá, <strong>${name}</strong>.</p>
        <p>A conexão da empresa <strong>${organization}</strong> com a DRAP foi confirmada.</p>
        <p style="font-size:18px"><strong>${message}</strong></p>
        <p>Acesse a área <strong>Financeiro</strong> da H.OIKOS para começar.</p>
        <p style="margin-top:28px;color:#6b7280">H.OIKOS</p>
      </div>
    `.trim(),
  });
}
