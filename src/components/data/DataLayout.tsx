import { Outlet, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, User, Loader2 } from "lucide-react";
import kgenLogo from "@/assets/kgen-logo-green.png";

interface Profile {
  full_name: string | null;
  avatar_url: string | null;
  country: string | null;
  total_review_seconds: number | null;
}

export default function DataLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("full_name, avatar_url, country, total_review_seconds")
      .eq("id", user.id).maybeSingle()
      .then(({ data }) => setProfile(data as Profile | null));
  }, [user]);

  const handleSignOut = async () => {
    try { await supabase.auth.signOut({ scope: "local" }); } catch {}
    try { await supabase.auth.signOut(); } catch {}
    navigate("/data/login", { replace: true });
  };

  if (loading) {
    return (
      <div className="data-theme min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, hsl(0 0% 5%) 0%, hsl(0 0% 9%) 40%, hsl(220 4% 8%) 70%, hsl(0 0% 5%) 100%)" }}>
        <Loader2 className="h-8 w-8 animate-spin text-white/60" />
      </div>
    );
  }

  if (!user) return <Navigate to="/data/login" replace />;

  const initials = (profile?.full_name || user.email || "U").slice(0, 2).toUpperCase();

  return (
    <div className="data-theme min-h-screen flex flex-col" style={{ background: "linear-gradient(135deg, hsl(230 25% 8%) 0%, hsl(260 20% 12%) 50%, hsl(220 25% 8%) 100%)" }}>
      {/* Top bar */}
      <header className="sticky top-0 z-50 h-16 md:h-[72px] flex items-center justify-between px-5 md:px-8 backdrop-blur-2xl bg-white/[0.03] border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl overflow-hidden bg-white/10 flex items-center justify-center">
            <img src={kgenLogo} alt="KGeN" className="h-6 w-6 object-contain" />
          </div>
          <span className="text-[18px] font-bold text-white tracking-tight hidden sm:block">KGeN Data</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Profile */}
          <button
            onClick={() => navigate("/data/profile")}
            className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.06] transition-colors"
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-white/10" />
            ) : (
              <div className="h-9 w-9 rounded-full bg-[hsl(var(--primary))]/20 flex items-center justify-center text-[13px] font-bold text-[hsl(var(--primary))]">
                {initials}
              </div>
            )}
            <div className="hidden md:block text-left">
              <p className="text-[14px] font-medium text-white/90 leading-tight">{profile?.full_name || user.email}</p>
              <p className="text-[12px] text-white/40 leading-tight">{profile?.country || "Contributor"}</p>
            </div>
          </button>

          <button onClick={handleSignOut} title="Sair"
            className="h-10 w-10 rounded-xl flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-colors">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-5 md:px-8 py-6 md:py-10 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
