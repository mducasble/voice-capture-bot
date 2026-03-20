import { Navigate, Outlet, Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { FolderOpen, Layers, LogOut, User, Loader2, DollarSign, Copy, Check, Menu, X, Mail, Link2, Radio } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import kgenLogo from "@/assets/kgen-logo.svg";
import { useTranslation } from "react-i18next";
import LanguageSelector from "./LanguageSelector";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { FaqSidebar } from "./FaqSidebar";
import { useProfileCompletion } from "@/hooks/useProfileCompletion";
import { useAutoFillCountry } from "@/hooks/useAutoFillCountry";
import { AnnouncementBanners } from "@/components/AnnouncementBanner";

export default function PortalLayout() { // layout-root
  const { user, loading, signOut } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();
  const { isComplete: profileComplete, isLoading: profileLoading } = useProfileCompletion();
  useAutoFillCountry();

  if (loading || (user && profileLoading)) {
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

  // Force profile completion — but allow direct invites (rooms, tasks) without it
  const bypassProfileRoutes = location.pathname.startsWith("/room/") || location.pathname.match(/^\/campaign\/[^/]+\/task$/);
  if (!profileComplete && !bypassProfileRoutes && location.pathname !== "/profile") {
    return <Navigate to="/profile" replace />;
  }

  const navItems = [
    { to: "/", icon: FolderOpen, label: t("nav.opportunities"), exact: true },
    { to: "/my-campaigns", icon: Layers, label: t("nav.myCampaigns") },
    { to: "/earnings", icon: DollarSign, label: t("nav.myEarnings") },
    { to: "/rooms", icon: Radio, label: t("nav.publicRooms") },
  ];

  return (
    <div className="portal-auth-page min-h-screen relative">
      <div className="absolute inset-0 portal-grid-bg" />

      <div className="relative z-10">
        {/* Announcements */}
        <AnnouncementBanners />

        {/* Header */}
        <PortalHeader navItems={navItems} user={user} signOut={signOut} />

        {/* Main content */}
        <main className="max-w-7xl mx-auto px-6 py-8">
          <Outlet />
        </main>

        {/* FAQ sidebar — hide on room pages */}
        {!location.pathname.startsWith("/room/") && <FaqSidebar />}
      </div>
    </div>
  );
}

type NavItem = { to: string; icon: any; label: string; exact?: boolean };

function PortalHeader({ navItems, user, signOut }: { navItems: NavItem[]; user: any; signOut: () => void }) {
  const location = useLocation();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isComplete: profileComplete } = useProfileCompletion();

  const { data: hasUnread } = useQuery({
    queryKey: ["inbox-unread", user.id],
    queryFn: async () => {
      const { data: threads } = await supabase
        .from("inbox_threads")
        .select("id")
        .eq("user_id", user.id);
      if (!threads || threads.length === 0) return false;
      const threadIds = threads.map((t: any) => t.id);
      const { count } = await supabase
        .from("inbox_messages")
        .select("id", { count: "exact", head: true })
        .in("thread_id", threadIds)
        .eq("is_read", false)
        .neq("sender_id", user.id);
      return (count ?? 0) > 0;
    },
    refetchInterval: 30000,
  });

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md" style={{ borderBottom: "1px solid var(--portal-border)", background: "var(--portal-bg)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <img src={kgenLogo} alt="KGeN" className="w-9 h-9" />
          <span className="font-mono text-sm font-black uppercase tracking-wider" style={{ color: "var(--portal-text)" }}>
            KGeN
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-3">
          {navItems.map(item => {
            const isActive = item.exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center gap-2 px-4 py-2 font-mono text-xs uppercase tracking-widest transition-all"
                style={{
                  color: isActive ? "var(--portal-accent-text)" : "var(--portal-text-muted)",
                  background: isActive ? "var(--portal-accent)" : "transparent",
                }}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
          <CopyReferralButton userId={user.id} />
          <Link
            to="/inbox"
            className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs uppercase tracking-widest transition-colors"
            style={{
              border: "1px solid var(--portal-accent)",
              color: location.pathname === "/inbox" ? "var(--portal-accent-text)" : "var(--portal-accent)",
              background: location.pathname === "/inbox" ? "var(--portal-accent)" : "transparent",
            }}
            onMouseEnter={(e) => {
              if (location.pathname !== "/inbox") {
                e.currentTarget.style.background = "var(--portal-accent)";
                e.currentTarget.style.color = "var(--portal-accent-text)";
              }
            }}
            onMouseLeave={(e) => {
              if (location.pathname !== "/inbox") {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--portal-accent)";
              }
            }}
            title={t("nav.inbox") || "Inbox"}
          >
            <span className="relative">
              <Mail className="h-3.5 w-3.5" />
              {hasUnread && (
                <span
                  className="absolute -top-1 -right-1 h-2 w-2 rounded-full"
                  style={{ background: "var(--portal-accent)" }}
                />
              )}
            </span>
          </Link>
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <LanguageSelector variant="compact" />
          <UserProfileLink userId={user.id} userName={user.user_metadata?.full_name || user.email || ""} showGlow={!profileComplete} />
          <button onClick={signOut} className="p-2 transition-colors" style={{ color: "var(--portal-text-muted)" }} title={t("nav.logout")}>
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {/* Mobile hamburger */}
        <div className="md:hidden">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <button className="p-2" style={{ color: "var(--portal-text)" }}>
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="portal-auth-page p-0 w-72" style={{ background: "var(--portal-bg)", border: "none", borderLeft: "1px solid var(--portal-border)" }}>
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <div className="flex flex-col h-full">
                <div className="p-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--portal-border)" }}>
                  <span className="font-mono text-sm font-black uppercase" style={{ color: "var(--portal-text)" }}>Menu</span>
                </div>
                <nav className="flex-1 p-4 space-y-1">
                  {navItems.map(item => {
                    const isActive = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setMobileMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-3 font-mono text-xs uppercase tracking-widest transition-all"
                        style={{
                          color: isActive ? "var(--portal-accent-text)" : "var(--portal-text-muted)",
                          background: isActive ? "var(--portal-accent)" : "transparent",
                        }}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                  <Link
                    to="/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 font-mono text-xs uppercase tracking-widest ${!profileComplete ? "profile-glow" : ""}`}
                    style={{
                      color: location.pathname === "/profile" ? "var(--portal-accent)" : "var(--portal-text-muted)",
                      borderRadius: !profileComplete ? "4px" : undefined,
                    }}
                  >
                    <User className="h-4 w-4" />
                    {t("nav.profile") || "Profile"}
                  </Link>
                </nav>
                <div className="p-4 space-y-3" style={{ borderTop: "1px solid var(--portal-border)" }}>
                  <CopyReferralButton userId={user.id} />
                  <LanguageSelector variant="compact" />
                  <button
                    onClick={() => { setMobileMenuOpen(false); signOut(); }}
                    className="flex items-center gap-3 px-4 py-3 font-mono text-xs uppercase tracking-widest w-full"
                    style={{ color: "var(--portal-text-muted)" }}
                  >
                    <LogOut className="h-4 w-4" />
                    {t("nav.logout")}
                  </button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

function UserProfileLink({ userId, userName, showGlow }: { userId: string; userName: string; showGlow?: boolean }) {
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
      className={`flex items-center gap-2 font-mono text-xs uppercase tracking-widest font-bold transition-all ${showGlow && !isOnProfile ? "profile-glow" : ""}`}
      style={{
        color: isOnProfile ? "var(--portal-accent)" : "var(--portal-text-muted)",
        borderRadius: "4px",
        padding: showGlow ? "4px 8px" : undefined,
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
