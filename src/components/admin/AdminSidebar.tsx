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
  Search,
  MoreHorizontal,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAdminAuth } from "@/hooks/useAdminAuth";
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
import { Input } from "@/components/ui/input";

const mainItems = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Gravações", url: "/admin/recordings", icon: Mic2 },
  { title: "Campanhas", url: "/admin/campaigns", icon: FolderOpen },
  { title: "Salas de Áudio", url: "/admin/rooms", icon: Radio },
  { title: "Monitor de Salas", url: "/admin/rooms-monitor", icon: Monitor },
];

const reviewItems = [
  { title: "Revisão", url: "/admin/review", icon: FileCheck, dot: "bg-[hsl(265_75%_58%)]" },
  { title: "Fila de Revisão", url: "/admin/review-queue", icon: ListChecks, dot: "bg-[hsl(45_100%_60%)]" },
  { title: "Transcrição", url: "/admin/transcription", icon: FileText, dot: "bg-[hsl(0_80%_55%)]" },
];

const toolItems = [
  { title: "Social Art", url: "/admin/social-art", icon: Palette, dot: "bg-[hsl(180_60%_50%)]" },
];

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user } = useAdminAuth();

  const isActive = (url: string) =>
    url === "/admin" ? location.pathname === "/admin" : location.pathname.startsWith(url);

  const renderItems = (items: typeof mainItems & { dot?: string }[]) =>
    items.map((item: any) => {
      const active = isActive(item.url);
      return (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton asChild>
            <NavLink
              to={item.url}
              end={item.url === "/admin"}
              className={`group/item flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/60"
              }`}
              activeClassName=""
            >
              {item.dot && !collapsed && (
                <span className={`h-2 w-2 rounded-full shrink-0 ${item.dot}`} />
              )}
              {!item.dot && (
                <item.icon className={`h-4 w-4 shrink-0 ${active ? "text-sidebar-accent-foreground" : "opacity-50"}`} />
              )}
              {!collapsed && <span className="flex-1 truncate">{item.title}</span>}
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarContent className="py-4 bg-sidebar-background flex flex-col">
        {/* User avatar + actions */}
        {!collapsed && (
          <div className="px-4 pb-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[hsl(265_75%_58%)] to-[hsl(300_60%_50%)] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {user?.email?.charAt(0).toUpperCase() || "A"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-sidebar-accent-foreground truncate">
                {user?.email?.split("@")[0] || "Admin"}
              </p>
              <p className="text-[11px] text-sidebar-foreground truncate">KGen Admin</p>
            </div>
            <button className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Search */}
        {!collapsed && (
          <div className="px-4 pb-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sidebar-foreground" />
              <Input
                placeholder="Buscar..."
                className="pl-8 h-8 text-xs bg-sidebar-accent border-sidebar-border text-sidebar-accent-foreground placeholder:text-sidebar-foreground rounded-lg"
              />
            </div>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="px-2 space-y-0.5">{renderItems(mainItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/50 font-semibold px-5 mb-1">
            Revisão
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-2 space-y-0.5">{renderItems(reviewItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/50 font-semibold px-5 mb-1">
            Ferramentas
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-2 space-y-0.5">{renderItems(toolItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* More link */}
        {!collapsed && (
          <div className="mt-auto px-4 pb-4">
            <button className="flex items-center gap-2 text-sidebar-foreground text-xs hover:text-sidebar-accent-foreground transition-colors">
              <MoreHorizontal className="h-4 w-4" />
              <span>More</span>
            </button>
          </div>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
