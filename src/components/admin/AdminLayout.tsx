import { Outlet, Navigate } from "react-router-dom";
import { AdminSidebar } from "./AdminSidebar";
import {
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { LogOut, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/hooks/useAdminAuth";

export default function AdminLayout() {
  const { user, isAdmin, loading, signOut } = useAdminAuth();

  if (loading) {
    return (
      <div className="admin-theme min-h-screen flex items-center justify-center" style={{ background: "#000" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground font-medium">Verificando acesso...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  if (!isAdmin) {
    return (
      <div className="admin-theme min-h-screen flex items-center justify-center" style={{ background: "#000" }}>
        <div className="flex flex-col items-center gap-6 text-center max-w-md px-6">
          <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <ShieldAlert className="h-8 w-8 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-foreground mb-2">Acesso Negado</h1>
            <p className="text-sm text-muted-foreground">
              Você não tem permissão para acessar o painel administrativo.
              Sua conta ({user.email}) não possui a role de administrador.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => window.location.href = "/"}>
              Voltar ao Portal
            </Button>
            <Button variant="destructive" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-theme" style={{ background: "#000" }}>
      <SidebarProvider>
        <div className="min-h-screen flex w-full p-2 gap-2">
          {/* Sidebar panel */}
          <div className="admin-panel-sidebar shrink-0">
            <AdminSidebar />
          </div>
          {/* Main area */}
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            {/* Top bar panel */}
            <header className="admin-panel h-12 flex items-center justify-between px-5 shrink-0">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
              <button
                onClick={signOut}
                title="Sair"
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </header>
            {/* Content panel */}
            <main className="admin-panel flex-1 p-6 overflow-auto">
              <Outlet />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </div>
  );
}
