import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Loader2, ShieldCheck, Lock } from "lucide-react";
import { toast } from "sonner";

export default function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [googleLoading, setGoogleLoading] = useState(false);

  const checkAdminAndRedirect = async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    return !!data;
  };

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const isAdmin = await checkAdminAndRedirect(session.user.id);
        if (isAdmin) {
          navigate("/admin", { replace: true });
          return;
        }
      }
      setChecking(false);
    };
    check();
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Sign out any existing session first to avoid portal session conflicts
    await supabase.auth.signOut();

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    if (!data.user) {
      toast.error("Erro ao autenticar.");
      setLoading(false);
      return;
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      await supabase.auth.signOut();
      toast.error("Acesso negado. Esta conta não possui permissão de administrador.");
      setLoading(false);
      return;
    }

    toast.success("Bem-vindo ao painel administrativo!");
    navigate("/admin", { replace: true });
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    // Sign out any existing session first
    await supabase.auth.signOut();

    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/admin/login",
    });

    if (result.error) {
      toast.error("Erro ao autenticar com Google.");
      setGoogleLoading(false);
      return;
    }

    // If redirected, the page will reload and useEffect will handle the check
    if (!result.redirected) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const isAdmin = await checkAdminAndRedirect(session.user.id);
        if (isAdmin) {
          toast.success("Bem-vindo ao painel administrativo!");
          navigate("/admin", { replace: true });
        } else {
          await supabase.auth.signOut();
          toast.error("Acesso negado. Esta conta não possui permissão de administrador.");
        }
      }
      setGoogleLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="admin-theme min-h-screen flex items-center justify-center bg-background">
        <div className="h-10 w-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="admin-theme min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-secondary/30 p-4">
      {/* Subtle grid background */}
      <div className="fixed inset-0 opacity-[0.015]" style={{
        backgroundImage: "radial-gradient(circle at 1px 1px, hsl(var(--foreground)) 1px, transparent 0)",
        backgroundSize: "32px 32px",
      }} />

      <div className="relative w-full max-w-md">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-[hsl(280_72%_60%)] shadow-xl shadow-primary/25 mb-4">
            <ShieldCheck className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">KGen Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">Painel administrativo restrito</p>
        </div>

        <Card className="border-0 shadow-xl">
          <CardHeader className="pb-0 pt-6 px-6">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              <Lock className="h-3.5 w-3.5" />
              Acesso Restrito
            </div>
          </CardHeader>
          <CardContent className="p-6 pt-4">
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="admin-email" className="text-sm font-medium text-foreground">
                  E-mail
                </Label>
                <Input
                  id="admin-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@kgen.ai"
                  className="h-11 bg-secondary/50 border-border focus-visible:ring-primary"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-password" className="text-sm font-medium text-foreground">
                  Senha
                </Label>
                <Input
                  id="admin-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-11 bg-secondary/50 border-border focus-visible:ring-primary"
                  autoComplete="current-password"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-gradient-to-r from-primary to-[hsl(280_72%_60%)] hover:opacity-90 text-primary-foreground font-semibold shadow-lg shadow-primary/20 transition-all"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <ShieldCheck className="h-4 w-4 mr-2" />
                )}
                {loading ? "Verificando..." : "Entrar"}
              </Button>

              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">ou</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                disabled={googleLoading || loading}
                onClick={handleGoogleLogin}
                className="w-full h-11 font-semibold"
              >
                {googleLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                )}
                {googleLoading ? "Autenticando..." : "Entrar com Google"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Apenas contas com permissão de administrador podem acessar este painel.
        </p>
      </div>
    </div>
  );
}
