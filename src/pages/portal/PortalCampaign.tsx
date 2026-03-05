import { useParams, useNavigate } from "react-router-dom";
import { useCampaign } from "@/hooks/useCampaigns";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, Mic2, Radio, Clock, FileText, Loader2 } from "lucide-react";
import { useState } from "react";

export default function PortalCampaign() {
  const { id } = useParams<{ id: string }>();
  const { data: campaign, isLoading } = useCampaign(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const handleCreateRoom = async () => {
    if (!user || !campaign) return;
    setCreating(true);
    try {
      const userName = user.user_metadata?.full_name || user.email || "Usuário";
      const { data: room, error } = await supabase
        .from("rooms")
        .insert({
          creator_name: userName,
          room_name: `${campaign.name} - ${userName}`,
          status: "waiting",
        })
        .select()
        .single();

      if (error) throw error;

      // Store creator identity
      sessionStorage.setItem(`room_creator_${room.id}`, "true");

      navigate(`/portal/room/${room.id}?campaign=${campaign.id}`);
    } catch (err: any) {
      toast.error("Erro ao criar sala: " + err.message);
    } finally {
      setCreating(false);
    }
  };

  if (isLoading) {
    return <Skeleton className="h-64 rounded-lg" />;
  }

  if (!campaign) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Campanha não encontrada.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/portal")}>
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Button variant="ghost" size="sm" onClick={() => navigate("/portal")} className="flex items-center gap-2">
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </Button>

      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">{campaign.name}</CardTitle>
              {campaign.client && (
                <Badge variant="secondary" className="mt-2">{campaign.client.name}</Badge>
              )}
            </div>
          </div>
          {campaign.description && (
            <CardDescription className="mt-2 text-base">{campaign.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Audio requirements */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Requisitos de Áudio</h3>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{campaign.audio_sample_rate || 48000}Hz</Badge>
              <Badge variant="outline">{campaign.audio_bit_depth || 16}bit</Badge>
              <Badge variant="outline">{campaign.audio_channels || 1}ch</Badge>
              <Badge variant="outline">{campaign.audio_format || "WAV"}</Badge>
              {campaign.audio_min_snr_db && (
                <Badge variant="outline">SNR ≥ {campaign.audio_min_snr_db}dB</Badge>
              )}
            </div>
          </div>

          {/* Duration limits */}
          {(campaign.audio_min_duration_seconds || campaign.audio_max_duration_seconds) && (
            <div className="flex gap-4 text-sm text-muted-foreground">
              {campaign.audio_min_duration_seconds && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Mín: {campaign.audio_min_duration_seconds}s
                </span>
              )}
              {campaign.audio_max_duration_seconds && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Máx: {campaign.audio_max_duration_seconds}s
                </span>
              )}
            </div>
          )}

          {/* Sections */}
          {campaign.sections && campaign.sections.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Seções da Campanha</h3>
              <div className="space-y-2">
                {campaign.sections.map(section => (
                  <Card key={section.id} className="bg-secondary/50">
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{section.name}</p>
                          {section.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>
                          )}
                        </div>
                        {section.target_hours && (
                          <Badge variant="outline" className="text-xs">{section.target_hours}h</Badge>
                        )}
                      </div>
                      {section.prompt_text && (
                        <div className="mt-2 p-2 rounded bg-muted/50 text-xs text-muted-foreground flex items-start gap-1.5">
                          <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>{section.prompt_text}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-border/50">
            <Button onClick={handleCreateRoom} disabled={creating} className="flex-1">
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radio className="mr-2 h-4 w-4" />}
              Criar Sala de Gravação
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
