import { Navigate, Outlet, Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { FolderOpen, Radio, LogOut, User, Loader2 } from "lucide-react";
import kgenLogo from "@/assets/kgen-logo.svg";

export default function PortalLayout() {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="portal-auth-page min-h-screen flex items-center justify-center">
        <div className="absolute inset-0 portal-grid-bg" />
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--portal-accent)" }} />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/portal/auth" replace />;
  }

  const navItems = [
    { to: "/portal", icon: FolderOpen, label: "CAMPANHAS", exact: true },
    { to: "/portal/rooms", icon: Radio, label: "MINHAS SALAS" },
  ];

  return (
    <div className="portal-auth-page min-h-screen relative">
      <div className="absolute inset-0 portal-grid-bg" />

      <div className="relative z-10">
        {/* Header */}
        <header className="sticky top-0 z-50 backdrop-blur-md" style={{ borderBottom: "1px solid var(--portal-border)", background: "var(--portal-bg)" }}>
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
            <Link to="/portal" className="flex items-center gap-3">
              <img src={kgenLogo} alt="KGeN" className="w-9 h-9" />
              <span className="font-mono text-sm font-black uppercase tracking-wider" style={{ color: "var(--portal-text)" }}>
                KGeN
              </span>
            </Link>

            <nav className="flex items-center gap-1">
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
            </nav>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
                <User className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{user.user_metadata?.full_name || user.email}</span>
              </div>
              <button
                onClick={signOut}
                className="p-2 transition-colors"
                style={{ color: "var(--portal-text-muted)" }}
                title="Sair"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="max-w-7xl mx-auto px-6 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
