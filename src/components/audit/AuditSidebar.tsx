import {
  Home, Headphones, Video, Image, FileText, FolderOpen,
  Search, Clock, Settings, CheckSquare, ChevronDown,
} from "lucide-react";
import kgenLogo from "@/assets/kgen-logo-green.png";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";

interface NavItem {
  title: string;
  url: string;
  icon: any;
  end?: boolean;
  children?: { title: string; url: string; icon: any }[];
  disabled?: boolean;
  badge?: string;
}

const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: "Principal",
    items: [
      { title: "Início", url: "/audit", icon: Home, end: true },
    ],
  },
  {
    label: "Módulos",
    items: [
      {
        title: "Áudio",
        url: "/audit/audio",
        icon: Headphones,
        children: [
          { title: "Validação", url: "/audit/audio/validation", icon: CheckSquare },
          { title: "Transcrição", url: "/audit/audio/transcription", icon: FileText },
        ],
      },
      { title: "Vídeo", url: "/audit/video", icon: Video, disabled: true, badge: "Em breve" },
      { title: "Foto", url: "/audit/photo", icon: Image, disabled: true, badge: "Em breve" },
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
  const navigate = useNavigate();
  const [expandedSections, setExpandedSections] = useState<string[]>(["/audit/audio"]);

  const isActive = (url: string, end?: boolean) =>
    end ? location.pathname === url : location.pathname.startsWith(url);

  const isChildActive = (item: NavItem) =>
    item.children?.some((c) => location.pathname.startsWith(c.url));

  const toggleSection = (url: string) => {
    setExpandedSections((prev) =>
      prev.includes(url) ? prev.filter((s) => s !== url) : [...prev, url]
    );
  };

  const handleClick = (item: NavItem) => {
    if (item.disabled) return;
    if (item.children) {
      toggleSection(item.url);
      return;
    }
    navigate(item.url);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-[hsl(var(--border))]">
      <SidebarContent className="bg-white py-5">
        {/* Logo */}
        {!collapsed && (
          <div className="px-5 pb-4 mb-2 border-b border-[hsl(var(--border))]">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[hsl(var(--foreground))] flex items-center justify-center overflow-hidden">
                <img src={kgenLogo} alt="KGeN" className="h-7 w-7 object-contain" />
              </div>
              <div>
                <p className="text-[15px] font-bold text-[hsl(var(--foreground))]">KGeN Auditoria</p>
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
                  const active = item.children ? isChildActive(item) : isActive(item.url, item.end);
                  const expanded = expandedSections.includes(item.url) || isChildActive(item);

                  return (
                    <SidebarMenuItem key={item.title}>
                      <button
                        onClick={() => handleClick(item)}
                        disabled={item.disabled}
                        className={cn(
                          "w-full flex items-center rounded-xl transition-colors",
                          collapsed ? "justify-center py-2" : "gap-3 px-4 py-3",
                          item.disabled && "opacity-50 cursor-not-allowed",
                          active && !item.children
                            ? "bg-[hsl(var(--primary))] text-white font-semibold shadow-sm"
                            : active && item.children
                              ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] font-semibold"
                              : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                        )}
                      >
                        <item.icon className="h-5 w-5 shrink-0" />
                        {!collapsed && (
                          <>
                            <span className="text-[15px] flex-1 text-left">{item.title}</span>
                            {item.badge && (
                              <span className="text-[11px] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] px-2 py-0.5 rounded-md">
                                {item.badge}
                              </span>
                            )}
                            {item.children && (
                              <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
                            )}
                          </>
                        )}
                      </button>
                      {/* Children */}
                      {item.children && expanded && !collapsed && (
                        <div className="ml-6 mt-1 space-y-0.5 border-l-2 border-[hsl(var(--border))] pl-3">
                          {item.children.map((child) => {
                            const childActive = isActive(child.url);
                            return (
                              <button
                                key={child.title}
                                onClick={() => navigate(child.url)}
                                className={cn(
                                  "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors text-[14px]",
                                  childActive
                                    ? "bg-[hsl(var(--primary))] text-white font-semibold shadow-sm"
                                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                                )}
                              >
                                <child.icon className="h-4 w-4 shrink-0" />
                                <span>{child.title}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
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
