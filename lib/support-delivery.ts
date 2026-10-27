import { supportEmail } from "@/lib/support";

export function supportDeliveryConfigured() {
  return Boolean(supportEmail() && process.env.RESEND_API_KEY?.trim() && process.env.SUPPORT_FROM_EMAIL?.match(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/));
}

export async function deliverSupport(text: string, replyTo: string, protocol: string, transport: typeof fetch = fetch) {
  if (!supportDeliveryConfigured()) throw new Error("SUPPORT_UNCONFIGURED");
  const response = await transport("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `support/${protocol}` },
    body: JSON.stringify({ from: process.env.SUPPORT_FROM_EMAIL, to: [supportEmail()], reply_to: replyTo, subject: `[Atendimento ${protocol}] PDF Master Pro`, text }),
  });
  if (!response.ok) throw new Error("SUPPORT_PROVIDER_FAILED");
  const result = await response.json();
  if (!result || typeof result.id !== "string" || !result.id) throw new Error("SUPPORT_PROVIDER_FAILED");
  return result.id as string;
}
