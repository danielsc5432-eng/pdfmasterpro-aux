import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "../../lib/billing/mercadopago";

test("webhook recusa segredo ausente e assinatura ausente ou adulterada", () => {
  assert.equal(verifyWebhookSignature({ secret: "", signatureHeader: null, requestId: null, dataId: null }), false);
  assert.equal(verifyWebhookSignature({ secret: "test-secret", signatureHeader: null, requestId: "req-1", dataId: "123" }), false);
  assert.equal(verifyWebhookSignature({ secret: "test-secret", signatureHeader: "ts=123,v1=bad", requestId: "req-1", dataId: "123" }), false);
  assert.equal(verifyWebhookSignature({ secret: "test-secret", signatureHeader: "ts=123,v1=" + "é".repeat(64), requestId: "req-1", dataId: "123" }), false);
});
test("webhook aceita HMAC valido e recusa recurso diferente", () => {
  const ts = String(Math.floor(Date.now() / 1000));
  const v1 = createHmac("sha256", "test-secret").update("id:123;request-id:req-1;ts:" + ts + ";").digest("hex");
  const input = { secret: "test-secret", signatureHeader: "ts=" + ts + ",v1=" + v1, requestId: "req-1", dataId: "123" };
  assert.equal(verifyWebhookSignature(input), true);
  assert.equal(verifyWebhookSignature({ ...input, dataId: "456" }), false);
});
