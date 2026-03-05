import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Sun, Moon, ArrowRight, Layers, Clock as ClockIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import KGenButton from "@/components/portal/KGenButton";
import kgenLogo from "@/assets/kgen-logo.svg";
import { TASK_TYPE_LABELS } from "@/lib/campaignTypes";

type AuthMode = "login" | "signup" | "vendor";

export default function PortalAuth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [lightMode, setLightMode] = useState(false);
  const [lang, setLang] = useState("pt");

  const languages = [
    { code: "pt", flag: "https://flagcdn.com/w80/br.png", label: "Português" },
    { code: "es", flag: "https://flagcdn.com/w80/es.png", label: "Español" },
    { code: "en", flag: "https://flagcdn.com/w80/us.png", label: "English" },
  ];

  // Lightweight public campaigns query (no auth needed)
  const { data: publicCampaigns } = useQuery({
    queryKey: ["public-campaigns-preview"],
    queryFn: async () => {
      const { data: campaigns } = await supabase
        .from("campaigns")
        .select("id, name, language_primary, campaign_status, start_date, is_active, visibility_is_public")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(8);

      if (!campaigns || campaigns.length === 0) return [];

      const ids = campaigns.map(c => c.id);
      const [taskSetsRes, rewardRes, langVarRes] = await Promise.all([
        supabase.from("campaign_task_sets").select("campaign_id, task_type, enabled").in("campaign_id", ids),
        supabase.from("campaign_reward_config").select("campaign_id, currency, base_rate, payout_model").in("campaign_id", ids),
        supabase.from("campaign_language_variants").select("campaign_id, label").in("campaign_id", ids),
      ]);

      return campaigns.map(c => ({
        ...c,
        task_sets: (taskSetsRes.data || []).filter(ts => ts.campaign_id === c.id && ts.enabled),
        reward: (rewardRes.data || []).find(r => r.campaign_id === c.id),
        languages: (langVarRes.data || []).filter(l => l.campaign_id === c.id),
        isOpen: c.start_date ? new Date(c.start_date) <= new Date() : true,
      }));
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        navigate("/");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate("/");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupName, setSignupName] = useState("");

  const [vendorEmail, setVendorEmail] = useState("");
  const [vendorPassword, setVendorPassword] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [vendorCompany, setVendorCompany] = useState("");

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
      navigate("/");
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
        emailRedirectTo: window.location.origin + "/",
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Verifique seu e-mail para confirmar o cadastro.");
    }
  };

  const handleVendorSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    // 1. Create the user account
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: vendorEmail,
      password: vendorPassword,
      options: {
        data: { full_name: vendorName },
        emailRedirectTo: window.location.origin + "/",
      },
    });
    
    if (signUpError) {
      toast.error(signUpError.message);
      setLoading(false);
      return;
    }

    // 2. Create vendor application (will work after email confirmation via trigger/profile)
    if (signUpData.user) {
      const { error: appError } = await supabase
        .from("vendor_applications")
        .insert({
          user_id: signUpData.user.id,
          company_name: vendorCompany || null,
          status: "pending",
        });

      if (appError) {
        console.warn("Vendor application insert deferred:", appError.message);
      }
    }

    setLoading(false);
    toast.success(
      "Cadastro de Vendor enviado! Verifique seu e-mail e aguarde a aprovação do administrador.",
      { duration: 6000 }
    );
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/",
    });
    if (result?.error) {
      toast.error(result.error.message || "Erro ao entrar com Google");
      setLoading(false);
    }
  };

  const tabs: { key: AuthMode; label: string }[] = [
    { key: "login", label: "Entrar" },
    { key: "signup", label: "Cadastrar" },
    { key: "vendor", label: "Vendor" },
  ];

  return (
    <div className={`portal-auth-page min-h-screen relative overflow-hidden ${lightMode ? "portal-light" : ""}`}>
      <div className="absolute inset-0 portal-grid-bg" />

      {/* Top bar: language flags + theme toggle */}
      <div className="absolute top-6 right-6 z-20 flex items-center gap-2">
        {languages.map(l => (
          <button
            key={l.code}
            type="button"
            onClick={() => setLang(l.code)}
            className="w-10 h-10 flex items-center justify-center cursor-pointer overflow-hidden transition-all"
            style={{
              border: lang === l.code ? "2px solid var(--portal-accent)" : "1px solid var(--portal-border)",
              background: "var(--portal-input-bg)",
            }}
            title={l.label}
          >
            <img src={l.flag} alt={l.label} className="w-7 h-auto" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => setLightMode(v => !v)}
          className="w-10 h-10 flex items-center justify-center border transition-colors"
          style={{
            borderColor: "var(--portal-border)",
            color: "var(--portal-text-muted)",
          }}
          title={lightMode ? "Modo escuro" : "Modo claro"}
        >
          {lightMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>
      </div>

      <div className="absolute top-8 left-8 w-3 h-3" style={{ background: "var(--portal-accent)" }} />
      <div className="absolute bottom-8 left-8 w-3 h-3" style={{ background: "var(--portal-accent)" }} />
      <div className="absolute bottom-8 right-8 w-3 h-3" style={{ background: "var(--portal-accent)" }} />

      <div className="relative z-10 min-h-screen flex">
        {/* Left panel — split into branding (left) + opportunities (right) */}
        <div className="hidden lg:flex lg:w-2/3 flex-row" style={{ borderRight: "1px solid var(--portal-border)" }}>
          {/* Branding column */}
          <div className="w-[70%] flex flex-col justify-between p-10" style={{ borderRight: "1px solid var(--portal-border)" }}>
            <div>
              <img src={kgenLogo} alt="KGeN Logo" className="w-16 h-16 mb-6" />
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5" style={{ background: "var(--portal-accent)" }} />
                <span className="font-mono text-xs tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>
                  AI Quests Platform
                </span>
              </div>
            </div>

            <div>
              <h1 className="font-mono text-5xl font-black uppercase leading-[0.95] tracking-tight" style={{ color: "var(--portal-text)" }}>
                Join.
                <br />
                Complete.
                <br />
                <span style={{ color: "var(--portal-accent)" }}>Earn.</span>
              </h1>
              <p className="font-mono text-sm max-w-md leading-relaxed mt-4" style={{ color: "var(--portal-text-muted)" }}>
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

          {/* Opportunities column */}
          <div className="w-[30%] flex flex-col">
            <div className="p-5 flex items-center gap-2" style={{ borderBottom: "1px solid var(--portal-border)" }}>
              <div className="w-2 h-2" style={{ background: "var(--portal-accent)" }} />
              <span className="font-mono text-xs tracking-[0.2em] uppercase font-bold" style={{ color: "var(--portal-text-muted)" }}>
                Oportunidades Abertas
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {(!publicCampaigns || publicCampaigns.length === 0) && (
                <p className="font-mono text-xs py-8 text-center" style={{ color: "var(--portal-text-muted)" }}>
                  Nenhuma oportunidade disponível no momento.
                </p>
              )}

              {publicCampaigns?.map(c => {
                const taskLabels = c.task_sets.map((ts: any) => TASK_TYPE_LABELS[ts.task_type] || ts.task_type);
                const reward = c.reward;
                return (
                  <div
                    key={c.id}
                    className="overflow-hidden transition-colors"
                    style={{ border: "1px solid var(--portal-border)", background: "color-mix(in srgb, var(--portal-card-bg) 50%, transparent)" }}
                  >
                    {/* Top section: task type + title WITH green reward sidebar */}
                    <div className="flex">
                      {/* Left 80% — task type + title */}
                      <div className="flex-[4] flex flex-col">
                        {taskLabels.length > 0 && (
                          <div
                            className="flex items-center gap-1.5 px-3 py-2"
                            style={{ borderBottom: "1px solid var(--portal-border)" }}
                          >
                            <Layers className="w-3 h-3" style={{ color: "var(--portal-text-muted)" }} />
                            <span className="font-mono text-[10px] uppercase tracking-widest font-bold" style={{ color: "var(--portal-text-muted)" }}>
                              {taskLabels.join(" · ")}
                            </span>
                          </div>
                        )}
                        <div className="px-3 py-2">
                          <h3 className="font-mono text-sm font-bold uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
                            {c.name}
                          </h3>
                        </div>
                      </div>

                      {/* Right 20% — reward highlight */}
                      <div
                        className="flex-[1] flex flex-col items-center justify-center p-2"
                        style={{ background: "var(--portal-accent)", borderLeft: "1px solid var(--portal-border)" }}
                      >
                        {reward?.base_rate ? (
                          <>
                            <span className="font-mono text-xl font-black leading-none" style={{ color: "var(--portal-accent-text)" }}>
                              {reward.currency === "BRL" ? "R$" : "$"}{reward.base_rate}
                            </span>
                            <span className="font-mono text-[8px] uppercase tracking-widest font-bold mt-0.5" style={{ color: "var(--portal-accent-text)", opacity: 0.7 }}>
                              /{reward.payout_model === "per_accepted_hour" ? "hora" : "un"}
                            </span>
                          </>
                        ) : (
                          <span className="font-mono text-[10px] uppercase tracking-widest font-bold" style={{ color: "var(--portal-accent-text)" }}>
                            —
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Bottom section: languages + button (full width, no green sidebar) */}
                    <div style={{ borderTop: "1px solid var(--portal-border)" }}>
                      <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--portal-border)" }}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {c.languages.map((l: any, i: number) => (
                            <span
                              key={i}
                              className="font-mono text-xs font-bold px-2 py-0.5"
                              style={{ background: "hsl(0 0% 25%)", color: "hsl(0 0% 80%)", border: "1px solid var(--portal-border)" }}
                            >
                              {l.label}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="px-3 py-3 flex justify-center">
                        {c.isOpen ? (
                          <KGenButton
                            variant="dark"
                            size="sm"
                            icon={<ArrowRight className="w-4 h-4" />}
                            scrambleText="Participar"
                            className="w-[80%]"
                          >
                            Participar
                          </KGenButton>
                        ) : (
                          <KGenButton
                            variant="outline"
                            size="sm"
                            icon={<ClockIcon className="w-4 h-4" />}
                            scrambleText="Waiting List"
                            className="w-[80%] opacity-60"
                            disabled
                          >
                            Waiting List
                          </KGenButton>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
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



            {/* Mode switcher — 3 tabs */}
            <div className="flex" style={{ border: "1px solid var(--portal-border)" }}>
              {tabs.map((tab, i) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setMode(tab.key)}
                  className="flex-1 py-3 font-mono text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-1.5"
                  style={{
                    background: mode === tab.key ? "var(--portal-accent)" : "transparent",
                    color: mode === tab.key ? "var(--portal-accent-text)" : "var(--portal-text-muted)",
                    fontWeight: mode === tab.key ? 700 : 400,
                    borderLeft: i > 0 ? "1px solid var(--portal-border)" : "none",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mt-8">
              {mode === "login" && (
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
              )}

              {mode === "signup" && (
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

              {mode === "vendor" && (
                <form onSubmit={handleVendorSignup} className="space-y-5">
                  <div className="p-3 font-mono text-xs leading-relaxed" style={{ border: "1px solid var(--portal-accent)", color: "var(--portal-accent)", background: "color-mix(in srgb, var(--portal-accent) 8%, transparent)" }}>
                    Seja um vendor e tenha acesso a mais slots de campanha e outras funcionalidades da plataforma.
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vendor-name" className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                      Nome completo
                    </Label>
                    <Input
                      id="vendor-name"
                      required
                      value={vendorName}
                      onChange={e => setVendorName(e.target.value)}
                      placeholder="Seu nome"
                      className="portal-brutalist-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vendor-company" className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                      Empresa / Organização (opcional)
                    </Label>
                    <Input
                      id="vendor-company"
                      value={vendorCompany}
                      onChange={e => setVendorCompany(e.target.value)}
                      placeholder="Nome da empresa"
                      className="portal-brutalist-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vendor-email" className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                      E-mail
                    </Label>
                    <Input
                      id="vendor-email"
                      type="email"
                      required
                      value={vendorEmail}
                      onChange={e => setVendorEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="portal-brutalist-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vendor-password" className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                      Senha
                    </Label>
                    <Input
                      id="vendor-password"
                      type="password"
                      required
                      minLength={6}
                      value={vendorPassword}
                      onChange={e => setVendorPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      className="portal-brutalist-input"
                    />
                  </div>
                  <KGenButton
                    type="submit"
                    className="w-full"
                    size="default"
                    disabled={loading}
                    scrambleText={loading ? "ENVIANDO..." : "SOLICITAR CONTA VENDOR"}
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
