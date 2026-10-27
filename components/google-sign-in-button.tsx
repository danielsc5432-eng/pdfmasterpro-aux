import Script from "next/script";

export function GoogleSignInButton({ mode }: { mode: "signup" | "signin" }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) return <p role="alert">O acesso com Google ainda não foi configurado.</p>;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") || "https://www.pdfmasterpro.com.br";

  return <>
    <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
    <div
      id="g_id_onload"
      data-client_id={clientId}
      data-login_uri={`${siteUrl}/api/auth/google/callback?mode=${mode}`}
      data-ux_mode="redirect"
      data-auto_prompt="false"
      data-context={mode}
    />
    <div
      className="g_id_signin"
      data-type="standard"
      data-size="large"
      data-theme="outline"
      data-text={mode === "signup" ? "signup_with" : "signin_with"}
      data-shape="rectangular"
      data-logo_alignment="left"
      data-locale="pt_BR"
    />
  </>;
}