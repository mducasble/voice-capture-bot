import { Badge } from "@/components/ui/badge";
import { User } from "lucide-react";
import { useMemo } from "react";

// Vibrant color palette for speakers
const SPEAKER_COLORS = [
  { bg: "bg-rose-500/15", text: "text-rose-400", border: "border-rose-500/30", badge: "bg-rose-500/20" },
  { bg: "bg-sky-500/15", text: "text-sky-400", border: "border-sky-500/30", badge: "bg-sky-500/20" },
  { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30", badge: "bg-emerald-500/20" },
  { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30", badge: "bg-amber-500/20" },
  { bg: "bg-violet-500/15", text: "text-violet-400", border: "border-violet-500/30", badge: "bg-violet-500/20" },
  { bg: "bg-cyan-500/15", text: "text-cyan-400", border: "border-cyan-500/30", badge: "bg-cyan-500/20" },
  { bg: "bg-pink-500/15", text: "text-pink-400", border: "border-pink-500/30", badge: "bg-pink-500/20" },
  { bg: "bg-lime-500/15", text: "text-lime-400", border: "border-lime-500/30", badge: "bg-lime-500/20" },
];

interface Speaker {
  username: string;
  user_id?: string;
  has_transcription?: boolean;
}

interface SpeakerTranscriptProps {
  transcription: string;
  speakers?: Speaker[];
}

interface ParsedLine {
  speaker: string;
  text: string;
}

export function SpeakerTranscript({ transcription, speakers }: SpeakerTranscriptProps) {
  // Build speaker -> color mapping
  const speakerColorMap = useMemo(() => {
    const map: Record<string, typeof SPEAKER_COLORS[0]> = {};
    
    // Extract unique speakers from transcription
    const speakerRegex = /\[([^\]]+)\]:/g;
    const foundSpeakers = new Set<string>();
    let match;
    
    while ((match = speakerRegex.exec(transcription)) !== null) {
      foundSpeakers.add(match[1]);
    }
    
    // Also include speakers from metadata if provided
    if (speakers) {
      speakers.forEach(s => foundSpeakers.add(s.username));
    }
    
    // Assign colors
    Array.from(foundSpeakers).forEach((speaker, index) => {
      map[speaker] = SPEAKER_COLORS[index % SPEAKER_COLORS.length];
    });
    
    return map;
  }, [transcription, speakers]);

  // Parse transcription into speaker segments
  const parsedLines = useMemo((): ParsedLine[] => {
    const lines: ParsedLine[] = [];
    
    // Split by speaker tags [Name]: 
    const segments = transcription.split(/(?=\[[^\]]+\]:)/);
    
    for (const segment of segments) {
      const match = segment.match(/^\[([^\]]+)\]:\s*([\s\S]*)/);
      if (match) {
        const [, speaker, text] = match;
        if (text.trim()) {
          lines.push({ speaker, text: text.trim() });
        }
      }
    }
    
    return lines;
  }, [transcription]);

  const uniqueSpeakers = Object.keys(speakerColorMap);

  return (
    <div className="space-y-3">
      {/* Speaker Legend */}
      {uniqueSpeakers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {uniqueSpeakers.map((speaker) => {
            const colors = speakerColorMap[speaker];
            return (
              <Badge 
                key={speaker} 
                variant="outline" 
                className={`${colors.badge} ${colors.text} ${colors.border} text-xs`}
              >
                <User className="h-3 w-3 mr-1" />
                {speaker}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Conversation */}
      <div className="bg-muted/30 rounded-lg p-3 text-sm max-h-80 overflow-y-auto space-y-2">
        {parsedLines.map((line, index) => {
          const colors = speakerColorMap[line.speaker] || SPEAKER_COLORS[0];
          return (
            <div 
              key={index}
              className={`${colors.bg} ${colors.border} border rounded-lg p-2.5 transition-colors`}
            >
              <span className={`font-semibold ${colors.text}`}>
                [{line.speaker}]:
              </span>
              <span className="text-foreground/90 ml-1.5">
                {line.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
