import { Outlet, Navigate } from "react-router-dom";
import { AdminSidebar } from "./AdminSidebar";
import {
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Bell, Search, LogOut, ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/hooks/useAdminAuth";

export default function AdminLayout() {
  const { user, isAdmin, loading, signOut } = useAdminAuth();

  if (loading) {
    return (
      <div className="admin-theme min-h-screen flex items-center justify-center bg-background">
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
      <div className="admin-theme min-h-screen flex items-center justify-center bg-background">
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
    <div className="admin-theme">
      <SidebarProvider>
        <div className="min-h-screen flex w-full bg-background">
          <AdminSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <header className="h-16 flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-xl px-6 sticky top-0 z-50">
              <div className="flex items-center gap-4">
                <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
                <div className="relative hidden md:block">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                  <Input
                    placeholder="Buscar..."
                    className="pl-9 h-9 w-64 bg-secondary/50 border-border/50 text-sm focus-visible:ring-1 focus-visible:ring-primary/50 placeholder:text-muted-foreground/40"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground hover:bg-secondary/60">
                  <Bell className="h-4.5 w-4.5" />
                  <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[hsl(265_80%_60%)] shadow-sm shadow-[hsl(265_80%_60%/0.5)]" />
                </Button>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-secondary/60" onClick={signOut} title="Sair">
                  <LogOut className="h-4 w-4" />
                </Button>
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[hsl(265_80%_60%)] to-[hsl(300_70%_55%)] flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-[hsl(265_80%_60%/0.25)]">
                  {user.email?.charAt(0).toUpperCase() || "A"}
                </div>
              </div>
            </header>
            <main className="flex-1 p-8 overflow-auto">
              <Outlet />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </div>
  );
}
