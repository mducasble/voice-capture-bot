import { useCampaigns } from "@/hooks/useCampaigns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { Calendar, Clock, Mic2, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function PortalDashboard() {
  const { data: campaigns, isLoading } = useCampaigns();

  const activeCampaigns = campaigns?.filter(c => c.is_active) || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Campanhas Disponíveis</h1>
        <p className="text-muted-foreground mt-1">Selecione uma campanha para começar a gravar</p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && activeCampaigns.length === 0 && (
        <Card className="glass-card text-center py-12">
          <CardContent>
            <Mic2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium">Nenhuma campanha disponível</h3>
            <p className="text-muted-foreground mt-1">Aguarde novas campanhas serem publicadas.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeCampaigns.map(campaign => (
          <Card key={campaign.id} className="glass-card hover:border-primary/50 transition-colors group">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <CardTitle className="text-lg">{campaign.name}</CardTitle>
                {campaign.client && (
                  <Badge variant="secondary" className="text-xs">{campaign.client.name}</Badge>
                )}
              </div>
              {campaign.description && (
                <CardDescription className="line-clamp-2">{campaign.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {campaign.start_date && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(campaign.start_date), "dd MMM yyyy", { locale: ptBR })}
                  </span>
                )}
                {campaign.target_hours && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {campaign.target_hours}h meta
                  </span>
                )}
              </div>

              {campaign.languages && campaign.languages.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {campaign.languages.map(lang => (
                    <Badge key={lang.id} variant="outline" className="text-xs">
                      {lang.emoji} {lang.name}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-xs">
                  {campaign.audio_sample_rate || 48000}Hz
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {campaign.audio_bit_depth || 16}bit
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {campaign.audio_format || "WAV"}
                </Badge>
              </div>

              <Button asChild className="w-full group-hover:bg-primary" size="sm">
                <Link to={`/portal/campaign/${campaign.id}`} className="flex items-center gap-2">
                  Iniciar Gravação
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
