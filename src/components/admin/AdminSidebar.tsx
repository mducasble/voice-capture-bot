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
  Bell,
  PenSquare,
  HelpCircle,
  Users,
  Wrench,
  Megaphone,
  Network,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const navSections = [
  {
    label: "Geral",
    items: [
      { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
      { title: "Usuários", url: "/admin/users", icon: Users },
      { title: "Gravações", url: "/admin/recordings", icon: Mic2 },
      { title: "Campanhas", url: "/admin/campaigns", icon: FolderOpen },
    ],
  },
  {
    label: "Salas",
    items: [
      { title: "Salas de Áudio", url: "/admin/rooms", icon: Radio },
      { title: "Monitor de Salas", url: "/admin/rooms-monitor", icon: Monitor },
    ],
  },
  {
    label: "Qualidade",
    items: [
      { title: "Revisão", url: "/admin/review", icon: FileCheck },
      { title: "Fila de Revisão", url: "/admin/review-queue", icon: ListChecks },
      { title: "Transcrição", url: "/admin/transcription", icon: FileText },
    ],
  },
  {
    label: "Ferramentas",
    items: [
      { title: "Social Art", url: "/admin/social-art", icon: Palette },
      { title: "FAQ / Dúvidas", url: "/admin/faq", icon: HelpCircle },
      { title: "Fila de Análise", url: "/admin/analysis-queue", icon: Activity },
      { title: "Manutenção", url: "/admin/maintenance", icon: Wrench },
      { title: "Anúncios", url: "/admin/announcements", icon: Megaphone },
      { title: "Rede de Indicações", url: "/admin/referral-network", icon: Network },
    ],
  },
];

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user } = useAdminAuth();

  const isActive = (url: string) =>
    url === "/admin" ? location.pathname === "/admin" : location.pathname.startsWith(url);

  return (
    <Sidebar collapsible="icon" className="border-0">
      <SidebarContent className="py-5 bg-[hsl(240_6%_10%)] rounded-[2.5rem] border border-[hsl(0_0%_100%/0.05)] flex flex-col gap-2 m-2 mr-0">
        {/* Top: Avatar + utility icons */}
        {!collapsed && (
          <div className="px-5 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="admin-icon-box h-11 w-11 bg-gradient-to-br from-[hsl(265_75%_58%)] to-[hsl(300_60%_50%)] text-white text-sm font-bold">
                {user?.email?.charAt(0).toUpperCase() || "A"}
              </div>
              <button className="admin-icon-box h-11 w-11 admin-icon-box-muted">
                <Bell className="h-5 w-5" />
              </button>
            </div>
            <button className="admin-icon-box h-11 w-11 bg-primary text-primary-foreground">
              <PenSquare className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Search */}
        {!collapsed && (
          <div className="px-5 pb-2">
            <div className="admin-search-box">
              <Search className="h-[18px] w-[18px] text-[hsl(0_0%_50%)] shrink-0" />
              <input
                placeholder="Buscar"
                className="bg-transparent border-0 outline-none text-[15px] text-[hsl(0_0%_90%)] placeholder:text-[hsl(0_0%_40%)] flex-1"
              />
            </div>
          </div>
        )}

        {/* Navigation sections */}
        {navSections.map((section) => (
          <SidebarGroup key={section.label}>
            {!collapsed && (
              <SidebarGroupLabel className="px-5 text-[11px] font-semibold uppercase tracking-widest text-[hsl(0_0%_40%)] mb-1">
                {section.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="px-3 space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.url);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <NavLink
                        to={item.url}
                        end={item.url === "/admin"}
                        className={cn(
                          "group/item flex items-center transition-colors",
                          collapsed ? "justify-center py-0.5" : "gap-3 px-3 py-0.5",
                          active
                            ? "text-foreground font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                        activeClassName=""
                      >
                        <div className={cn(
                          "admin-icon-box h-11 w-11 min-h-11 min-w-11 max-h-11 max-w-11 shrink-0",
                          active ? "bg-primary text-primary-foreground" : "admin-icon-box-muted"
                        )}>
                          <item.icon className="h-5 w-5" />
                        </div>
                        {!collapsed && <span className="flex-1 truncate">{item.title}</span>}
                      </NavLink>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {/* More */}
        {!collapsed && (
          <div className="mt-auto px-5 pb-3">
            <button className="flex items-center gap-4 text-[hsl(0_0%_72%)] text-[17px] hover:text-[hsl(0_0%_96%)] transition-colors px-3 py-3">
              <div className="admin-icon-box h-11 w-11 admin-icon-box-muted">
                <MoreHorizontal className="h-5 w-5" />
              </div>
              <span>Mais</span>
            </button>
          </div>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
