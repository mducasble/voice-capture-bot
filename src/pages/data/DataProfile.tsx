import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Clock, CheckCircle2, XCircle, User } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Profile {
  full_name: string | null;
  avatar_url: string | null;
  country: string | null;
  city: string | null;
  total_review_seconds: number | null;
}

interface TaskStats {
  completed: number;
  timeout: number;
}

export default function DataProfile() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<TaskStats>({ completed: 0, timeout: 0 });

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("full_name, avatar_url, country, city, total_review_seconds")
      .eq("id", user.id).maybeSingle()
      .then(({ data }) => setProfile(data as Profile | null));

    supabase.from("validation_task_log").select("status")
      .eq("user_id", user.id)
      .then(({ data }) => {
        if (!data) return;
        setStats({
          completed: data.filter(d => d.status === "completed").length,
          timeout: data.filter(d => d.status === "timeout").length,
        });
      });
  }, [user]);

  const formatHours = (seconds: number | null) => {
    if (!seconds) return "0h 0min";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}min`;
  };

  const initials = (profile?.full_name || user?.email || "U").slice(0, 2).toUpperCase();

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate("/data")} className="flex items-center gap-2 text-[14px] text-white/40 hover:text-white/70 transition-colors mb-8">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>

      <div className="data-glass-card rounded-3xl p-8 text-center mb-6">
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="h-20 w-20 rounded-full mx-auto mb-4 object-cover ring-2 ring-white/10" />
        ) : (
          <div className="h-20 w-20 rounded-full bg-[hsl(var(--primary))]/20 mx-auto mb-4 flex items-center justify-center text-[24px] font-bold text-[hsl(var(--primary))]">
            {initials}
          </div>
        )}
        <h1 className="text-[24px] font-bold text-white mb-1">{profile?.full_name || user?.email}</h1>
        <p className="text-[14px] text-white/40">{[profile?.city, profile?.country].filter(Boolean).join(", ") || "Contributor"}</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { icon: Clock, label: "Tempo total", value: formatHours(profile?.total_review_seconds), color: "text-[hsl(var(--primary))]" },
          { icon: CheckCircle2, label: "Completadas", value: String(stats.completed), color: "text-emerald-400" },
          { icon: XCircle, label: "Expiradas", value: String(stats.timeout), color: "text-amber-400" },
        ].map((s) => (
          <div key={s.label} className="data-glass-card rounded-2xl p-5 text-center">
            <s.icon className={cn("h-6 w-6 mx-auto mb-2", s.color)} />
            <p className="text-[22px] font-bold text-white">{s.value}</p>
            <p className="text-[12px] text-white/40 mt-1">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
