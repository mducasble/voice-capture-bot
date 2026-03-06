import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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

  useEffect(() => {
    // If already logged in as admin, redirect to dashboard
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id)
          .eq("role", "admin")
          .maybeSingle();
        if (data) {
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
