import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function useEnhanceAudio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { recordingId: string; fileUrl: string }) => {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enhance-audio`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            recording_id: params.recordingId,
            file_url: params.fileUrl,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      return response.json();
    },
    onSuccess: (data) => {
      if (data.skipped) {
        toast.info("Áudio já está bom — nenhum enhancement necessário", {
          description: data.message,
        });
      } else {
        const reasonsSummary = data.adaptive_reasons
          ?.filter((r: string) => !r.includes('SKIP'))
          ?.map((r: string) => r.split(':')[0])
          ?.join(', ') || data.steps || 'N/A';
        toast.success("Áudio melhorado com sucesso!", {
          description: `Aplicado: ${reasonsSummary}`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    },
    onError: (error: Error) => {
      toast.error("Erro ao melhorar áudio", {
        description: error.message,
      });
    },
  });
}
