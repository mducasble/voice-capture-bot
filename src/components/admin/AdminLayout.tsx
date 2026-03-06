import { Outlet } from "react-router-dom";
import { AdminSidebar } from "./AdminSidebar";
import {
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Bell, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export default function AdminLayout() {
  const { user } = useAuth();

  return (
    <div className="admin-theme">
      <SidebarProvider>
        <div className="min-h-screen flex w-full bg-background">
          <AdminSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <header className="h-16 flex items-center justify-between border-b border-border bg-card px-6 sticky top-0 z-50">
              <div className="flex items-center gap-4">
                <SidebarTrigger />
                <div className="relative hidden md:block">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar..."
                    className="pl-9 h-9 w-64 bg-secondary border-0 text-sm focus-visible:ring-1"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
                  <Bell className="h-4.5 w-4.5" />
                  <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-destructive" />
                </Button>
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-[hsl(280_72%_60%)] flex items-center justify-center text-primary-foreground text-xs font-bold">
                  {user?.email?.charAt(0).toUpperCase() || "A"}
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
