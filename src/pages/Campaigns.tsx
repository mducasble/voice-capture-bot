import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, ArrowLeft, Building2, Calendar, Target, Mic2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCampaigns } from "@/hooks/useCampaigns";
import { CampaignDialog } from "@/components/campaigns/CampaignDialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function Campaigns() {
  const { data: campaigns, isLoading, error } = useCampaigns();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<string | null>(null);

  const handleEdit = (campaignId: string) => {
    setEditingCampaign(campaignId);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingCampaign(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold">Campanhas</h1>
              <p className="text-muted-foreground">
                Gerencie campanhas de coleta de áudio
              </p>
            </div>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nova Campanha
          </Button>
        </div>

        {/* Campaign List */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-6 bg-muted rounded w-3/4"></div>
                  <div className="h-4 bg-muted rounded w-1/2 mt-2"></div>
                </CardHeader>
                <CardContent>
                  <div className="h-4 bg-muted rounded w-full mb-2"></div>
                  <div className="h-4 bg-muted rounded w-2/3"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : error ? (
          <Card className="border-destructive">
            <CardContent className="pt-6">
              <p className="text-destructive">Erro ao carregar campanhas</p>
            </CardContent>
          </Card>
        ) : campaigns?.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="pt-6 text-center">
              <Mic2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Nenhuma campanha</h3>
              <p className="text-muted-foreground mb-4">
                Crie sua primeira campanha para começar a coletar gravações.
              </p>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Criar Campanha
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {campaigns?.map((campaign) => (
              <Card
                key={campaign.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => handleEdit(campaign.id)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{campaign.name}</CardTitle>
                      {campaign.client && (
                        <CardDescription className="flex items-center gap-1 mt-1">
                          <Building2 className="h-3 w-3" />
                          {campaign.client.name}
                        </CardDescription>
                      )}
                    </div>
                    <Badge variant={campaign.is_active ? "default" : "secondary"}>
                      {campaign.is_active ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {campaign.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {campaign.description}
                    </p>
                  )}

                  {/* Date range */}
                  {(campaign.start_date || campaign.end_date) && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {campaign.start_date && format(new Date(campaign.start_date), "dd MMM", { locale: ptBR })}
                      {campaign.start_date && campaign.end_date && " - "}
                      {campaign.end_date && format(new Date(campaign.end_date), "dd MMM yyyy", { locale: ptBR })}
                    </div>
                  )}

                  {/* Target */}
                  {campaign.target_recordings && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Target className="h-3 w-3" />
                      Meta: {campaign.target_recordings.toLocaleString()} gravações
                    </div>
                  )}

                  {/* Languages */}
                  {campaign.languages && campaign.languages.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {campaign.languages.slice(0, 3).map((lang) => (
                        <Badge key={lang.id} variant="outline" className="text-xs">
                          {lang.emoji} {lang.code.toUpperCase()}
                        </Badge>
                      ))}
                      {campaign.languages.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{campaign.languages.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Regions */}
                  {campaign.regions && campaign.regions.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {campaign.regions.slice(0, 2).map((region) => (
                        <Badge key={region.id} variant="secondary" className="text-xs">
                          {region.code}
                        </Badge>
                      ))}
                      {campaign.regions.length > 2 && (
                        <Badge variant="secondary" className="text-xs">
                          +{campaign.regions.length - 2}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Sections count */}
                  {campaign.sections && campaign.sections.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {campaign.sections.length} seções de gravação
                    </div>
                  )}

                  {/* Audio specs summary */}
                  <div className="text-xs text-muted-foreground border-t pt-2 mt-2">
                    {campaign.audio_sample_rate && `${campaign.audio_sample_rate / 1000}kHz`}
                    {campaign.audio_bit_depth && ` • ${campaign.audio_bit_depth}bit`}
                    {campaign.audio_channels && ` • ${campaign.audio_channels === 1 ? "Mono" : "Stereo"}`}
                    {campaign.audio_format && ` • ${campaign.audio_format.toUpperCase()}`}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Campaign Dialog */}
        <CampaignDialog
          open={dialogOpen}
          onClose={handleCloseDialog}
          campaignId={editingCampaign}
        />
      </div>
    </div>
  );
}
