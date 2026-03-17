import {
  Home, Headphones, Video, Image, FileText, FolderOpen,
  Search, Clock, Settings,
} from "lucide-react";
import kgenLogo from "@/assets/kgen-logo-green.png";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";

const navSections = [
  {
    label: "Principal",
    items: [
      { title: "Início", url: "/audit", icon: Home, end: true },
    ],
  },
  {
    label: "Módulos",
    items: [
      { title: "Áudio", url: "/audit/audio", icon: Headphones },
      { title: "Vídeo", url: "/audit/video", icon: Video },
      { title: "Foto", url: "/audit/photo", icon: Image },
      { title: "Transcrição", url: "/audit/transcription", icon: FileText },
    ],
  },
  {
    label: "Navegação",
    items: [
      { title: "Campanhas", url: "/audit/campaigns", icon: FolderOpen },
      { title: "Busca", url: "/audit/search", icon: Search },
      { title: "Histórico", url: "/audit/history", icon: Clock },
    ],
  },
  {
    label: "Sistema",
    items: [
      { title: "Configurações", url: "/audit/settings", icon: Settings },
    ],
  },
];

export function AuditSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const isActive = (url: string, end?: boolean) =>
    end ? location.pathname === url : location.pathname.startsWith(url);

  return (
    <Sidebar collapsible="icon" className="border-r border-[hsl(var(--border))]">
      <SidebarContent className="bg-white py-5">
        {/* Logo */}
        {!collapsed && (
          <div className="px-5 pb-4 mb-2 border-b border-[hsl(var(--border))]">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[hsl(var(--primary))] flex items-center justify-center">
                <Headphones className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-[15px] font-bold text-[hsl(var(--foreground))]">Auditoria</p>
                <p className="text-[12px] text-[hsl(var(--muted-foreground))]">Data Labelling</p>
              </div>
            </div>
          </div>
        )}

        {navSections.map((section) => (
          <SidebarGroup key={section.label}>
            {!collapsed && (
              <SidebarGroupLabel className="px-5 text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] mb-1">
                {section.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="px-3 space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.url, (item as any).end);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <NavLink
                        to={item.url}
                        end={(item as any).end}
                        className={cn(
                          "flex items-center rounded-xl transition-colors",
                          collapsed ? "justify-center py-2" : "gap-3 px-4 py-3",
                          active
                            ? "bg-[hsl(var(--primary))] text-white font-semibold shadow-sm"
                            : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                        )}
                        activeClassName=""
                      >
                        <item.icon className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-5 w-5")} />
                        {!collapsed && <span className="text-[15px]">{item.title}</span>}
                      </NavLink>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
