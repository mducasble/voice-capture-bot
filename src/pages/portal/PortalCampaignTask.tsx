import { useParams, useNavigate } from "react-router-dom";
import { useCampaign } from "@/hooks/useCampaigns";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft, Radio, Loader2, MessageSquare, Timer, Upload, Users,
} from "lucide-react";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import KGenButton from "@/components/portal/KGenButton";
import { TASK_TYPE_LABELS, TASK_TYPE_CATEGORIES } from "@/lib/campaignTypes";
import { PortalMultiSpeakerUpload } from "@/components/portal/PortalMultiSpeakerUpload";
import { VideoPromptPairUpload } from "@/components/portal/VideoPromptPairUpload";

const DURATION_OPTIONS = [10, 15, 20, 25, 30];

export default function PortalCampaignTask() {
  const { id } = useParams<{ id: string }>();
  const { data: campaign, isLoading } = useCampaign(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [topic, setTopic] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<number>(10);
  const [mode, setMode] = useState<"choose" | "room" | "upload">("choose");

  const enabledTaskSets = campaign?.task_sets?.filter(ts => ts.enabled) || [];
  const activeSections = campaign?.sections?.filter(s => s.is_active) || [];
  const allTopics = activeSections.length > 0
    ? activeSections.map(s => s.name)
    : enabledTaskSets.filter(ts => ts.prompt_topic).map(ts => ts.prompt_topic!);

  const primaryTaskType = useMemo(() => {
    if (!enabledTaskSets.length) return null;
    return enabledTaskSets[0].task_type;
  }, [enabledTaskSets]);

  const primaryCategory = useMemo(() => {
    if (!primaryTaskType) return null;
    return TASK_TYPE_CATEGORIES[primaryTaskType] || null;
  }, [primaryTaskType]);

  const handleCreateRoom = async () => {
    if (!user || !campaign) return;
    if (!topic.trim()) {
      toast.error(t("task.selectTopicError"));
      return;
    }
    setCreating(true);
    try {
      const userName = user.user_metadata?.full_name || user.email || "User";

      // Use edge function to create room (also provisions Daily.co SFU room)
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-room`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session?.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            creator_name: userName,
            room_name: `${campaign.name} - ${userName}`,
            campaign_id: campaign.id,
            topic: topic.trim(),
            duration_minutes: durationMinutes,
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

      if (participantId) {
        localStorage.setItem(`room_${roomId}_participant`, participantId);
      }

      navigate(`/room/${roomId}?campaign=${campaign.id}`);
    } catch (err: any) {
      toast.error(t("task.createRoomError") + err.message);
    } finally {
      setCreating(false);
    }
  };

  if (isLoading) {
    return <Skeleton className="h-64" style={{ background: "var(--portal-card-bg)" }} />;
  }

  if (!campaign) {
    return (
      <div className="text-center py-16" style={{ border: "1px solid var(--portal-border)" }}>
        <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>{t("task.campaignNotFound")}</p>
      </div>
    );
  }

  if (primaryCategory === "audio" || primaryCategory === "video") {
    if (mode === "choose") {
      return (
        <div className="space-y-6 max-w-3xl mx-auto">
          <button
            onClick={() => navigate(`/campaign/${id}`)}
            className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest transition-colors"
            style={{ color: "var(--portal-text-muted)" }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("task.backToCampaign")}
          </button>

          <div style={{ border: "1px solid var(--portal-border)" }}>
            <div className="p-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
                <span className="font-mono text-xs tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>
                  {t("task.executeTask")}
                </span>
              </div>
              <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
                {campaign.name}
              </h1>
              <p className="font-mono text-xs mt-2" style={{ color: "var(--portal-text-muted)" }}>
                {t("task.chooseMethodDesc")}
              </p>
            </div>

            <div className="p-6 grid gap-4 sm:grid-cols-2">
              <button
                onClick={() => setMode("room")}
                className="p-6 text-left transition-colors group"
                style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2" style={{ background: "var(--portal-accent)" }}>
                    <Radio className="h-5 w-5" style={{ color: "var(--portal-accent-text)" }} />
                  </div>
                  <span className="font-mono text-sm font-bold uppercase" style={{ color: "var(--portal-text)" }}>
                    {t("task.liveRoom")}
                  </span>
                </div>
                <p className="font-mono text-xs leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>
                  {t("task.liveRoomDesc")}
                </p>
              </button>

              <button
                onClick={() => setMode("upload")}
                className="p-6 text-left transition-colors group"
                style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2" style={{ background: "var(--portal-accent)" }}>
                    <Upload className="h-5 w-5" style={{ color: "var(--portal-accent-text)" }} />
                  </div>
                  <span className="font-mono text-sm font-bold uppercase" style={{ color: "var(--portal-text)" }}>
                    {t("task.uploadFile")}
                  </span>
                </div>
                <p className="font-mono text-xs leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>
                  {t("task.uploadFileDesc")}
                </p>
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (mode === "room") {
      return (
        <div className="space-y-6 max-w-3xl mx-auto">
          <button
            onClick={() => setMode("choose")}
            className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest transition-colors"
            style={{ color: "var(--portal-text-muted)" }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("common.back")}
          </button>

          <div style={{ border: "1px solid var(--portal-border)" }}>
            <div className="p-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
                <span className="font-mono text-xs tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>
                  {t("task.configureRecording")}
                </span>
              </div>
              <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
                {campaign.name}
              </h1>
            </div>

            <div className="p-6 space-y-4" style={{ borderBottom: "1px solid var(--portal-border)" }}>
              <div className="space-y-2">
                <label className="font-mono text-xs uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--portal-text-muted)" }}>
                  <MessageSquare className="h-3.5 w-3.5" /> {t("task.conversationTopic")}
                </label>
                <select
                  className="portal-brutalist-input w-full"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                >
                  <option value="">{t("task.selectTopic")}...</option>
                  {allTopics.map((t_topic, i) => (
                    <option key={i} value={t_topic}>{t_topic}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="font-mono text-xs uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--portal-text-muted)" }}>
                  <Timer className="h-3.5 w-3.5" /> {t("task.sessionDuration")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {DURATION_OPTIONS.map(min => (
                    <button
                      key={min}
                      onClick={() => setDurationMinutes(min)}
                      className="font-mono text-xs px-4 py-2 transition-colors"
                      style={{
                        border: `1px solid ${durationMinutes === min ? "var(--portal-accent)" : "var(--portal-border)"}`,
                        background: durationMinutes === min ? "var(--portal-accent)" : "transparent",
                        color: durationMinutes === min ? "var(--portal-accent-text)" : "var(--portal-text-muted)",
                      }}
                    >
                      {min} {t("task.minutes")}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6">
              <KGenButton
                onClick={handleCreateRoom}
                disabled={creating || !topic.trim()}
                className="w-full"
                size="default"
                scrambleText={creating ? t("task.creating") : t("task.createRoom")}
                icon={creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
              />
            </div>
          </div>
        </div>
      );
    }

    if (mode === "upload") {
      return (
        <div className="space-y-6 max-w-3xl mx-auto">
          <button
            onClick={() => setMode("choose")}
            className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest transition-colors"
            style={{ color: "var(--portal-text-muted)" }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("common.back")}
          </button>

          <div style={{ border: "1px solid var(--portal-border)" }}>
            <div className="p-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
                <span className="font-mono text-xs tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>
                  {t("task.uploadMaterial")}
                </span>
              </div>
              <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
                {campaign.name}
              </h1>
            </div>

            <div className="p-6">
              <PortalMultiSpeakerUpload campaignId={campaign.id} />
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <button
        onClick={() => navigate(`/campaign/${id}`)}
        className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest transition-colors"
        style={{ color: "var(--portal-text-muted)" }}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("task.backToCampaign")}
      </button>

      <div className="p-8 text-center" style={{ border: "1px solid var(--portal-border)" }}>
        <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
          {t("task.comingSoon")}
        </p>
      </div>
    </div>
  );
}