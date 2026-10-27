import type { Metadata } from "next";
import Link from "next/link";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { LocalAuthForm } from "@/components/local-auth-form";
import { UserRoundPlus, ShieldCheck } from "lucide-react";
export const metadata: Metadata = { title: "Criar conta", description: "Crie sua conta PDF Master Pro." };
const authErrors: Record<string, string> = {
	account_identity_exists: "Já existe uma conta para esse endereço ou uma variação equivalente. Use a forma de acesso original ou fale com o suporte.",
	registration_limited: "Limite de novos cadastros deste navegador ou conexão atingido. Aguarde 24 horas ou fale com o suporte.",
	google_not_configured: "O cadastro com Google ainda não foi configurado.",
	google_csrf_failed: "Não foi possível validar esta tentativa. Inicie novamente.",
	google_email_unverified: "Use uma conta Google com endereço de e-mail verificado.",
	google_auth_failed: "Não foi possível concluir o cadastro com Google. Tente novamente.",
};
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ authError?: string }> }) {
	const { authError } = await searchParams;
	const errorMessage = authError ? authErrors[authError] : undefined;
	const manusConfigured = Boolean(process.env.MANUS_PROJECT_ID && process.env.MANUS_OAUTH_PORTAL_URL && process.env.MANUS_OAUTH_API_URL);
	return <div className="page-shell"><div className="empty-panel auth-panel"><div className="tool-card-icon" style={{ margin: "0 auto" }}><UserRoundPlus size={22} /></div><h1>Criar sua conta</h1><p>Preencha seus dados e crie uma senha. Você também pode continuar com Google.</p>{errorMessage && <p role="alert" style={{ color: "#b42318" }}>{errorMessage}</p>}<LocalAuthForm mode="signup" /><GoogleSignInButton mode="signup" /><div className="auth-note"><ShieldCheck size={16} /><span>O Google confirma sua identidade; sua senha não é compartilhada com o PDF Master Pro.</span></div>{manusConfigured && <p className="auth-switch"><a href="/api/auth/login?mode=signup">Usar conta Manus</a></p>}<p className="auth-switch">Já tem conta? <Link href="/entrar">Entrar</Link></p></div></div>;
}
