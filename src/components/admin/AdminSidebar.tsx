import {
  LayoutDashboard,
  Radio,
  FolderOpen,
  FileCheck,
  ListChecks,
  FileText,
  Palette,
  Monitor,
  Mic2,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const mainItems = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Gravações", url: "/admin/recordings", icon: Mic2 },
  { title: "Campanhas", url: "/admin/campaigns", icon: FolderOpen },
  { title: "Salas de Áudio", url: "/admin/rooms", icon: Radio },
  { title: "Monitor de Salas", url: "/admin/rooms-monitor", icon: Monitor },
];

const reviewItems = [
  { title: "Revisão", url: "/admin/review", icon: FileCheck },
  { title: "Fila de Revisão", url: "/admin/review-queue", icon: ListChecks },
  { title: "Transcrição", url: "/admin/transcription", icon: FileText },
];

const toolItems = [
  { title: "Social Art", url: "/admin/social-art", icon: Palette },
];

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const isActive = (url: string) =>
    url === "/admin" ? location.pathname === "/admin" : location.pathname.startsWith(url);

  const renderItems = (items: typeof mainItems) =>
    items.map((item) => {
      const active = isActive(item.url);
      return (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton asChild>
            <NavLink
              to={item.url}
              end={item.url === "/admin"}
              className={`group/item flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                active
                  ? "bg-gradient-to-r from-[hsl(265_80%_60%/0.2)] to-[hsl(300_70%_55%/0.08)] text-[hsl(265_80%_75%)] shadow-sm shadow-[hsl(265_80%_60%/0.15)]"
                  : "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent"
              }`}
              activeClassName=""
            >
              <div className={`p-1 rounded-lg transition-colors ${
                active ? "bg-[hsl(265_80%_60%/0.2)]" : "bg-transparent group-hover/item:bg-sidebar-accent"
              }`}>
                <item.icon className={`h-4 w-4 transition-colors ${active ? "text-[hsl(265_80%_75%)]" : "opacity-60"}`} />
              </div>
              {!collapsed && <span className="flex-1">{item.title}</span>}
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarContent className="py-6 bg-sidebar-background">
        {!collapsed && (
          <div className="px-6 pb-6 mb-2">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-[hsl(265_80%_60%)] to-[hsl(300_70%_55%)] flex items-center justify-center shadow-lg shadow-[hsl(265_80%_60%/0.3)]">
                <span className="text-sm font-black text-white tracking-tighter">K</span>
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-sidebar-accent-foreground tracking-tight">KGen Admin</h2>
                <p className="text-[11px] text-sidebar-foreground/40 font-medium">Painel de Controle</p>
              </div>
            </div>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.15em] text-sidebar-foreground/30 font-semibold px-6 mb-1">
            Principal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-3 space-y-0.5">{renderItems(mainItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-6">
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.15em] text-sidebar-foreground/30 font-semibold px-6 mb-1">
            Revisão
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-3 space-y-0.5">{renderItems(reviewItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-6">
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.15em] text-sidebar-foreground/30 font-semibold px-6 mb-1">
            Ferramentas
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-3 space-y-0.5">{renderItems(toolItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
