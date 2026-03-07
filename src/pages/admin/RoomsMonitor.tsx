import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Radio, Users, Clock, RefreshCw, Mic, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Participant {
  id: string;
  name: string;
  is_creator: boolean;
  is_connected: boolean;
  joined_at: string;
  left_at: string | null;
  audio_test_status: string;
  user_id: string | null;
}

interface RoomWithParticipants {
  id: string;
  room_name: string | null;
  creator_name: string;
  status: string;
  is_recording: boolean;
  created_at: string;
  session_id: string | null;
  topic: string | null;
  duration_minutes: number | null;
  participants: Participant[];
}

const statusConfig: Record<string, { label: string; color: string }> = {
  waiting: { label: "Aguardando", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  active: { label: "Aberta", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  live: { label: "Ao Vivo", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  completed: { label: "Finalizada", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  lost: { label: "Perdida", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  expired: { label: "Expirada", color: "bg-muted text-muted-foreground border-border" },
};

type FilterKey = "all" | "open" | "closed";

const filterTabs: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "open", label: "Abertas" },
  { key: "closed", label: "Encerradas" },
];

const RoomsMonitor = () => {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomWithParticipants[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const { data: roomsData, error: roomsError } = await supabase
        .from("rooms")
        .select("*")
        .order("created_at", { ascending: false });

      if (roomsError) throw roomsError;

      const { data: participantsData, error: partError } = await supabase
        .from("room_participants")
        .select("*");

      if (partError) throw partError;

      const participantsByRoom = (participantsData || []).reduce<Record<string, Participant[]>>((acc, p) => {
        if (!acc[p.room_id]) acc[p.room_id] = [];
        acc[p.room_id].push(p as Participant);
        return acc;
      }, {});

      const combined: RoomWithParticipants[] = (roomsData || []).map((r) => ({
        ...r,
        participants: participantsByRoom[r.id] || [],
      }));

      setRooms(combined);
    } catch (err) {
      console.error("Error fetching rooms:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
  }, []);

  const openStatuses = ["waiting", "active", "live"];
  const closedStatuses = ["completed", "lost", "expired"];

  const filtered = rooms.filter((r) => {
    if (filter === "open") return openStatuses.includes(r.status);
    if (filter === "closed") return closedStatuses.includes(r.status);
    return true;
  });

  const openCount = rooms.filter((r) => openStatuses.includes(r.status)).length;

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Monitor de Salas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {openCount} aberta{openCount !== 1 ? "s" : ""} · {rooms.length} total
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRooms} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 bg-secondary/30 border border-border/30 rounded-xl w-fit">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filter === tab.key
                ? "bg-primary/20 text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.key === "open" && openCount > 0 && (
              <span className="ml-1.5 text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                {openCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((room) => (
          <RoomCard key={room.id} room={room} />
        ))}

        {filtered.length === 0 && !loading && (
          <div className="text-center py-20 text-muted-foreground">
            <Radio className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg">Nenhuma sala encontrada</p>
          </div>
        )}
      </div>
    </div>
  );
};

function RoomCard({ room }: { room: RoomWithParticipants }) {
  const navigate = useNavigate();
  const cfg = statusConfig[room.status] || statusConfig.waiting;
  const connectedCount = room.participants.filter((p) => p.is_connected && !p.left_at).length;
  const totalParticipants = room.participants.length;

  return (
    <div
      className="border border-border rounded-lg bg-card/60 hover:bg-card/80 transition-colors cursor-pointer"
      onClick={() => navigate(`/admin/room/${room.id}`)}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            {room.status === "live" && (
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
              </span>
            )}
            <span className="font-semibold text-foreground truncate">
              {room.room_name || `Sala de ${room.creator_name}`}
            </span>
          </div>
          <Badge variant="outline" className={`text-[10px] uppercase tracking-wider border ${cfg.color}`}>
            {cfg.label}
          </Badge>
          {room.status === "live" && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider border bg-red-500/20 text-red-400 border-red-500/30">
              <Mic className="h-3 w-3 mr-1" />
              REC
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {connectedCount}/{totalParticipants}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {formatDistanceToNow(new Date(room.created_at), { locale: ptBR, addSuffix: true })}
          </span>
        </div>
      </div>

      {/* Participants */}
      {room.participants.length > 0 && (
        <div className="px-4 py-2.5 flex flex-wrap gap-2">
          {room.participants.map((p) => {
            const isOnline = p.is_connected && !p.left_at;
            return (
              <div
                key={p.id}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                  isOnline
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-muted/50 text-muted-foreground border-border"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-muted-foreground/50"}`} />
                {p.name}
                {p.is_creator && (
                  <span className="text-[9px] uppercase tracking-wider opacity-70 ml-0.5">host</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {room.participants.length === 0 && (
        <div className="px-4 py-2.5 text-xs text-muted-foreground italic">Sem participantes</div>
      )}
    </div>
  );
}

export default RoomsMonitor;
