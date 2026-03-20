import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Radio, Plus, Mic2, Globe, Lock, Users, Clock,
  Loader2, LogIn, CheckCircle2, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { CampaignSelector } from "@/components/CampaignSelector";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  my_request_status?: string | null;
}

const Rooms = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [creatorName, setCreatorName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isPublic, setIsPublic] = useState(false);

  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [userCountry, setUserCountry] = useState<string | null>(null);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);

  // Fetch user country from profile
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("country, full_name")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        setUserCountry(data?.country || null);
        if (data?.full_name && !creatorName) setCreatorName(data.full_name);
      });
  }, [user]);

  // Fetch public rooms
  const fetchPublicRooms = async () => {
    setLoadingRooms(true);

    const { data: rooms, error } = await supabase
      .from("rooms")
      .select("id, room_name, creator_name, status, country, campaign_id, created_at, creator_user_id")
      .eq("is_public", true)
      .in("status", ["waiting", "active", "live"])
      .order("created_at", { ascending: false });

    if (error || !rooms) {
      setPublicRooms([]);
      setLoadingRooms(false);
      return;
    }

    // Filter by user country
    const filtered = userCountry
      ? rooms.filter((r: any) => !r.country || r.country === userCountry)
      : rooms;

    // Enrich with participant count and campaign name
    const campaignIds = [...new Set(filtered.map((r: any) => r.campaign_id).filter(Boolean))];
    let campaignMap: Record<string, string> = {};
    if (campaignIds.length > 0) {
      const { data: camps } = await supabase
        .from("campaigns")
        .select("id, name")
        .in("id", campaignIds);
      if (camps) {
        campaignMap = Object.fromEntries(camps.map((c: any) => [c.id, c.name]));
      }
    }

    // Get participant counts
    const roomIds = filtered.map((r: any) => r.id);
    let participantCounts: Record<string, number> = {};
    if (roomIds.length > 0) {
      const { data: parts } = await supabase
        .from("room_participants")
        .select("room_id")
        .in("room_id", roomIds)
        .eq("is_connected", true);
      if (parts) {
        for (const p of parts) {
          participantCounts[p.room_id] = (participantCounts[p.room_id] || 0) + 1;
        }
      }
    }

    // Get my join request statuses
    let myRequests: Record<string, string> = {};
    if (user && roomIds.length > 0) {
      const { data: reqs } = await supabase
        .from("room_join_requests")
        .select("room_id, status")
        .eq("user_id", user.id)
        .in("room_id", roomIds);
      if (reqs) {
        for (const r of reqs) {
          myRequests[r.room_id] = r.status;
        }
      }
    }

    setPublicRooms(
      filtered.map((r: any) => ({
        ...r,
        participant_count: participantCounts[r.id] || 0,
        campaign_name: r.campaign_id ? campaignMap[r.campaign_id] : null,
        my_request_status: myRequests[r.id] || null,
      }))
    );
    setLoadingRooms(false);
  };

  useEffect(() => {
    fetchPublicRooms();
  }, [user, userCountry]);

  // Realtime: listen for join request updates
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("room-join-requests-mine")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_join_requests", filter: `user_id=eq.${user.id}` },
        () => fetchPublicRooms()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, userCountry]);

  const handleCreateRoom = async () => {
    if (!creatorName.trim()) {
      toast.error("Digite seu nome para criar a sala");
      return;
    }
    if (!selectedCampaignId) {
      toast.error("Selecione uma campanha");
      return;
    }

    setIsCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-room`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            creator_name: creatorName.trim(),
            room_name: roomName.trim() || `Sala de ${creatorName.trim()}`,
            campaign_id: selectedCampaignId,
            is_public: isPublic,
            country: isPublic ? userCountry : null,
          }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const result = await res.json();
      const roomId = result.room?.id;
      const participantId = result.creator_participant?.id;
      if (!roomId) throw new Error("Room creation failed");

      if (participantId) localStorage.setItem(`room_${roomId}_participant`, participantId);

      const roomUrl = result.room_url || `/room/${roomId}?campaign=${selectedCampaignId}`;
      toast.success("Sala criada com sucesso!");
      navigate(roomUrl);
    } catch (error) {
      console.error("Error creating room:", error);
      toast.error("Erro ao criar sala");
    } finally {
      setIsCreating(false);
    }
  };

  const handleRequestJoin = async (room: PublicRoom) => {
    if (!user) {
      toast.error("Faça login para solicitar entrada");
      return;
    }
    setJoiningRoomId(room.id);
    const { error } = await supabase.from("room_join_requests").insert({
      room_id: room.id,
      user_id: user.id,
      user_name: creatorName || user.email || "Usuário",
    });
    setJoiningRoomId(null);
    if (error) {
      if (error.code === "23505") toast.info("Você já solicitou entrada nesta sala.");
      else toast.error("Erro ao solicitar entrada");
      return;
    }
    toast.success("Solicitação enviada! Aguarde a aprovação do host.");
    fetchPublicRooms();
  };

  const statusLabels: Record<string, string> = {
    waiting: "Aguardando",
    active: "Aberta",
    live: "Ao Vivo",
  };

  const statusColors: Record<string, string> = {
    waiting: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    live: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Radio className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Salas de Áudio</h1>
              <p className="text-sm text-muted-foreground">Gravação em grupo via WebRTC</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-4xl">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Left: Create Room */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  Nova Sala
                </CardTitle>
                <CardDescription>
                  Crie uma sala e compartilhe o link
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Seu Nome *</label>
                  <Input
                    placeholder="Digite seu nome"
                    value={creatorName}
                    onChange={(e) => setCreatorName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nome da Sala (opcional)</label>
                  <Input
                    placeholder="Ex: Reunião de Equipe"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Campanha *</label>
                  <CampaignSelector value={selectedCampaignId} onChange={setSelectedCampaignId} />
                </div>

                {/* Public toggle */}
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    {isPublic ? (
                      <Globe className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-medium">
                        {isPublic ? "Sala Pública" : "Sala Privada"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {isPublic
                          ? `Visível para usuários${userCountry ? ` (${userCountry})` : ""}`
                          : "Apenas por link de convite"}
                      </p>
                    </div>
                  </div>
                  <Switch checked={isPublic} onCheckedChange={setIsPublic} />
                </div>

                <Button
                  className="w-full"
                  onClick={handleCreateRoom}
                  disabled={isCreating || !selectedCampaignId}
                >
                  <Mic2 className="h-4 w-4 mr-2" />
                  {isCreating ? "Criando..." : "Criar Sala"}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right: Public rooms list */}
          <div className="lg:col-span-3">
            <div className="flex items-center gap-2 mb-4">
              <Globe className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Salas Públicas</h2>
              {userCountry && (
                <Badge variant="outline" className="text-xs">
                  {userCountry}
                </Badge>
              )}
            </div>

            {loadingRooms ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : publicRooms.length === 0 ? (
              <div className="text-center py-16 rounded-lg border border-dashed border-border">
                <Globe className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">
                  Nenhuma sala pública disponível no momento
                </p>
                <p className="text-muted-foreground/60 text-xs mt-1">
                  Crie uma sala pública para aparecer aqui
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {publicRooms.map((room) => {
                  const isMyRoom = user && room.creator_user_id === user.id;
                  const requestStatus = room.my_request_status;

                  return (
                    <Card key={room.id} className="overflow-hidden">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-semibold text-foreground truncate">
                                {room.room_name || `Sala de ${room.creator_name}`}
                              </p>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] font-bold shrink-0",
                                  statusColors[room.status] || ""
                                )}
                              >
                                {statusLabels[room.status] || room.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {room.participant_count} conectado(s)
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(room.created_at).toLocaleTimeString("pt-BR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              {room.campaign_name && (
                                <span className="truncate">{room.campaign_name}</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              Host: {room.creator_name}
                            </p>
                          </div>

                          <div className="shrink-0">
                            {isMyRoom ? (
                              <Button
                                size="sm"
                                onClick={() =>
                                  navigate(
                                    `/room/${room.id}${room.campaign_id ? `?campaign=${room.campaign_id}` : ""}`
                                  )
                                }
                              >
                                Entrar
                              </Button>
                            ) : (room.participant_count || 0) > 1 ? (
                              <Button size="sm" variant="outline" disabled>
                                <Lock className="h-3.5 w-3.5 mr-1" />
                                Lotada
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  navigate(
                                    `/room/${room.id}${room.campaign_id ? `?campaign=${room.campaign_id}` : ""}`
                                  )
                                }
                              >
                                <LogIn className="h-3.5 w-3.5 mr-1" />
                                Entrar
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Rooms;
