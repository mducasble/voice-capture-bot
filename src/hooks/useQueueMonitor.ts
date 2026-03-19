import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface QueueJob {
  id: string;
  job_type: string;
  status: string;
  recording_id: string;
  created_at: string;
  started_at: string | null;
  current_segment: number;
  total_segments: number;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  position?: number;
}

export interface QueueSummary {
  jobs: QueueJob[];
  totalPending: number;
  totalProcessing: number;
  estimatedMinutes: number;
}

const AVG_MINUTES_PER_ANALYZE = 1;
const AVG_MINUTES_PER_ENHANCE = 3;

export function useQueueMonitor(enabled = true) {
  const [summary, setSummary] = useState<QueueSummary>({
    jobs: [],
    totalPending: 0,
    totalProcessing: 0,
    estimatedMinutes: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchQueue = useCallback(async () => {
    const { data, error } = await supabase
      .from("analysis_queue")
      .select("id, job_type, status, recording_id, created_at, started_at, current_segment, total_segments, attempts, max_attempts, last_error")
      .in("status", ["pending", "processing"])
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });

    if (error || !data) {
      setLoading(false);
      return;
    }

    const jobs: QueueJob[] = data.map((row, index) => ({
      ...row,
      position: row.status === "pending" ? index + 1 : 0,
    }));

    const totalPending = jobs.filter((j) => j.status === "pending").length;
    const totalProcessing = jobs.filter((j) => j.status === "processing").length;

    // Estimate remaining minutes
    let estimatedMinutes = 0;
    for (const job of jobs) {
      const avg = job.job_type === "enhance" ? AVG_MINUTES_PER_ENHANCE : AVG_MINUTES_PER_ANALYZE;
      if (job.status === "processing" && job.total_segments > 0) {
        // Partial progress
        const remaining = job.total_segments - job.current_segment;
        estimatedMinutes += (remaining / job.total_segments) * avg;
      } else {
        estimatedMinutes += avg;
      }
    }

    setSummary({ jobs, totalPending, totalProcessing, estimatedMinutes: Math.ceil(estimatedMinutes) });
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchQueue();
    const interval = setInterval(fetchQueue, 15_000); // poll every 15s
    return () => clearInterval(interval);
  }, [enabled, fetchQueue]);

  return { ...summary, loading, refetch: fetchQueue };
}
