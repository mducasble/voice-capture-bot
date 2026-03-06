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
  ChevronRight,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
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

  const renderItems = (items: typeof mainItems) =>
    items.map((item) => (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild>
          <NavLink
            to={item.url}
            end={item.url === "/admin"}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent"
            activeClassName="!bg-gradient-to-r !from-primary/20 !to-primary/5 !text-sidebar-primary !border-l-2 !border-sidebar-primary"
          >
            <item.icon className="h-4 w-4 shrink-0 opacity-70" />
            {!collapsed && (
              <>
                <span className="flex-1">{item.title}</span>
                <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity" />
              </>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarContent className="py-6">
        {!collapsed && (
          <div className="px-6 pb-6 mb-2">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sidebar-primary to-[hsl(280_72%_60%)] flex items-center justify-center shadow-lg shadow-primary/20">
                <span className="text-sm font-black text-primary-foreground tracking-tighter">K</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-sidebar-accent-foreground tracking-tight">KGen Admin</h2>
                <p className="text-[11px] text-sidebar-foreground/50 font-medium">Painel de Controle</p>
              </div>
            </div>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.15em] text-sidebar-foreground/40 font-semibold px-6 mb-1">
            Principal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-3 space-y-0.5">{renderItems(mainItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-6">
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.15em] text-sidebar-foreground/40 font-semibold px-6 mb-1">
            Revisão
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-3 space-y-0.5">{renderItems(reviewItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-6">
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.15em] text-sidebar-foreground/40 font-semibold px-6 mb-1">
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
