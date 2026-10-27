import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import { abuseHash, attachDevice, canonicalEmail, DEVICE_COOKIE, deviceContext, readDeviceToken, trustedClientIp } from "../../lib/security/abuse";
import { POST as logout } from "../../app/api/auth/logout/route";

test("antifraude: normaliza aliases Gmail sem confundir endereços de outros provedores", () => {
  assert.equal(canonicalEmail(" Jo.Ao+tag@GMAIL.COM "), "joao@gmail.com");
  assert.equal(canonicalEmail("jo.ao@googlemail.com"), "joao@gmail.com");
  assert.notEqual(canonicalEmail("jo.ao@empresa.com"), canonicalEmail("joao@empresa.com"));
  assert.notEqual(canonicalEmail("joao+tag@empresa.com"), canonicalEmail("joao@empresa.com"));
});
test("antifraude: cookie assinado é estável; adulteração e expiração não são aceitas", () => {
  const env = { ...process.env }; process.env.AUTH_SESSION_SECRET = "isolated-abuse-test";
  try {
    const req = new NextRequest("https://example.com"); const device = deviceContext(req);
    assert.equal(readDeviceToken(device.token), device.id);
    assert.equal(readDeviceToken(device.token, Date.now() + 181 * 86400000), null);
    assert.equal(readDeviceToken("f".repeat(64)), null);
    assert.equal(readDeviceToken(device.token.slice(0, -1) + (device.token.endsWith("a") ? "b" : "a")), null);
    const repeated = deviceContext(new NextRequest("https://example.com", { headers: { cookie: `${DEVICE_COOKIE}=${device.token}` } }));
    assert.equal(repeated.id, device.id); assert.equal(repeated.isNew, false);
    const response = attachDevice(NextResponse.json({}), device, req);
    assert.ok(response.cookies.get(DEVICE_COOKIE)?.httpOnly); assert.ok(response.cookies.get(DEVICE_COOKIE)?.secure);
    assert.notEqual(abuseHash("free-account", "same"), abuseHash("free-device", "same"));
  } finally { process.env = env; }
});
test("antifraude: IP só é aceito do ambiente Vercel; cabeçalho comum não permite forjar origem", () => {
  const env = { ...process.env };
  try {
    delete process.env.VERCEL;
    assert.equal(trustedClientIp(new NextRequest("https://example.com", { headers: { "x-vercel-forwarded-for": "192.0.2.1" } })), null);
    process.env.VERCEL = "1";
    assert.equal(trustedClientIp(new NextRequest("https://example.com", { headers: { "x-forwarded-for": "192.0.2.2" } })), null);
    assert.equal(trustedClientIp(new NextRequest("https://example.com", { headers: { "x-vercel-forwarded-for": "192.0.2.1", "x-forwarded-for": "192.0.2.2" } })), "192.0.2.1");
    assert.equal(trustedClientIp(new NextRequest("https://example.com", { headers: { "x-vercel-forwarded-for": "192.0.2.1, 192.0.2.2" } })), null);
  } finally { process.env = env; }
});
test("antifraude: sair apaga login e histórico, preservando o identificador de segurança", () => {
  const env = { ...process.env }; process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
  try {
    const result = logout(new NextRequest("https://example.com/api/auth/logout", { method: "POST", headers: { origin: "https://example.com", cookie: `${DEVICE_COOKIE}=preserve` } }));
    assert.equal(result.status, 303); assert.equal(result.cookies.get(DEVICE_COOKIE), undefined);
    assert.equal(result.cookies.get("webdev_app_session")?.maxAge, 0);
  } finally { process.env = env; }
});
