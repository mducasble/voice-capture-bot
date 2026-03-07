import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, ArrowLeft, Building2, Calendar, Target, Mic2, MapPin, Globe, DollarSign, Layers, Copy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCampaigns } from "@/hooks/useCampaigns";
import { CampaignDialog } from "@/components/campaigns/CampaignDialog";
import { CampaignWaitlistDialog } from "@/components/campaigns/CampaignWaitlistDialog";
import { TASK_TYPE_LABELS } from "@/lib/campaignTypes";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Rascunho", variant: "outline" },
  waiting_list: { label: "Waiting List", variant: "secondary" },
  active: { label: "Ativa", variant: "default" },
  paused: { label: "Pausada", variant: "secondary" },
  completed: { label: "Concluída", variant: "secondary" },
};

export default function Campaigns() {
  const { data: campaigns, isLoading, error } = useCampaigns();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<string | null>(null);
  const [duplicatingCampaign, setDuplicatingCampaign] = useState<string | null>(null);
  const [waitlistCampaign, setWaitlistCampaign] = useState<{ id: string; name: string } | null>(null);

  const handleEdit = (campaignId: string) => {
    setEditingCampaign(campaignId);
    setDuplicatingCampaign(null);
    setDialogOpen(true);
  };

  const handleDuplicate = (e: React.MouseEvent, campaignId: string) => {
    e.stopPropagation();
    setEditingCampaign(null);
    setDuplicatingCampaign(campaignId);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingCampaign(null);
    setDuplicatingCampaign(null);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Campanhas</h1>
          <p className="text-muted-foreground text-sm mt-1.5">Gerencie campanhas de coleta de dados</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="bg-gradient-to-r from-[hsl(265_80%_60%)] to-[hsl(300_70%_55%)] border-0 shadow-lg shadow-[hsl(265_80%_60%/0.25)] hover:shadow-xl hover:shadow-[hsl(265_80%_60%/0.35)] transition-all">
          <Plus className="h-4 w-4 mr-2" /> Nova Campanha
        </Button>
      </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => (
              <Card key={i} className="animate-pulse">
                <CardHeader><div className="h-6 bg-muted rounded w-3/4" /><div className="h-4 bg-muted rounded w-1/2 mt-2" /></CardHeader>
                <CardContent><div className="h-4 bg-muted rounded w-full mb-2" /><div className="h-4 bg-muted rounded w-2/3" /></CardContent>
              </Card>
            ))}
          </div>
        ) : error ? (
          <Card className="border-destructive">
            <CardContent className="pt-6"><p className="text-destructive">Erro ao carregar campanhas</p></CardContent>
          </Card>
        ) : campaigns?.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="pt-6 text-center">
              <Mic2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Nenhuma campanha</h3>
              <p className="text-muted-foreground mb-4">Crie sua primeira campanha para começar.</p>
              <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 mr-2" /> Criar Campanha</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {campaigns?.map(campaign => {
              const status = STATUS_MAP[campaign.campaign_status || "draft"] || STATUS_MAP.draft;
              const enabledTaskSets = campaign.task_sets?.filter(ts => ts.enabled) || [];
              return (
                <Card key={campaign.id} className="cursor-pointer border-border/50 bg-card/70 backdrop-blur-sm hover:bg-card/90 hover:shadow-xl hover:shadow-[hsl(265_80%_60%/0.05)] transition-all duration-300" onClick={() => handleEdit(campaign.id)}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{campaign.name}</CardTitle>
                        {campaign.client && (
                          <CardDescription className="flex items-center gap-1 mt-1">
                            <Building2 className="h-3 w-3" /> {campaign.client.name}
                          </CardDescription>
                        )}
                      </div>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {campaign.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{campaign.description}</p>
                    )}

                    {(campaign.start_date || campaign.end_date) && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {campaign.start_date && format(new Date(campaign.start_date), "dd MMM", { locale: ptBR })}
                        {campaign.start_date && campaign.end_date && " - "}
                        {campaign.end_date && format(new Date(campaign.end_date), "dd MMM yyyy", { locale: ptBR })}
                      </div>
                    )}

                    {campaign.target_hours && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Target className="h-3 w-3" /> Meta: {campaign.target_hours}h
                      </div>
                    )}

                    {campaign.geographic_scope && (campaign.geographic_scope.countries?.length > 0 || campaign.geographic_scope.states?.length > 0) && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {campaign.geographic_scope.countries?.join(", ")}
                        {campaign.geographic_scope.states?.length > 0 && ` (${campaign.geographic_scope.states.slice(0, 3).join(", ")}${campaign.geographic_scope.states.length > 3 ? "..." : ""})`}
                      </div>
                    )}

                    {campaign.language_variants && campaign.language_variants.length > 0 && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Globe className="h-3 w-3" />
                        <div className="flex flex-wrap gap-1">
                          {campaign.language_variants.slice(0, 2).map(v => (
                            <Badge key={v.variant_id} variant="outline" className="text-xs">{v.label}</Badge>
                          ))}
                          {campaign.language_variants.length > 2 && <Badge variant="outline" className="text-xs">+{campaign.language_variants.length - 2}</Badge>}
                        </div>
                      </div>
                    )}

                    {campaign.reward_config && campaign.reward_config.base_rate && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <DollarSign className="h-3 w-3" />
                        {campaign.reward_config.currency} {campaign.reward_config.base_rate}/{campaign.reward_config.payout_model?.replace("per_accepted_", "")}
                        {campaign.reward_config.bonus_rate ? ` + ${campaign.reward_config.bonus_rate} bônus` : ""}
                      </div>
                    )}

                    {/* Task sets summary + duplicate */}
                    <div className="text-xs text-muted-foreground border-t pt-2 mt-2 flex items-center justify-between">
                      <div className="flex flex-wrap gap-2">
                        <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> {enabledTaskSets.length} tarefa(s)</span>
                        {enabledTaskSets.slice(0, 2).map(ts => (
                          <Badge key={ts.task_set_id} variant="outline" className="text-[10px]">
                            {TASK_TYPE_LABELS[ts.task_type] || ts.task_type}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Waiting list" onClick={(e) => { e.stopPropagation(); setWaitlistCampaign({ id: campaign.id, name: campaign.name }); }}>
                          <Users className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicar campanha" onClick={(e) => handleDuplicate(e, campaign.id)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <CampaignDialog open={dialogOpen} onClose={handleCloseDialog} campaignId={editingCampaign} duplicateFromId={duplicatingCampaign} />

        {waitlistCampaign && (
          <CampaignWaitlistDialog
            open={!!waitlistCampaign}
            onClose={() => setWaitlistCampaign(null)}
            campaignId={waitlistCampaign.id}
            campaignName={waitlistCampaign.name}
          />
        )}
      </div>
    </div>
  );
}
