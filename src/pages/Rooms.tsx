import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, Plus, Mic2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignSelector } from "@/components/CampaignSelector";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const Rooms = () => {
  const navigate = useNavigate();
  const [creatorName, setCreatorName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [isCreating, setIsCreating] = useState(false);

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
      const { data: room, error } = await supabase
        .from("rooms")
        .insert({
          creator_name: creatorName.trim(),
          room_name: roomName.trim() || `Sala de ${creatorName.trim()}`,
          status: "waiting",
        })
        .select()
        .single();

      if (error) throw error;

      // Add creator as first participant
      const currentUser = (await supabase.auth.getUser()).data.user;
      const { data: participant } = await supabase.from("room_participants").insert({
        room_id: room.id,
        name: creatorName.trim(),
        is_creator: true,
        user_id: currentUser?.id || null,
      }).select().single();

      // Store creator participant ID so Room page recognises them
      if (participant) {
        localStorage.setItem(`room_${room.id}_participant`, participant.id);
      }

      toast.success("Sala criada com sucesso!");
      navigate(`/room/${room.id}?campaign=${selectedCampaignId}`);
    } catch (error) {
      console.error("Error creating room:", error);
      toast.error("Erro ao criar sala");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
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

      <main className="container py-12 max-w-lg">
        {/* Hero */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm mb-4">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
            </span>
            Gravação Contínua
          </div>
          <h2 className="text-3xl font-bold text-foreground mb-2">
            Crie uma Sala de Gravação
          </h2>
          <p className="text-muted-foreground">
            Capture áudio ambiente completo sem limitações de VAD
          </p>
        </div>

        {/* Create Room Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Nova Sala
            </CardTitle>
            <CardDescription>
              Crie uma sala e compartilhe o link com os participantes
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
            <Button 
              className="w-full" 
              onClick={handleCreateRoom}
              disabled={isCreating}
            >
              <Mic2 className="h-4 w-4 mr-2" />
              {isCreating ? "Criando..." : "Criar Sala"}
            </Button>
          </CardContent>
        </Card>

        {/* Features */}
        <div className="mt-8 grid grid-cols-3 gap-4 text-center text-sm text-muted-foreground">
          <div>
            <div className="text-2xl mb-1">🎤</div>
            <div>Áudio Contínuo</div>
          </div>
          <div>
            <div className="text-2xl mb-1">👥</div>
            <div>Multi-participantes</div>
          </div>
          <div>
            <div className="text-2xl mb-1">📝</div>
            <div>Transcrição Auto</div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Rooms;
