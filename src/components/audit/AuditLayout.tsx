import { Outlet, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AuditSidebar } from "./AuditSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { LogOut, ChevronRight, Menu, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useCallback } from "react";

export default function AuditLayout() {
  const { user, loading } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdminAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleSignOut = useCallback(async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    try { await supabase.auth.signOut({ scope: "local" }); } catch {}
    try { await supabase.auth.signOut(); } catch {}
    navigate("/audit/login", { replace: true });
  }, [navigate]);

  if (loading || adminLoading) {
    return (
      <div className="audit-theme min-h-screen flex items-center justify-center bg-[hsl(var(--background))]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent animate-spin" />
          <p className="text-[16px] text-[hsl(var(--muted-foreground))] font-medium">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/audit/login" replace />;
  }

  if (!isAdmin) {
    return (
      <div className="audit-theme min-h-screen flex items-center justify-center bg-[hsl(var(--background))]">
        <div className="flex flex-col items-center gap-6 text-center max-w-md px-6">
          <div className="h-16 w-16 rounded-2xl bg-red-100 flex items-center justify-center">
            <ShieldAlert className="h-8 w-8 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-[hsl(var(--foreground))] mb-2">Acesso Restrito</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              O painel de auditoria é restrito a administradores. Sua conta ({user.email}) não possui permissão.
            </p>
          </div>
          <button onClick={handleSignOut} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors">
            Sair
          </button>
        </div>
      </div>
    );
  }

  // Build breadcrumbs
  const pathParts = location.pathname.replace("/audit", "").split("/").filter(Boolean);
  const breadcrumbLabels: Record<string, string> = {
    audio: "Áudio", video: "Vídeo", photo: "Foto",
    validation: "Validação", transcription: "Transcrição",
    campaigns: "Campanhas", search: "Busca", history: "Histórico",
    settings: "Configurações",
  };

  return (
    <div className="audit-theme bg-[hsl(var(--background))] min-h-screen">
      <SidebarProvider>
        <div className="min-h-screen flex w-full">
          <AuditSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            {/* Header */}
            <header className="h-16 bg-white border-b border-[hsl(var(--border))] flex items-center justify-between px-6 shrink-0 sticky top-0 z-30">
              <div className="flex items-center gap-4">
                <SidebarTrigger className="h-10 w-10 rounded-xl border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] flex items-center justify-center">
                  <Menu className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
                </SidebarTrigger>
                {/* Breadcrumb */}
                <nav className="flex items-center gap-1.5 text-[15px]">
                  <span className="text-[hsl(var(--muted-foreground))]">Auditoria</span>
                  {pathParts.map((part, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      <ChevronRight className="h-4 w-4 text-[hsl(var(--muted-foreground))]/50" />
                      <span className={i === pathParts.length - 1 ? "text-[hsl(var(--foreground))] font-semibold" : "text-[hsl(var(--muted-foreground))]"}>
                        {breadcrumbLabels[part] || part}
                      </span>
                    </span>
                  ))}
                </nav>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[14px] text-[hsl(var(--muted-foreground))] hidden md:block">{user.email}</span>
                <button
                  onClick={handleSignOut}
                  title="Sair"
                  className="h-10 w-10 rounded-xl border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] transition-colors"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </header>
            {/* Content */}
            <main className="flex-1 p-6 md:p-8 overflow-auto">
              <Outlet />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </div>
  );
}
