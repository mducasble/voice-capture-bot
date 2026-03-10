import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { Camera, Save, Loader2, X, AlertTriangle } from "lucide-react";
import KGenButton from "@/components/portal/KGenButton";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useProfileCompletion } from "@/hooks/useProfileCompletion";

const OPPORTUNITY_OPTIONS = [
  { value: "audio_capture_solo", label: "Áudio (Solo)" },
  { value: "audio_capture_group", label: "Áudio (Grupo)" },
  { value: "video_submission", label: "Vídeo" },
  { value: "image_submission", label: "Foto / Imagem" },
  { value: "data_labeling", label: "Data Labelling" },
  { value: "transcription", label: "Transcrição" },
];

const LANGUAGE_OPTIONS = [
  "Português", "English", "Español", "Français", "Deutsch",
  "Italiano", "日本語", "中文", "한국어", "العربية", "हिन्दी", "Русский",
];

interface ProfileData {
  full_name: string | null;
  avatar_url: string | null;
  wallet_id: string | null;
  whatsapp: string | null;
  telegram: string | null;
  email_contact: string | null;
  country: string | null;
  city: string | null;
  spoken_languages: string[];
  desired_opportunities: string[];
}

export default function PortalProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { t } = useTranslation();
  const { isComplete: profileComplete } = useProfileCompletion();

  const { data: profile, isLoading, error: profileError } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, wallet_id, whatsapp, telegram, email_contact, country, city, spoken_languages, desired_opportunities")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return data as unknown as ProfileData;
    },
    enabled: !!user?.id,
  });

  const [form, setForm] = useState<ProfileData | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Sync form state when profile data loads
  useEffect(() => {
    if (profile && !profileLoaded) {
      setForm({
        full_name: profile.full_name || "",
        avatar_url: profile.avatar_url || null,
        wallet_id: profile.wallet_id || "",
        whatsapp: profile.whatsapp || "",
        telegram: profile.telegram || "",
        email_contact: profile.email_contact || user?.email || "",
        country: profile.country || "",
        city: profile.city || "",
        spoken_languages: profile.spoken_languages || [],
        desired_opportunities: profile.desired_opportunities || [],
      });
      setProfileLoaded(true);
    }
  }, [profile, profileLoaded, user?.email]);

  const currentForm: ProfileData = form || {
    full_name: profile?.full_name || "",
    avatar_url: profile?.avatar_url || null,
    wallet_id: profile?.wallet_id || "",
    whatsapp: profile?.whatsapp || "",
    telegram: profile?.telegram || "",
    email_contact: profile?.email_contact || user?.email || "",
    country: profile?.country || "",
    city: profile?.city || "",
    spoken_languages: profile?.spoken_languages || [],
    desired_opportunities: profile?.desired_opportunities || [],
  };

  const updateField = (key: keyof ProfileData, value: any) => {
    setForm({ ...currentForm, [key]: value });
  };

  const toggleArrayItem = (key: "spoken_languages" | "desired_opportunities", item: string) => {
    const arr = currentForm[key] || [];
    const next = arr.includes(item)
      ? arr.filter((v: string) => v !== item)
      : [...arr, item];
    updateField(key, next);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: currentForm.full_name,
          avatar_url: currentForm.avatar_url,
          wallet_id: currentForm.wallet_id,
          whatsapp: currentForm.whatsapp,
          telegram: currentForm.telegram,
          email_contact: currentForm.email_contact,
          country: currentForm.country,
          city: currentForm.city,
          spoken_languages: currentForm.spoken_languages,
          desired_opportunities: currentForm.desired_opportunities,
        } as any)
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["profile-completion"] });
      toast.success(t("profile.savedSuccess"));
    },
    onError: (error: any) => {
      const msg = error?.message || "";
      if (msg.includes("JWT") || msg.includes("token") || msg.includes("session")) {
        toast.error(t("profile.sessionExpired") || "Sessão expirada. Faça login novamente.");
      } else {
        toast.error(t("profile.saveError"));
      }
    },
  });

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(path);

      updateField("avatar_url", urlData.publicUrl + "?t=" + Date.now());
    } catch {
      toast.error(t("profile.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--portal-accent)" }} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {!profileComplete && (
        <div className="flex items-center gap-3 p-4 font-mono text-sm" style={{ border: "1px solid var(--portal-accent)", background: "color-mix(in srgb, var(--portal-accent) 10%, transparent)", color: "var(--portal-accent)" }}>
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
          <span>{t("profile.completeRequired")}</span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
        <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
          {t("profile.title")}
        </h1>
      </div>

      <div className="flex items-center gap-6" style={{ borderBottom: "1px solid var(--portal-border)", paddingBottom: "24px" }}>
        <div className="relative">
          <div className="w-20 h-20 flex items-center justify-center overflow-hidden" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
            {currentForm.avatar_url ? (
              <img src={currentForm.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <Camera className="h-6 w-6" style={{ color: "var(--portal-text-muted)" }} />
            )}
          </div>
          <button onClick={() => fileInputRef.current?.click()} className="absolute -bottom-2 -right-2 p-1.5" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }} disabled={uploading}>
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
        </div>
        <div>
          <p className="font-mono text-sm font-bold" style={{ color: "var(--portal-text)" }}>{t("profile.profilePhoto")}</p>
          <p className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>{t("profile.optional")}</p>
        </div>
      </div>

      <div className="space-y-5">
        <InputField label={t("profile.fullName")} value={currentForm.full_name || ""} onChange={v => updateField("full_name", v)} placeholder={t("profile.fullNamePlaceholder")} />
        <InputField label={t("profile.walletId")} value={currentForm.wallet_id || ""} onChange={v => updateField("wallet_id", v)} placeholder="0x..." />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField label={t("profile.whatsapp")} value={currentForm.whatsapp || ""} onChange={v => updateField("whatsapp", v)} placeholder="+55 11 99999-9999" />
          <InputField label={t("profile.telegram")} value={currentForm.telegram || ""} onChange={v => updateField("telegram", v)} placeholder="@username" />
        </div>
        <InputField label={t("profile.bestEmail")} value={currentForm.email_contact || ""} onChange={v => updateField("email_contact", v)} placeholder="seu@email.com" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField label={t("profile.country")} value={currentForm.country || ""} onChange={v => updateField("country", v)} placeholder="Brasil" />
          <InputField label={t("profile.city")} value={currentForm.city || ""} onChange={v => updateField("city", v)} placeholder="São Paulo" />
        </div>

        <div className="space-y-2">
          <label className="font-mono text-xs uppercase tracking-widest font-bold block" style={{ color: "var(--portal-text-muted)" }}>{t("profile.spokenLanguages")}</label>
          <div className="flex flex-wrap gap-2">
            {LANGUAGE_OPTIONS.map(lang => {
              const selected = currentForm.spoken_languages?.includes(lang);
              return (
                <button key={lang} onClick={() => toggleArrayItem("spoken_languages", lang)} className="font-mono text-xs px-3 py-1.5 transition-colors" style={{ border: "1px solid " + (selected ? "var(--portal-accent)" : "var(--portal-border)"), background: selected ? "var(--portal-accent)" : "hsl(0 0% 15%)", color: selected ? "var(--portal-accent-text)" : "var(--portal-text-muted)" }}>
                  {lang}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label className="font-mono text-xs uppercase tracking-widest font-bold block" style={{ color: "var(--portal-text-muted)" }}>{t("profile.desiredOpportunities")}</label>
          <div className="flex flex-wrap gap-2">
            {OPPORTUNITY_OPTIONS.map(opt => {
              const selected = currentForm.desired_opportunities?.includes(opt.value);
              return (
                <button key={opt.value} onClick={() => toggleArrayItem("desired_opportunities", opt.value)} className="font-mono text-xs px-3 py-1.5 transition-colors" style={{ border: "1px solid " + (selected ? "var(--portal-accent)" : "var(--portal-border)"), background: selected ? "var(--portal-accent)" : "hsl(0 0% 15%)", color: selected ? "var(--portal-accent-text)" : "var(--portal-text-muted)" }}>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--portal-border)", paddingTop: "24px" }}>
        <KGenButton
          onClick={() => saveMutation.mutate()}
          className="w-full"
          scrambleText={saveMutation.isPending ? t("profile.saving") : t("profile.saveProfile")}
          icon={saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        />
      </div>
    </div>
  );
}

function InputField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="font-mono text-xs uppercase tracking-widest font-bold block" style={{ color: "var(--portal-text-muted)" }}>{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="portal-brutalist-input w-full" />
    </div>
  );
}
