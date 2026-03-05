import { Navigate, Outlet, Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { FolderOpen, Layers, LogOut, User, Loader2, DollarSign, Copy, Check, Menu, X } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import kgenLogo from "@/assets/kgen-logo.svg";
import { useTranslation } from "react-i18next";
import LanguageSelector from "./LanguageSelector";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";

export default function PortalLayout() {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="portal-auth-page min-h-screen flex items-center justify-center">
        <div className="absolute inset-0 portal-grid-bg" />
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--portal-accent)" }} />
      </div>
    );
  }

  if (!user) {
    const intended = location.pathname + location.search + location.hash;
    if (intended && intended !== "/" && intended !== "/auth") {
      sessionStorage.setItem("redirect_after_login", intended);
    }
    return <Navigate to="/auth" replace />;
  }

  const navItems = [
    { to: "/", icon: FolderOpen, label: t("nav.opportunities"), exact: true },
    { to: "/my-campaigns", icon: Layers, label: t("nav.myCampaigns") },
    { to: "/earnings", icon: DollarSign, label: t("nav.myEarnings") },
  ];

  return (
    <div className="portal-auth-page min-h-screen relative">
      <div className="absolute inset-0 portal-grid-bg" />

      <div className="relative z-10">
        {/* Header */}
        <PortalHeader navItems={navItems} user={user} signOut={signOut} />

        {/* Main content */}
        <main className="max-w-7xl mx-auto px-6 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function UserProfileLink({ userId, userName }: { userId: string; userName: string }) {
  const { data: profile } = useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", userId)
        .single();
      return data;
    },
    enabled: !!userId,
  });

  const avatarUrl = (profile as any)?.avatar_url;
  const isOnProfile = useLocation().pathname === "/profile";

  return (
    <Link
      to="/profile"
      className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest font-bold transition-all"
      style={{
        color: isOnProfile ? "var(--portal-accent)" : "var(--portal-text-muted)",
      }}
      onMouseEnter={(e) => {
        if (!isOnProfile) e.currentTarget.style.color = "var(--portal-accent)";
      }}
      onMouseLeave={(e) => {
        if (!isOnProfile) e.currentTarget.style.color = "var(--portal-text-muted)";
      }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt="Avatar"
          className="w-6 h-6 rounded-full object-cover"
          style={{ border: "1.5px solid var(--portal-accent)" }}
        />
      ) : (
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center"
          style={{ background: "hsl(0 0% 20%)", border: "1.5px solid var(--portal-border)" }}
        >
          <User className="h-3 w-3" style={{ color: "var(--portal-text-muted)" }} />
        </div>
      )}
      <span className="hidden sm:inline">{userName}</span>
    </Link>
  );
}

function CopyReferralButton({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();

  const { data: profile } = useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("referral_code, avatar_url")
        .eq("id", userId)
        .single();
      return data;
    },
    enabled: !!userId,
  });

  const code = (profile as any)?.referral_code;
  if (!code) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${code}`);
    setCopied(true);
    toast.success(t("nav.copied"));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs uppercase tracking-widest transition-colors"
      style={{
        border: "1px solid var(--portal-accent)",
        color: copied ? "var(--portal-accent-text)" : "var(--portal-accent)",
        background: copied ? "var(--portal-accent)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!copied) {
          e.currentTarget.style.background = "var(--portal-accent)";
          e.currentTarget.style.color = "var(--portal-accent-text)";
        }
      }}
      onMouseLeave={(e) => {
        if (!copied) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--portal-accent)";
        }
      }}
      title={t("nav.myLink")}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      <span className="hidden sm:inline">{copied ? t("nav.copied") : t("nav.myLink")}</span>
    </button>
  );
}
