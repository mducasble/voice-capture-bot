import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import kgenLogo from "@/assets/kgen-logo.svg";

export default function PortalAuth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

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
    <div className="portal-auth-bg min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="portal-orb portal-orb-1" />
        <div className="portal-orb portal-orb-2" />
        <div className="portal-orb portal-orb-3" />
      </div>

      {/* Noise texture overlay */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")' }} />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <img src={kgenLogo} alt="KGeN Logo" className="h-32 w-32 rounded-xl mb-5" />
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            KGeN AI Quests
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Plataforma de gravação profissional de áudio
          </p>
        </div>

        {/* Glass Card */}
        <div className="portal-glass-card rounded-2xl p-6">
          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2 rounded-xl p-1" style={{ background: 'hsl(168 28% 10% / 0.5)', borderColor: 'hsl(88 100% 51% / 0.1)' }}>
              <TabsTrigger
                value="login"
                className="rounded-lg data-[state=active]:text-[hsl(168,28%,10%)] data-[state=active]:shadow-none text-muted-foreground transition-all"
                style={{ ['--tw-bg-opacity' as string]: 1 }}
                data-active-style="true"
              >
                Entrar
              </TabsTrigger>
              <TabsTrigger
                value="signup"
                className="rounded-lg data-[state=active]:text-[hsl(168,28%,10%)] data-[state=active]:shadow-none text-muted-foreground transition-all"
              >
                Cadastrar
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4 pt-5">
                <div className="space-y-2">
                  <Label htmlFor="login-email" className="text-sm text-foreground/80">E-mail</Label>
                  <Input
                    id="login-email"
                    type="email"
                    required
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="portal-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password" className="text-sm text-foreground/80">Senha</Label>
                  <Input
                    id="login-password"
                    type="password"
                    required
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="portal-input"
                  />
                </div>
                <Button type="submit" className="w-full portal-button h-11 text-sm font-medium" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Entrar
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4 pt-5">
                <div className="space-y-2">
                  <Label htmlFor="signup-name" className="text-sm text-foreground/80">Nome completo</Label>
                  <Input
                    id="signup-name"
                    required
                    value={signupName}
                    onChange={e => setSignupName(e.target.value)}
                    placeholder="Seu nome"
                    className="portal-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email" className="text-sm text-foreground/80">E-mail</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    required
                    value={signupEmail}
                    onChange={e => setSignupEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="portal-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password" className="text-sm text-foreground/80">Senha</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    required
                    minLength={6}
                    value={signupPassword}
                    onChange={e => setSignupPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="portal-input"
                  />
                </div>
                <Button type="submit" className="w-full portal-button h-11 text-sm font-medium" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Criar conta
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>

        <p className="text-center text-xs text-muted-foreground/50 mt-6">
          © 2026 KGeN AI Quests Platform
        </p>
      </div>
    </div>
  );
}
