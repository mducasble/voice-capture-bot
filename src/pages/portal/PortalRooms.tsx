import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Radio, Users, Clock, Loader2, LogIn, Lock, Layers,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";

interface PublicRoom {
  id: string;
  room_name: string | null;
  creator_name: string;
  status: string;
  country: string | null;
  campaign_id: string | null;
  created_at: string;
  creator_user_id: string | null;
  participant_count?: number;
  campaign_name?: string;
}

export default function PortalRooms() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();

  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [userCountry, setUserCountry] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("country, full_name")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        setUserCountry(data?.country || null);
      });
  }, [user]);

  const fetchPublicRooms = async () => {
    setLoading(true);

    const { data: rooms } = await supabase
      .from("rooms")
      .select("id, room_name, creator_name, status, country, campaign_id, created_at, creator_user_id")
      .eq("is_public", true)
      .in("status", ["waiting", "active", "live"])
      .order("created_at", { ascending: false });

    if (!rooms || rooms.length === 0) {
      setPublicRooms([]);
      setLoading(false);
      return;
    }

    const filtered = userCountry
      ? rooms.filter((r: any) => !r.country || r.country === userCountry)
      : rooms;

    const campaignIds = [...new Set(filtered.map((r: any) => r.campaign_id).filter(Boolean))];
    let campaignMap: Record<string, string> = {};
    if (campaignIds.length > 0) {
      const { data: camps } = await supabase.from("campaigns").select("id, name").in("id", campaignIds);
      if (camps) campaignMap = Object.fromEntries(camps.map((c: any) => [c.id, c.name]));
    }

    const roomIds = filtered.map((r: any) => r.id);
    let participantCounts: Record<string, number> = {};
    if (roomIds.length > 0) {
      const { data: parts } = await supabase.from("room_participants").select("room_id").in("room_id", roomIds).eq("is_connected", true);
      if (parts) for (const p of parts) participantCounts[p.room_id] = (participantCounts[p.room_id] || 0) + 1;
    }

    setPublicRooms(
      filtered.map((r: any) => ({
        ...r,
        participant_count: participantCounts[r.id] || 0,
        campaign_name: r.campaign_id ? campaignMap[r.campaign_id] : null,
      }))
    );
    setLoading(false);
  };

  useEffect(() => { fetchPublicRooms(); }, [user, userCountry]);

  const statusLabels: Record<string, string> = { waiting: "Aguardando", active: "Aberta", live: "Ao Vivo" };
  const statusDot: Record<string, string> = { waiting: "bg-amber-400", active: "bg-emerald-400", live: "bg-red-400" };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
        <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
          Salas Públicas
        </h1>
        {userCountry && (
          <span className="font-mono text-xs px-2 py-0.5" style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}>
            {userCountry}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--portal-accent)" }} />
        </div>
      ) : publicRooms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Radio className="h-12 w-12 mb-4" style={{ color: "var(--portal-text-muted)", opacity: 0.3 }} />
          <p className="font-mono text-sm mb-1" style={{ color: "var(--portal-text-muted)" }}>
            Sem salas criadas no momento
          </p>
          <p className="font-mono text-xs mb-6" style={{ color: "var(--portal-text-muted)", opacity: 0.6 }}>
            Crie uma sala a partir das suas campanhas
          </p>
          <Link
            to="/my-campaigns"
            className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest px-5 py-2.5 transition-colors"
            style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}
          >
            <Layers className="h-3.5 w-3.5" />
            Minhas Campanhas
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {publicRooms.map((room) => {
            const isMyRoom = user && room.creator_user_id === user.id;
            const isFull = !isMyRoom && (room.participant_count || 0) > 1;

            return (
              <div
                key={room.id}
                className="p-4 transition-colors"
                style={{ background: "var(--portal-card-bg)", border: "1px solid var(--portal-border)" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="font-mono text-sm font-bold truncate" style={{ color: "var(--portal-text)" }}>
                        {room.room_name || `Sala de ${room.creator_name}`}
                      </p>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className={`h-2 w-2 rounded-full ${statusDot[room.status] || "bg-gray-400"}`} />
                        <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                          {statusLabels[room.status] || room.status}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-4 font-mono text-[11px]" style={{ color: "var(--portal-text-muted)" }}>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {room.participant_count}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(room.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {room.campaign_name && <span className="truncate">{room.campaign_name}</span>}
                    </div>
                    <p className="font-mono text-[11px] mt-1" style={{ color: "var(--portal-text-muted)", opacity: 0.6 }}>
                      Host: {room.creator_name}
                    </p>
                  </div>

                  <div className="shrink-0">
                    {isMyRoom ? (
                      <button
                        onClick={() => navigate(`/room/${room.id}${room.campaign_id ? `?campaign=${room.campaign_id}` : ""}`)}
                        className="font-mono text-xs uppercase tracking-widest px-4 py-2 transition-colors"
                        style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}
                      >
                        Entrar
                      </button>
                    ) : isFull ? (
                      <span
                        className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest px-4 py-2"
                        style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)", opacity: 0.6 }}
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Lotada
                      </span>
                    ) : (
                      <button
                        onClick={() => navigate(`/room/${room.id}${room.campaign_id ? `?campaign=${room.campaign_id}` : ""}`)}
                        className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest px-4 py-2 transition-colors"
                        style={{ border: "1px solid var(--portal-accent)", color: "var(--portal-accent)", background: "transparent" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--portal-accent)"; e.currentTarget.style.color = "var(--portal-accent-text)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--portal-accent)"; }}
                      >
                        <LogIn className="h-3.5 w-3.5" />
                        Entrar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
