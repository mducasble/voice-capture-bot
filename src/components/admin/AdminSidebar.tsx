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
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Gravações", url: "/admin/recordings", icon: Mic2 },
  { title: "Campanhas", url: "/admin/campaigns", icon: FolderOpen },
  { title: "Salas de Áudio", url: "/admin/rooms", icon: Radio },
  { title: "Monitor de Salas", url: "/admin/rooms-monitor", icon: Monitor },
  { title: "Revisão", url: "/admin/review", icon: FileCheck },
  { title: "Fila de Revisão", url: "/admin/review-queue", icon: ListChecks },
  { title: "Transcrição", url: "/admin/transcription", icon: FileText },
  { title: "Social Art", url: "/admin/social-art", icon: Palette },
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
      <SidebarContent className="py-5 bg-transparent flex flex-col gap-2">
        {/* Top: Avatar + utility icons */}
        {!collapsed && (
          <div className="px-4 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Avatar */}
              <div className="admin-icon-box h-10 w-10 bg-gradient-to-br from-[hsl(265_75%_58%)] to-[hsl(300_60%_50%)] text-white text-sm font-bold">
                {user?.email?.charAt(0).toUpperCase() || "A"}
              </div>
              {/* Notification */}
              <button className="admin-icon-box h-10 w-10 admin-icon-box-muted">
                <Bell className="h-5 w-5" />
              </button>
            </div>
            {/* Compose */}
            <button className="admin-icon-box h-10 w-10 bg-primary text-primary-foreground">
              <PenSquare className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Search */}
        {!collapsed && (
          <div className="px-4 pb-2">
            <div className="admin-search-box">
              <Search className="h-[18px] w-[18px] text-muted-foreground shrink-0" />
              <input
                placeholder="Search"
                className="bg-transparent border-0 outline-none text-sm text-foreground placeholder:text-muted-foreground flex-1"
              />
            </div>
          </div>
        )}

        {/* Navigation items */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="px-3 space-y-1.5">
              {navItems.map((item) => {
                const active = isActive(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end={item.url === "/admin"}
                       className={`group/item flex items-center gap-3.5 px-2 py-2.5 rounded-2xl text-[17px] transition-all duration-150 ${
                          active
                            ? "text-[hsl(0_0%_95%)] font-semibold"
                            : "text-[hsl(0_0%_75%)] hover:text-[hsl(0_0%_95%)]"
                        }`}
                        activeClassName=""
                      >
                        {/* Icon in a rounded box */}
                        <div className={`admin-icon-box h-10 w-10 shrink-0 ${
                          active ? "admin-icon-box-active" : "admin-icon-box-muted"
                        }`}>
                          <item.icon className="h-[18px] w-[18px]" />
                        </div>
                        {!collapsed && <span className="flex-1 truncate">{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* More */}
        {!collapsed && (
          <div className="mt-auto px-4 pb-2">
            <button className="flex items-center gap-3.5 text-[hsl(0_0%_75%)] text-[17px] hover:text-[hsl(0_0%_95%)] transition-colors px-2 py-1.5">
              <div className="admin-icon-box h-10 w-10 admin-icon-box-muted">
                <MoreHorizontal className="h-[18px] w-[18px]" />
              </div>
              <span>More</span>
            </button>
          </div>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
