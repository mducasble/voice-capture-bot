import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Sun, Moon } from "lucide-react";
import KGenButton from "@/components/portal/KGenButton";
import kgenLogo from "@/assets/kgen-logo.svg";

export default function PortalAuth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [lightMode, setLightMode] = useState(false);
  const [lang, setLang] = useState("pt");

  const languages = [
    { code: "pt", flag: "🇧🇷", label: "Português" },
    { code: "es", flag: "🇪🇸", label: "Español" },
    { code: "en", flag: "🇺🇸", label: "English" },
  ];

  // Listen for auth state changes (handles OAuth redirect return)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        navigate("/portal");
      }
    });

    // Check if already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate("/portal");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupName, setSignupName] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      navigate("/portal");
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: {
        data: { full_name: signupName },
        emailRedirectTo: window.location.origin + "/portal",
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Verifique seu e-mail para confirmar o cadastro.");
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/portal",
    });
    if (result?.error) {
      toast.error(result.error.message || "Erro ao entrar com Google");
      setLoading(false);
    }
  };

  return (
    <div className={`portal-auth-page min-h-screen relative overflow-hidden ${lightMode ? "portal-light" : ""}`}>
      {/* Grid background */}
      <div className="absolute inset-0 portal-grid-bg" />

      {/* Theme toggle */}
      <button
        type="button"
        onClick={() => setLightMode(v => !v)}
        className="absolute top-6 right-6 z-20 w-10 h-10 flex items-center justify-center border transition-colors"
        style={{
          borderColor: "var(--portal-border)",
          color: "var(--portal-text-muted)",
        }}
        title={lightMode ? "Modo escuro" : "Modo claro"}
      >
        {lightMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
      </button>

      {/* Decorative corner squares */}
      <div className="absolute top-8 left-8 w-3 h-3" style={{ background: "var(--portal-accent)" }} />
      <div className="absolute bottom-8 left-8 w-3 h-3" style={{ background: "var(--portal-accent)" }} />
      <div className="absolute bottom-8 right-8 w-3 h-3" style={{ background: "var(--portal-accent)" }} />

      {/* Main layout */}
      <div className="relative z-10 min-h-screen flex">
        {/* Left panel — branding */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12" style={{ borderRight: "1px solid var(--portal-border)" }}>
          <div>
            <img src={kgenLogo} alt="KGeN Logo" className="w-20 h-20 mb-6" />
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
              <span className="font-mono text-sm tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>
                AI Quests Platform
              </span>
            </div>
            <h1 className="font-mono text-6xl font-black uppercase leading-[0.95] tracking-tight" style={{ color: "var(--portal-text)" }}>
              Join.
              <br />
              Complete.
              <br />
              <span style={{ color: "var(--portal-accent)" }}>Earn.</span>
            </h1>
            <p className="font-mono text-sm max-w-md leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>
              Plataforma de coleta e preparação de dados para IA.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="h-px flex-1" style={{ background: "var(--portal-border)" }} />
            <span className="font-mono text-xs tracking-wider" style={{ color: "var(--portal-text-muted)" }}>
              © 2026 KGEN
            </span>
          </div>
        </div>

        {/* Right panel — auth form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md">
            {/* Mobile logo */}
            <div className="lg:hidden flex items-center gap-3 mb-10">
              <img src={kgenLogo} alt="KGeN Logo" className="w-14 h-14" />
              <div>
                <h2 className="font-mono text-lg font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
                  KGeN AI Quests
                </h2>
                <p className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
                  Recording Platform
                </p>
              </div>
            </div>

            {/* Mode switcher */}
            <div className="flex" style={{ border: "1px solid var(--portal-border)" }}>
              <button
                type="button"
                onClick={() => setMode("login")}
                className="flex-1 py-3 font-mono text-sm uppercase tracking-widest transition-all"
                style={{
                  background: mode === "login" ? "var(--portal-accent)" : "transparent",
                  color: mode === "login" ? "var(--portal-accent-text)" : "var(--portal-text-muted)",
                  fontWeight: mode === "login" ? 700 : 400,
                }}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="flex-1 py-3 font-mono text-sm uppercase tracking-widest transition-all"
                style={{
                  background: mode === "signup" ? "var(--portal-accent)" : "transparent",
                  color: mode === "signup" ? "var(--portal-accent-text)" : "var(--portal-text-muted)",
                  fontWeight: mode === "signup" ? 700 : 400,
                  borderLeft: "1px solid var(--portal-border)",
                }}
              >
                Cadastrar
              </button>
            </div>

            <div className="mt-8">
              {mode === "login" ? (
                <form onSubmit={handleLogin} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="login-email" className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                      E-mail
                    </Label>
                    <Input
                      id="login-email"
                      type="email"
                      required
                      value={loginEmail}
                      onChange={e => setLoginEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="portal-brutalist-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password" className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                      Senha
                    </Label>
                    <Input
                      id="login-password"
                      type="password"
                      required
                      value={loginPassword}
                      onChange={e => setLoginPassword(e.target.value)}
                      placeholder="••••••••"
                      className="portal-brutalist-input"
                    />
                  </div>
                  <KGenButton
                    type="submit"
                    className="w-full"
                    size="default"
                    disabled={loading}
                    scrambleText={loading ? "ENTRANDO..." : "ENTRAR"}
                    icon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
                  />
                </form>
              ) : (
                <form onSubmit={handleSignup} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name" className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                      Nome completo
                    </Label>
                    <Input
                      id="signup-name"
                      required
                      value={signupName}
                      onChange={e => setSignupName(e.target.value)}
                      placeholder="Seu nome"
                      className="portal-brutalist-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email" className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                      E-mail
                    </Label>
                    <Input
                      id="signup-email"
                      type="email"
                      required
                      value={signupEmail}
                      onChange={e => setSignupEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="portal-brutalist-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password" className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                      Senha
                    </Label>
                    <Input
                      id="signup-password"
                      type="password"
                      required
                      minLength={6}
                      value={signupPassword}
                      onChange={e => setSignupPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      className="portal-brutalist-input"
                    />
                  </div>
                  <KGenButton
                    type="submit"
                    className="w-full"
                    size="default"
                    disabled={loading}
                    scrambleText={loading ? "CRIANDO..." : "CRIAR CONTA"}
                    icon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
                  />
                </form>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3 mt-6 mb-4">
                <div className="h-px flex-1" style={{ background: "var(--portal-border)" }} />
                <span className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>ou</span>
                <div className="h-px flex-1" style={{ background: "var(--portal-border)" }} />
              </div>

              {/* Google Sign In */}
              <KGenButton
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                variant="white"
                className="w-full"
                size="default"
                scrambleText="CONTINUAR COM GOOGLE"
                icon={
                  <svg width="24" height="24" viewBox="0 0 18 18" fill="none">
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                    <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                }
              />
            </div>

            {/* Decorative bottom line */}
            <div className="mt-10 flex items-center gap-3">
              <div className="h-px flex-1" style={{ background: "var(--portal-border)" }} />
              <div className="w-2 h-2" style={{ background: "var(--portal-accent)" }} />
              <div className="h-px flex-1" style={{ background: "var(--portal-border)" }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
