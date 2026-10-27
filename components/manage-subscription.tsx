"use client";

import { Loader2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CancelSubscriptionButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm("Cancelar a renovação? Você mantém o acesso Premium até o fim do período já pago.")) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/cancel", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível cancelar agora.");
      router.refresh();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Não foi possível cancelar agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button type="button" className="button button-ghost" onClick={cancel} disabled={loading}>
        {loading ? <Loader2 className="spinner" size={16} /> : <XCircle size={16} />} Cancelar renovação
      </button>
      {error ? <p className="plan-error">{error}</p> : null}
    </div>
  );
}
