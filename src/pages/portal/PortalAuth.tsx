import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import KGenButton from "@/components/portal/KGenButton";
import kgenLogo from "@/assets/kgen-logo.svg";

export default function PortalAuth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");

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

  return (
    <div className="portal-auth-page min-h-screen relative overflow-hidden">
      {/* Grid background */}
      <div className="absolute inset-0 portal-grid-bg" />

      {/* Decorative corner squares */}
      <div className="absolute top-8 left-8 w-3 h-3 bg-[#8cff05]" />
      <div className="absolute top-8 right-8 w-3 h-3 bg-[#8cff05]" />
      <div className="absolute bottom-8 left-8 w-3 h-3 bg-[#8cff05]" />
      <div className="absolute bottom-8 right-8 w-3 h-3 bg-[#8cff05]" />

      {/* Main layout */}
      <div className="relative z-10 min-h-screen flex">
        {/* Left panel — branding */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 border-r border-[#2a2a2a]">
          <div>
            <img src={kgenLogo} alt="KGeN Logo" className="w-20 h-20 mb-6" />
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 bg-[#8cff05]" />
              <span className="font-mono text-sm tracking-[0.3em] uppercase text-[#8cff05]">
                AI Quests Platform
              </span>
            </div>
            <h1 className="font-mono text-6xl font-black uppercase leading-[0.95] tracking-tight text-foreground">
              Record.
              <br />
              Enhance.
              <br />
              <span className="text-[#8cff05]">Deliver.</span>
            </h1>
            <p className="font-mono text-sm text-muted-foreground max-w-md leading-relaxed">
              Plataforma profissional de gravação e aprimoramento de áudio para campanhas de dados de voz.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-[#2a2a2a]" />
            <span className="font-mono text-xs text-muted-foreground tracking-wider">
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
                <h2 className="font-mono text-lg font-black uppercase tracking-tight text-foreground">
                  KGeN AI Quests
                </h2>
                <p className="font-mono text-xs text-muted-foreground">
                  Recording Platform
                </p>
              </div>
            </div>

            {/* Mode switcher */}
            <div className="flex border border-[#2a2a2a] mb-8">
              <button
                type="button"
                onClick={() => setMode("login")}
                className={`flex-1 py-3 font-mono text-sm uppercase tracking-widest transition-all ${
                  mode === "login"
                    ? "bg-[#8cff05] text-[#1f3338] font-bold"
                    : "bg-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={`flex-1 py-3 font-mono text-sm uppercase tracking-widest border-l border-[#2a2a2a] transition-all ${
                  mode === "signup"
                    ? "bg-[#8cff05] text-[#1f3338] font-bold"
                    : "bg-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Cadastrar
              </button>
            </div>

            {mode === "login" ? (
              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="login-email" className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
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
                  <Label htmlFor="login-password" className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
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
                <KGenButton type="submit" className="w-full" size="default" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {loading ? "ENTRANDO..." : "ENTRAR"}
                </KGenButton>
              </form>
            ) : (
              <form onSubmit={handleSignup} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="signup-name" className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
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
                  <Label htmlFor="signup-email" className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
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
                  <Label htmlFor="signup-password" className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
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
                <KGenButton type="submit" className="w-full" size="default" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {loading ? "CRIANDO..." : "CRIAR CONTA"}
                </KGenButton>
              </form>
            )}

            {/* Decorative bottom line */}
            <div className="mt-10 flex items-center gap-3">
              <div className="h-px flex-1 bg-[#2a2a2a]" />
              <div className="w-2 h-2 bg-[#8cff05]" />
              <div className="h-px flex-1 bg-[#2a2a2a]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
