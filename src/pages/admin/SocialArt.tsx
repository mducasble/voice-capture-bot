import { useState, useRef, useCallback } from "react";
import html2canvas from "html2canvas";
import { useCampaigns } from "@/hooks/useCampaigns";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Download, Loader2, Sparkles, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import SocialArtCanvas from "@/components/admin/SocialArtCanvas";
import { supabase } from "@/integrations/supabase/client";

const FORMATS = [
  { id: "instagram-post", label: "Instagram Post", width: 1080, height: 1080 },
  { id: "instagram-story", label: "Instagram Story", width: 1080, height: 1920 },
  { id: "twitter", label: "Twitter / X", width: 1200, height: 675 },
  { id: "whatsapp", label: "WhatsApp Status", width: 1080, height: 1920 },
] as const;

const LANGUAGES = [
  { code: "pt", label: "Português", flag: "🇧🇷" },
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "es", label: "Español", flag: "🇪🇸" },
];

export default function SocialArt() {
  const navigate = useNavigate();
  const { data: campaigns, isLoading } = useCampaigns();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [selectedFormat, setSelectedFormat] = useState<string>("instagram-post");
  const [selectedLang, setSelectedLang] = useState<string>("pt");
  const [generating, setGenerating] = useState(false);
  const [aiImageUrl, setAiImageUrl] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState<string>("");
  const [customDescription, setCustomDescription] = useState<string>("");
  const [extraCountries, setExtraCountries] = useState<string[]>([]);
  const [newCountryInput, setNewCountryInput] = useState<string>("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const campaign = campaigns?.find(c => c.id === selectedCampaignId);
  const format = FORMATS.find(f => f.id === selectedFormat)!;
  const lang = LANGUAGES.find(l => l.code === selectedLang)!;

  // Campaign index for short link
  const campaignIndex = campaigns?.findIndex(c => c.id === selectedCampaignId);
  const shortLink = campaign ? `kgen.quest/${selectedLang}/${(campaignIndex ?? 0) + 1}` : "";

  const handleDownloadTemplate = useCallback(async () => {
    if (!exportRef.current) return;

    try {
      const images = Array.from(exportRef.current.querySelectorAll("img"));
      await Promise.all(
        images.map((img) => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>((resolve) => {
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          });
        })
      );

      const canvas = await html2canvas(exportRef.current, {
        width: format.width,
        height: format.height,
        windowWidth: format.width,
        windowHeight: format.height,
        scale: 1,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#111111",
      });

      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${campaign?.name || "quest"}-${selectedFormat}-${selectedLang}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast.success("Arte exportada!");
      }, "image/png");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao exportar imagem");
    }
  }, [campaign, format, selectedFormat, selectedLang]);

  const handleGenerateAI = useCallback(async () => {
    if (!campaign) return;
    setGenerating(true);
    setAiImageUrl(null);

    try {
      const { data, error } = await supabase.functions.invoke("generate-social-art", {
        body: {
          campaignName: campaign.name,
          campaignDescription: campaign.description || "",
          taskTypes: (campaign.task_sets || []).filter(ts => ts.enabled).map(ts => ts.task_type),
          reward: campaign.reward_config,
          language: selectedLang,
          format: { width: format.width, height: format.height, id: selectedFormat },
          shortLink,
        },
      });

      if (error) throw error;
      if (data?.imageUrl) {
        setAiImageUrl(data.imageUrl);
        toast.success("Arte gerada com IA!");
      } else {
        throw new Error("No image returned");
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao gerar arte: " + (err.message || "Erro desconhecido"));
    } finally {
      setGenerating(false);
    }
  }, [campaign, selectedLang, format, selectedFormat, shortLink]);

  const handleDownloadAI = useCallback(() => {
    if (!aiImageUrl) return;
    const a = document.createElement("a");
    a.href = aiImageUrl;
    a.download = `${campaign?.name || "quest"}-ai-${selectedFormat}-${selectedLang}.png`;
    a.click();
  }, [aiImageUrl, campaign, selectedFormat, selectedLang]);

  // Scale for preview
  const previewMaxW = 480;
  const scale = Math.min(previewMaxW / format.width, 600 / format.height);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Social Media Art Generator</h1>
            <p className="text-sm text-muted-foreground">Crie artes para divulgar as quests nas redes sociais</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-8">
          {/* Controls */}
          <div className="space-y-6">
            {/* Campaign Selector */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Quest</Label>
              <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={isLoading ? "Carregando..." : "Selecione a quest"} />
                </SelectTrigger>
                <SelectContent>
                  {(campaigns || []).filter(c => c.is_active).map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Language */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Idioma</Label>
              <Select value={selectedLang} onValueChange={setSelectedLang}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map(l => (
                    <SelectItem key={l.code} value={l.code}>{l.flag} {l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Format */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Formato</Label>
              <Select value={selectedFormat} onValueChange={(v) => { setSelectedFormat(v); setAiImageUrl(null); }}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMATS.map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.label} ({f.width}×{f.height})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Short link preview */}
            {campaign && (
              <div className="p-3 rounded bg-secondary border border-border">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Link</Label>
                <p className="font-mono text-sm text-foreground mt-1">{shortLink}</p>
              </div>
            )}

            {/* Custom Title */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Título customizado</Label>
              <Input
                placeholder={campaign?.name || "Usar título da quest"}
                value={customTitle}
                onChange={e => setCustomTitle(e.target.value)}
              />
            </div>

            {/* Custom Description */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Descrição customizada</Label>
              <Textarea
                placeholder={campaign?.description || "Usar descrição da quest"}
                value={customDescription}
                onChange={e => setCustomDescription(e.target.value)}
                rows={3}
              />
            </div>

            {/* Extra Countries */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Bandeiras extras</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Ex: BR, US, MX"
                  value={newCountryInput}
                  onChange={e => setNewCountryInput(e.target.value.toUpperCase())}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const codes = newCountryInput.split(/[,\s]+/).filter(c => c.length === 2);
                      if (codes.length > 0) {
                        setExtraCountries(prev => [...new Set([...prev, ...codes])]);
                        setNewCountryInput("");
                      }
                    }
                  }}
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const codes = newCountryInput.split(/[,\s]+/).filter(c => c.length === 2);
                    if (codes.length > 0) {
                      setExtraCountries(prev => [...new Set([...prev, ...codes])]);
                      setNewCountryInput("");
                    }
                  }}
                >
                  +
                </Button>
              </div>
              {extraCountries.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {extraCountries.map(c => (
                    <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 bg-secondary border border-border text-xs font-mono">
                      {c}
                      <button onClick={() => setExtraCountries(prev => prev.filter(x => x !== c))} className="hover:text-destructive">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-3 pt-4">
              <Button
                className="w-full"
                variant="outline"
                disabled={!campaign}
                onClick={handleDownloadTemplate}
              >
                <Download className="w-4 h-4 mr-2" />
                Baixar Template
              </Button>
              <Button
                className="w-full"
                disabled={!campaign || generating}
                onClick={handleGenerateAI}
              >
                {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                {generating ? "Gerando com IA..." : "Gerar com IA"}
              </Button>
            </div>
          </div>

          {/* Preview area */}
          <div className="space-y-6">
            {/* Template preview */}
            <div>
              <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-3 block">Preview Template</Label>
              <div
                className="border border-border rounded-lg overflow-hidden inline-block"
                style={{ width: format.width * scale, height: format.height * scale }}
              >
                <div
                  style={{
                    width: format.width,
                    height: format.height,
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                  }}
                >
                  <SocialArtCanvas
                    ref={canvasRef}
                    campaign={campaign || null}
                    format={format}
                    language={selectedLang}
                    shortLink={shortLink}
                    customTitle={customTitle || undefined}
                    customDescription={customDescription || undefined}
                    extraCountries={extraCountries.length > 0 ? extraCountries : undefined}
                  />
                </div>
              </div>
            </div>

            {/* AI generated */}
            {aiImageUrl && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Gerada por IA</Label>
                  <Button size="sm" variant="outline" onClick={handleDownloadAI}>
                    <Download className="w-3 h-3 mr-1" /> Baixar
                  </Button>
                </div>
                <div
                  className="border border-border rounded-lg overflow-hidden inline-block"
                  style={{ maxWidth: format.width * scale }}
                >
                  <img src={aiImageUrl} alt="AI generated art" className="w-full h-auto" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Hidden full-size export canvas */}
        <div style={{ position: "fixed", left: 0, top: 0, opacity: 0, pointerEvents: "none", zIndex: -1 }} aria-hidden="true">
          <SocialArtCanvas
            ref={exportRef}
            campaign={campaign || null}
            format={format}
            language={selectedLang}
            shortLink={shortLink}
            customTitle={customTitle || undefined}
            customDescription={customDescription || undefined}
            extraCountries={extraCountries.length > 0 ? extraCountries : undefined}
          />
        </div>
      </div>
    </div>
  );
}
