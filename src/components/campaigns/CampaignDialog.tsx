import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, GripVertical } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCampaign,
  useClients,
  useLanguages,
  useRegions,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
  useCreateClient,
  type CampaignSection,
} from "@/hooks/useCampaigns";
import { toast } from "@/hooks/use-toast";

interface CampaignDialogProps {
  open: boolean;
  onClose: () => void;
  campaignId: string | null;
}

interface SectionDraft {
  id?: string;
  name: string;
  description: string;
  prompt_text: string;
  target_hours: number;
}

export function CampaignDialog({ open, onClose, campaignId }: CampaignDialogProps) {
  const { data: campaign, isLoading: loadingCampaign } = useCampaign(campaignId ?? undefined);
  const { data: clients } = useClients();
  const { data: languages } = useLanguages();
  const { data: regions } = useRegions();

  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();
  const createClient = useCreateClient();

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [targetHours, setTargetHours] = useState<number>(0);
  const [isActive, setIsActive] = useState(true);

  // Audio specs
  const [sampleRate, setSampleRate] = useState(48000);
  const [bitDepth, setBitDepth] = useState(16);
  const [channels, setChannels] = useState(1);
  const [format, setFormat] = useState("wav");
  const [minDuration, setMinDuration] = useState<number | undefined>();
  const [maxDuration, setMaxDuration] = useState<number | undefined>();
  const [minSnr, setMinSnr] = useState<number | undefined>();

  // Relations
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [sections, setSections] = useState<SectionDraft[]>([]);

  // New client dialog
  const [newClientName, setNewClientName] = useState("");
  const [showNewClient, setShowNewClient] = useState(false);

  // Load campaign data
  useEffect(() => {
    if (campaign) {
      setName(campaign.name);
      setDescription(campaign.description || "");
      setClientId(campaign.client_id || "");
      setStartDate(campaign.start_date || "");
      setEndDate(campaign.end_date || "");
      setTargetHours(campaign.target_hours || 0);
      setIsActive(campaign.is_active ?? true);
      setSampleRate(campaign.audio_sample_rate || 48000);
      setBitDepth(campaign.audio_bit_depth || 16);
      setChannels(campaign.audio_channels || 1);
      setFormat(campaign.audio_format || "wav");
      setMinDuration(campaign.audio_min_duration_seconds ?? undefined);
      setMaxDuration(campaign.audio_max_duration_seconds ?? undefined);
      setMinSnr(campaign.audio_min_snr_db ?? undefined);
      setSelectedLanguages(campaign.languages?.map((l) => l.id) || []);
      setSelectedRegions(campaign.regions?.map((r) => r.id) || []);
      setSections(
        campaign.sections?.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description || "",
          prompt_text: s.prompt_text || "",
          target_hours: s.target_hours || 0,
        })) || []
      );
    } else if (!campaignId) {
      // Reset for new campaign
      setName("");
      setDescription("");
      setClientId("");
      setStartDate("");
      setEndDate("");
      setTargetHours(0);
      setIsActive(true);
      setSampleRate(48000);
      setBitDepth(16);
      setChannels(1);
      setFormat("wav");
      setMinDuration(undefined);
      setMaxDuration(undefined);
      setMinSnr(undefined);
      setSelectedLanguages([]);
      setSelectedRegions([]);
      setSections([]);
    }
  }, [campaign, campaignId]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "Nome obrigatório", variant: "destructive" });
      return;
    }

    try {
      const campaignData = {
        name,
        description: description || null,
        client_id: clientId || null,
        start_date: startDate || null,
        end_date: endDate || null,
        target_hours: targetHours || null,
        is_active: isActive,
        audio_sample_rate: sampleRate,
        audio_bit_depth: bitDepth,
        audio_channels: channels,
        audio_format: format,
        audio_min_duration_seconds: minDuration ?? null,
        audio_max_duration_seconds: maxDuration ?? null,
        audio_min_snr_db: minSnr ?? null,
      };

      if (campaignId) {
        await updateCampaign.mutateAsync({
          id: campaignId,
          campaign: campaignData,
          languageIds: selectedLanguages,
          regionIds: selectedRegions,
          sections,
        });
        toast({ title: "Campanha atualizada!" });
      } else {
        await createCampaign.mutateAsync({
          campaign: campaignData,
          languageIds: selectedLanguages,
          regionIds: selectedRegions,
          sections,
        });
        toast({ title: "Campanha criada!" });
      }
      onClose();
    } catch (error) {
      toast({ title: "Erro ao salvar campanha", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!campaignId) return;
    if (!confirm("Tem certeza que deseja excluir esta campanha?")) return;

    try {
      await deleteCampaign.mutateAsync(campaignId);
      toast({ title: "Campanha excluída!" });
      onClose();
    } catch (error) {
      toast({ title: "Erro ao excluir campanha", variant: "destructive" });
    }
  };

  const handleCreateClient = async () => {
    if (!newClientName.trim()) return;

    try {
      const newClient = await createClient.mutateAsync({ name: newClientName });
      setClientId(newClient.id);
      setNewClientName("");
      setShowNewClient(false);
      toast({ title: "Cliente criado!" });
    } catch (error) {
      toast({ title: "Erro ao criar cliente", variant: "destructive" });
    }
  };

  const toggleLanguage = (langId: string) => {
    setSelectedLanguages((prev) =>
      prev.includes(langId)
        ? prev.filter((id) => id !== langId)
        : [...prev, langId]
    );
  };

  const toggleRegion = (regionId: string) => {
    setSelectedRegions((prev) =>
      prev.includes(regionId)
        ? prev.filter((id) => id !== regionId)
        : [...prev, regionId]
    );
  };

  const addSection = () => {
    setSections((prev) => [
      ...prev,
      { name: "", description: "", prompt_text: "", target_hours: 0 },
    ]);
  };

  const updateSection = (index: number, field: keyof SectionDraft, value: string | number) => {
    setSections((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  const removeSection = (index: number) => {
    setSections((prev) => prev.filter((_, i) => i !== index));
  };

  const isLoading = createCampaign.isPending || updateCampaign.isPending || deleteCampaign.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {campaignId ? "Editar Campanha" : "Nova Campanha"}
          </DialogTitle>
          <DialogDescription>
            Configure os detalhes da campanha de coleta de áudio
          </DialogDescription>
        </DialogHeader>

        {loadingCampaign && campaignId ? (
          <div className="py-8 text-center text-muted-foreground">
            Carregando...
          </div>
        ) : (
          <Tabs defaultValue="general" className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="general">Geral</TabsTrigger>
              <TabsTrigger value="audio">Áudio</TabsTrigger>
              <TabsTrigger value="locales">Idiomas/Regiões</TabsTrigger>
              <TabsTrigger value="sections">Seções</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 mt-4">
              {/* General Tab */}
              <TabsContent value="general" className="space-y-4 pr-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome da Campanha *</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Coleta PT-BR Comandos de Voz"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Descrição</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descreva o objetivo da campanha..."
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Cliente</Label>
                  {showNewClient ? (
                    <div className="flex gap-2">
                      <Input
                        value={newClientName}
                        onChange={(e) => setNewClientName(e.target.value)}
                        placeholder="Nome do cliente"
                      />
                      <Button onClick={handleCreateClient} disabled={!newClientName.trim()}>
                        Criar
                      </Button>
                      <Button variant="ghost" onClick={() => setShowNewClient(false)}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Select value={clientId} onValueChange={setClientId}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Selecione um cliente" />
                        </SelectTrigger>
                        <SelectContent>
                          {clients?.map((client) => (
                            <SelectItem key={client.id} value={client.id}>
                              {client.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="outline" onClick={() => setShowNewClient(true)}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="startDate">Data Início</Label>
                    <Input
                      id="startDate"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="endDate">Data Fim</Label>
                    <Input
                      id="endDate"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="target">Meta de Horas</Label>
                  <Input
                    id="target"
                    type="number"
                    step="0.5"
                    value={targetHours || ""}
                    onChange={(e) => setTargetHours(parseFloat(e.target.value) || 0)}
                    placeholder="Ex: 100"
                  />
                  <p className="text-xs text-muted-foreground">
                    Total de horas de áudio a serem coletadas
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    id="active"
                    checked={isActive}
                    onCheckedChange={setIsActive}
                  />
                  <Label htmlFor="active">Campanha ativa</Label>
                </div>
              </TabsContent>

              {/* Audio Tab */}
              <TabsContent value="audio" className="space-y-4 pr-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Sample Rate</Label>
                    <Select value={sampleRate.toString()} onValueChange={(v) => setSampleRate(parseInt(v))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="16000">16 kHz</SelectItem>
                        <SelectItem value="22050">22.05 kHz</SelectItem>
                        <SelectItem value="44100">44.1 kHz</SelectItem>
                        <SelectItem value="48000">48 kHz</SelectItem>
                        <SelectItem value="96000">96 kHz</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Bit Depth</Label>
                    <Select value={bitDepth.toString()} onValueChange={(v) => setBitDepth(parseInt(v))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="16">16 bit</SelectItem>
                        <SelectItem value="24">24 bit</SelectItem>
                        <SelectItem value="32">32 bit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Canais</Label>
                    <Select value={channels.toString()} onValueChange={(v) => setChannels(parseInt(v))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Mono</SelectItem>
                        <SelectItem value="2">Stereo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Formato</Label>
                    <Select value={format} onValueChange={setFormat}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="wav">WAV</SelectItem>
                        <SelectItem value="flac">FLAC</SelectItem>
                        <SelectItem value="mp3">MP3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="minDuration">Duração Mínima (segundos)</Label>
                    <Input
                      id="minDuration"
                      type="number"
                      value={minDuration ?? ""}
                      onChange={(e) => setMinDuration(e.target.value ? parseFloat(e.target.value) : undefined)}
                      placeholder="Ex: 3"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxDuration">Duração Máxima (segundos)</Label>
                    <Input
                      id="maxDuration"
                      type="number"
                      value={maxDuration ?? ""}
                      onChange={(e) => setMaxDuration(e.target.value ? parseFloat(e.target.value) : undefined)}
                      placeholder="Ex: 30"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="minSnr">SNR Mínimo (dB)</Label>
                  <Input
                    id="minSnr"
                    type="number"
                    value={minSnr ?? ""}
                    onChange={(e) => setMinSnr(e.target.value ? parseFloat(e.target.value) : undefined)}
                    placeholder="Ex: 20"
                  />
                  <p className="text-xs text-muted-foreground">
                    Signal-to-Noise Ratio mínimo aceitável para qualidade do áudio
                  </p>
                </div>
              </TabsContent>

              {/* Locales Tab */}
              <TabsContent value="locales" className="space-y-6 pr-4">
                <div className="space-y-3">
                  <Label>Idiomas</Label>
                  <div className="flex flex-wrap gap-2">
                    {languages?.map((lang) => (
                      <Badge
                        key={lang.id}
                        variant={selectedLanguages.includes(lang.id) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleLanguage(lang.id)}
                      >
                        {lang.emoji} {lang.name}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Regiões</Label>
                  <div className="flex flex-wrap gap-2">
                    {regions?.map((region) => (
                      <Badge
                        key={region.id}
                        variant={selectedRegions.includes(region.id) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleRegion(region.id)}
                      >
                        {region.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </TabsContent>

              {/* Sections Tab */}
              <TabsContent value="sections" className="space-y-4 pr-4">
                <div className="flex items-center justify-between">
                  <Label>Seções de Gravação</Label>
                  <Button variant="outline" size="sm" onClick={addSection}>
                    <Plus className="h-4 w-4 mr-1" />
                    Adicionar Seção
                  </Button>
                </div>

                {sections.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                    Nenhuma seção criada. Adicione seções para definir os prompts/tópicos de gravação.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {sections.map((section, index) => (
                      <div
                        key={index}
                        className="border rounded-lg p-4 space-y-3"
                      >
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Seção {index + 1}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ml-auto h-8 w-8 text-destructive"
                            onClick={() => removeSection(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        <Input
                          value={section.name}
                          onChange={(e) => updateSection(index, "name", e.target.value)}
                          placeholder="Nome da seção (ex: Comandos de navegação)"
                        />

                        <Textarea
                          value={section.description}
                          onChange={(e) => updateSection(index, "description", e.target.value)}
                          placeholder="Descrição da seção..."
                          rows={2}
                        />

                        <Textarea
                          value={section.prompt_text}
                          onChange={(e) => updateSection(index, "prompt_text", e.target.value)}
                          placeholder="Texto do prompt (o que o participante deve falar)"
                          rows={2}
                        />

                        <Input
                          type="number"
                          step="0.5"
                          value={section.target_hours || ""}
                          onChange={(e) => updateSection(index, "target_hours", parseFloat(e.target.value) || 0)}
                          placeholder="Meta de horas para esta seção"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </ScrollArea>

            <div className="flex justify-between pt-4 border-t mt-4">
              {campaignId && (
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={isLoading}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Excluir
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" onClick={onClose} disabled={isLoading}>
                  Cancelar
                </Button>
                <Button onClick={handleSave} disabled={isLoading}>
                  {isLoading ? "Salvando..." : campaignId ? "Salvar" : "Criar"}
                </Button>
              </div>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
