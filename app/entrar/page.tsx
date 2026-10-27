import type { Metadata } from "next";
import Link from "next/link";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { LocalAuthForm } from "@/components/local-auth-form";
import { LockKeyhole, ShieldCheck } from "lucide-react";
export const metadata: Metadata = { title: "Entrar", description: "Acesse sua conta PDF Master Pro." };
const authErrors: Record<string, string> = {
	account_identity_exists: "Já existe uma conta para esse endereço ou uma variação equivalente. Use a forma de acesso original ou fale com o suporte.",
	registration_limited: "Limite de novos cadastros deste navegador ou conexão atingido. Use uma conta existente ou fale com o suporte.",
	google_not_configured: "O acesso com Google ainda não foi configurado.",
	google_csrf_failed: "Não foi possível validar esta tentativa. Inicie novamente.",
	google_email_unverified: "Use uma conta Google com endereço de e-mail verificado.",
	google_auth_failed: "Não foi possível entrar com Google. Tente novamente.",
};
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ authError?: string }> }) {
	const { authError } = await searchParams;
	const errorMessage = authError ? authErrors[authError] : undefined;
	const manusConfigured = Boolean(process.env.MANUS_PROJECT_ID && process.env.MANUS_OAUTH_PORTAL_URL && process.env.MANUS_OAUTH_API_URL);
	return <div className="page-shell"><div className="empty-panel auth-panel"><div className="tool-card-icon" style={{ margin: "0 auto" }}><LockKeyhole size={22} /></div><h1>Entrar no PDF Master Pro</h1><p>Entre com e-mail e senha ou use a mesma conta Google do cadastro.</p>{errorMessage && <p role="alert" style={{ color: "#b42318" }}>{errorMessage}</p>}<LocalAuthForm mode="signin" /><GoogleSignInButton mode="signin" /><div className="auth-note"><ShieldCheck size={16} /><span>O Google confirma sua identidade; sua senha não é compartilhada com o PDF Master Pro.</span></div>{manusConfigured && <p className="auth-switch"><a href="/api/auth/login">Usar conta Manus</a></p>}<p className="auth-switch">Ainda não tem perfil? <Link href="/criar-conta">Criar conta</Link></p></div></div>;
}
