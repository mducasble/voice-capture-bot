import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Headphones, Mail } from "lucide-react";
import { toast } from "sonner";

export default function AuditLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");

  useEffect(() => {
    let mounted = true;
    const timer = window.setTimeout(() => { if (mounted) setChecking(false); }, 8000);

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && mounted) {
        navigate("/audit", { replace: true });
        return;
      }
      if (mounted) setChecking(false);
    }).catch(() => { if (mounted) setChecking(false); });

    return () => { mounted = false; window.clearTimeout(timer); };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) { toast.error(error.message); return; }
        toast.success("Cadastro realizado! Verifique seu e-mail para confirmar.");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { toast.error(error.message); return; }
      toast.success("Bem-vindo ao Painel de Auditoria!");
      navigate("/audit", { replace: true });
    } catch {
      toast.error("Erro ao conectar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        extraParams: { prompt: "select_account" },
      });
      if (result.error) {
        toast.error(result.error instanceof Error ? result.error.message : "Erro ao autenticar.");
      }
    } catch {
      toast.error("Erro ao conectar com Google.");
    } finally {
      setGoogleLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="audit-theme min-h-screen flex items-center justify-center bg-[hsl(var(--background))]">
        <div className="h-10 w-10 rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="audit-theme min-h-screen flex items-center justify-center bg-[hsl(var(--background))] p-6">
      <div className="w-full max-w-[440px]">
        {/* Branding */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-[hsl(var(--primary))] shadow-lg mb-5">
            <Headphones className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-[28px] font-bold text-[hsl(var(--foreground))] tracking-tight">
            Painel de Auditoria
          </h1>
          <p className="text-[16px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed">
            Validação e transcrição de campanhas de áudio, vídeo e imagem
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-8">
          {/* Google */}
          <Button
            type="button"
            variant="outline"
            disabled={googleLoading || loading}
            onClick={handleGoogle}
            className="w-full h-14 text-[16px] font-semibold rounded-xl border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
          >
            {googleLoading ? (
              <Loader2 className="h-5 w-5 animate-spin mr-3" />
            ) : (
              <svg className="h-5 w-5 mr-3" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            {googleLoading ? "Autenticando..." : "Entrar com Google"}
          </Button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-[hsl(var(--border))]" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-3 text-[hsl(var(--muted-foreground))]">ou use e-mail</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="audit-email" className="text-[15px] font-medium text-[hsl(var(--foreground))]">E-mail</Label>
              <Input
                id="audit-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="h-13 text-[16px] rounded-xl bg-[hsl(var(--muted))] border-[hsl(var(--border))]"
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-password" className="text-[15px] font-medium text-[hsl(var(--foreground))]">Senha</Label>
              <Input
                id="audit-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-13 text-[16px] rounded-xl bg-[hsl(var(--muted))] border-[hsl(var(--border))]"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-14 text-[16px] font-semibold rounded-xl bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 text-white shadow-md"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Mail className="h-5 w-5 mr-2" />}
              {loading ? "Verificando..." : mode === "login" ? "Entrar" : "Criar Conta"}
            </Button>
          </form>

          <div className="text-center mt-5">
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
              className="text-[15px] text-[hsl(var(--primary))] hover:underline font-medium"
            >
              {mode === "login" ? "Não tem conta? Cadastre-se" : "Já tem conta? Faça login"}
            </button>
          </div>
        </div>

        <p className="text-center text-[13px] text-[hsl(var(--muted-foreground))] mt-6">
          Acesso exclusivo para auditores autorizados
        </p>
      </div>
    </div>
  );
}
