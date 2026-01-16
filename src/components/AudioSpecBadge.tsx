import { Badge } from "@/components/ui/badge";

export function AudioSpecBadge() {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="outline" className="border-primary/50 text-primary bg-primary/5">
        44.1kHz
      </Badge>
      <Badge variant="outline" className="border-primary/50 text-primary bg-primary/5">
        16-bit
      </Badge>
      <Badge variant="outline" className="border-primary/50 text-primary bg-primary/5">
        Stereo
      </Badge>
      <Badge variant="outline" className="border-primary/50 text-primary bg-primary/5">
        WAV
      </Badge>
      <Badge variant="outline" className="border-accent/50 text-accent bg-accent/5">
        SNR ≥20dB
      </Badge>
    </div>
  );
}
