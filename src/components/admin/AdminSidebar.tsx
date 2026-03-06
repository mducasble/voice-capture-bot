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

  const renderItems = (items: typeof mainItems) =>
    items.map((item) => (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild>
          <NavLink
            to={item.url}
            end={item.url === "/admin"}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-accent"
            activeClassName="bg-primary/10 text-primary font-semibold"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{item.title}</span>}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarContent className="pt-4">
        {!collapsed && (
          <div className="px-6 pb-4 mb-2 border-b border-border">
            <h2 className="text-lg font-bold text-foreground tracking-tight">KGen</h2>
            <p className="text-xs text-muted-foreground">Painel Administrativo</p>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground/60 px-3">
            Principal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(mainItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground/60 px-3">
            Revisão
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(reviewItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground/60 px-3">
            Ferramentas
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(toolItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
