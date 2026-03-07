import { useCampaigns } from "@/hooks/useCampaigns"; 
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { Calendar, Clock, Coins, ArrowRight, Layers, Bell, CheckCircle, BookOpen } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import KGenButton from "@/components/portal/KGenButton";
import { TASK_TYPE_LABELS } from "@/lib/campaignTypes";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import { useUserCountry, isCampaignVisibleForCountry } from "@/hooks/useUserCountry";

function isWaitlist(c: any) {
  return c.campaign_status === "waiting_list" || (!!c.start_date && new Date(`${c.start_date}T00:00:00`) > new Date());
}

function CampaignCard({ campaign, isOnWaitlist, user, onWaitlistToggle }: { campaign: any; isOnWaitlist?: boolean; user: any; onWaitlistToggle: (campaignId: string) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [joining, setJoining] = useState(false);
  const enabledTaskSets = campaign.task_sets?.filter((ts: any) => ts.enabled) || [];
  const waitlist = isWaitlist(campaign);

  const handleClick = async () => {
    if (!user) {
      navigate("/auth");
      return;
    }

    if (waitlist) {
      onWaitlistToggle(campaign.id);
      return;
    }

    // Active campaign: auto-join if needed and go directly to task
    setJoining(true);
    try {
      // Check if already participant
      const { data: existing } = await supabase
        .from("campaign_participants")
        .select("id")
        .eq("campaign_id", campaign.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!existing) {
        const { error } = await supabase
          .from("campaign_participants")
          .insert({ campaign_id: campaign.id, user_id: user.id });
        if (error && !error.message.includes("duplicate")) throw error;
        queryClient.invalidateQueries({ queryKey: ["campaign_participant", campaign.id, user.id] });
      }
      navigate(`/campaign/${campaign.id}/task`);
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setJoining(false);
    }
  };

  const buttonLabel = waitlist
    ? (isOnWaitlist ? t("dashboard.alreadyOnWaitlist") : t("dashboard.waitingList"))
    : t("dashboard.start");

  const buttonIcon = waitlist
    ? (isOnWaitlist ? <CheckCircle className="h-4 w-4" /> : <Bell className="h-4 w-4" />)
    : <ArrowRight className="h-4 w-4" />;

  return (
    <div className="group transition-colors" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
      {enabledTaskSets.length > 0 && (
        <div className="font-mono text-sm uppercase tracking-widest font-bold flex items-center gap-1 px-4 py-3" style={{ color: "var(--portal-text-muted)", borderBottom: "1px solid var(--portal-border)" }}>
          <Layers className="h-2.5 w-2.5" />
          {enabledTaskSets.map((ts: any) => TASK_TYPE_LABELS[ts.task_type] || ts.task_type).join(" · ")}
        </div>
      )}
      <div className="p-5 pt-2 space-y-3" style={{ borderBottom: "1px solid var(--portal-border)" }}>
        <div className="flex items-start justify-between">
          <h3 className="font-mono text-lg font-bold uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>{campaign.name}</h3>
          {campaign.client && (
            <span className="font-mono text-xs font-extrabold uppercase tracking-widest px-2 py-1" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}>{campaign.client.name}</span>
          )}
        </div>
        {campaign.description && <p className="font-mono text-sm line-clamp-2" style={{ color: "var(--portal-text-muted)" }}>{campaign.description}</p>}
      </div>
      <div className="p-5 space-y-3">
        <div className="flex flex-wrap gap-3 font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
          {campaign.start_date && (
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(campaign.start_date), "dd MMM yyyy", { locale: ptBR })}</span>
          )}
          {campaign.target_hours && (
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{campaign.target_hours}{t("dashboard.goalHours")}</span>
          )}
        </div>
        {campaign.language_variants && campaign.language_variants.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {campaign.language_variants.map((v: any) => (
              <span key={v.variant_id} className="font-mono text-xs px-2 py-0.5" style={{ background: "hsl(0 0% 15%)", border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}>{v.label}</span>
            ))}
          </div>
        )}
      </div>
      <div className="p-5 flex gap-2" style={{ borderTop: "1px solid var(--portal-border)" }}>
        <KGenButton
          className="flex-1"
          size="sm"
          variant="ghost"
          onClick={() => navigate(`/campaign/${campaign.id}`)}
          scrambleText={t("dashboard.viewDetails")}
          icon={<BookOpen className="h-4 w-4" />}
        />
        <KGenButton
          className="flex-1"
          size="sm"
          onClick={handleClick}
          disabled={joining}
          scrambleText={joining ? t("common.loading") : buttonLabel}
          icon={buttonIcon}
        />
      </div>
    </div>
  );
}

export default function PortalDashboard() {
  const { data: campaigns, isLoading } = useCampaigns();
  const { user } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { country: userCountry } = useUserCountry();

  const { data: userWaitlistIds } = useQuery({
    queryKey: ["user-waitlist", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("campaign_waitlist")
        .select("campaign_id")
        .eq("user_id", user!.id);
      return new Set((data || []).map((w: any) => w.campaign_id));
    },
    enabled: !!user?.id,
  });

  // Fetch user's active participations
  const { data: userParticipationIds } = useQuery({
    queryKey: ["user-participations", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("campaign_participants")
        .select("campaign_id")
        .eq("user_id", user!.id);
      return new Set((data || []).map((p: any) => p.campaign_id));
    },
    enabled: !!user?.id,
  });

  const handleWaitlistToggle = async (campaignId: string) => {
    if (!user) return;
    const isOn = userWaitlistIds?.has(campaignId);
    try {
      if (isOn) {
        const { error } = await supabase
          .from("campaign_waitlist")
          .delete()
          .eq("campaign_id", campaignId)
          .eq("user_id", user.id);
        if (error) throw error;
        toast.success(t("dashboard.leftWaitlist") || "Você saiu da lista de espera.");
      } else {
        const { error } = await supabase
          .from("campaign_waitlist")
          .insert({ campaign_id: campaignId, user_id: user.id });
        if (error) throw error;
        toast.success(t("dashboard.joinedWaitlist") || "Você entrou na lista de espera!");
      }
      queryClient.invalidateQueries({ queryKey: ["user-waitlist", user.id] });
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const allActive = campaigns?.filter(c => c.is_active) || [];
  const allVisible = allActive.filter(c => isCampaignVisibleForCountry(c.geographic_scope, userCountry));
  
  const readyNow = allVisible
    .filter(c => !isWaitlist(c))
    .sort((a, b) => {
      const da = a.start_date ? new Date(a.start_date).getTime() : 0;
      const db = b.start_date ? new Date(b.start_date).getTime() : 0;
      return da - db;
    });

  // Split ready campaigns: participated ones show regardless of geo filter
  const { availableCampaigns, myActiveCampaigns } = useMemo(() => {
    const allReadyActive = allActive.filter(c => !isWaitlist(c));
    if (!userParticipationIds) return { availableCampaigns: readyNow, myActiveCampaigns: [] };
    return {
      availableCampaigns: readyNow.filter(c => !userParticipationIds.has(c.id)),
      myActiveCampaigns: allReadyActive.filter(c => userParticipationIds.has(c.id)),
    };
  }, [allActive, readyNow, userParticipationIds]);

  const waitlistCampaigns = allVisible
    .filter(c => isWaitlist(c))
    .sort((a, b) => {
      const da = a.start_date ? new Date(a.start_date).getTime() : Infinity;
      const db = b.start_date ? new Date(b.start_date).getTime() : Infinity;
      return da - db;
    });

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
          <span className="font-mono text-sm tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>{t("dashboard.badge")}</span>
        </div>
        <h1 className="font-mono text-3xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>{t("dashboard.title")}</h1>
        <p className="font-mono text-base mt-2" style={{ color: "var(--portal-text-muted)" }}>{t("dashboard.subtitle")}</p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48" style={{ background: "var(--portal-card-bg)" }} />)}
        </div>
      )}

      {!isLoading && allVisible.length === 0 && (
        <div className="text-center py-16" style={{ border: "1px solid var(--portal-border)" }}>
          <Coins className="h-12 w-12 mx-auto mb-4" style={{ color: "var(--portal-text-muted)" }} />
          <h3 className="font-mono text-xl font-bold uppercase" style={{ color: "var(--portal-text)" }}>{t("dashboard.noCampaigns")}</h3>
          <p className="font-mono text-base mt-1" style={{ color: "var(--portal-text-muted)" }}>{t("dashboard.noCampaignsDesc")}</p>
        </div>
      )}

      {/* Available campaigns (not yet joined) */}
      {availableCampaigns.length > 0 ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
            {availableCampaigns.map(c => <CampaignCard key={c.id} campaign={c} user={user} onWaitlistToggle={handleWaitlistToggle} />)}
          </div>
        </div>
      ) : !isLoading && allVisible.length > 0 && (
        <div className="text-center py-10" style={{ border: "1px solid var(--portal-border)" }}>
          <Coins className="h-10 w-10 mx-auto mb-3" style={{ color: "var(--portal-text-muted)" }} />
          <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>{t("dashboard.noNewOpportunities")}</p>
        </div>
      )}

      {/* My active campaigns (already participating) */}
      {myActiveCampaigns.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <BookOpen className="h-4 w-4" style={{ color: "var(--portal-accent)" }} />
            <h2 className="font-mono text-lg font-bold uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>{t("dashboard.startedOpportunities")}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
            {myActiveCampaigns.map(c => <CampaignCard key={c.id} campaign={c} user={user} onWaitlistToggle={handleWaitlistToggle} />)}
          </div>
        </div>
      )}

      {/* Waiting list campaigns */}
      {waitlistCampaigns.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Bell className="h-4 w-4" style={{ color: "var(--portal-text-muted)" }} />
            <h2 className="font-mono text-lg font-bold uppercase tracking-tight" style={{ color: "var(--portal-text-muted)" }}>{t("dashboard.comingSoon")}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
            {waitlistCampaigns.map(c => <CampaignCard key={c.id} campaign={c} isOnWaitlist={userWaitlistIds?.has(c.id)} user={user} onWaitlistToggle={handleWaitlistToggle} />)}
          </div>
        </div>
      )}
    </div>
  );
}
