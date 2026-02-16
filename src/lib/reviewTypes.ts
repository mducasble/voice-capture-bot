/**
 * Types for the transcription review module.
 */

export interface TimedWord {
  text: string;
  start: number; // seconds
  end: number;   // seconds
  speaker?: string;
  /** User-edited replacement text */
  editedText?: string;
  /** Error tag applied by reviewer */
  tag?: WordTag;
}

export type WordTag = 'inaudible' | 'noise' | 'overlap' | 'uncertain';

export const WORD_TAG_LABELS: Record<WordTag, { label: string; emoji: string }> = {
  inaudible: { label: 'Inaudível', emoji: '🔇' },
  noise: { label: 'Ruído', emoji: '📢' },
  overlap: { label: 'Sobreposição', emoji: '🗣️' },
  uncertain: { label: 'Incerto', emoji: '❓' },
};

export type ReviewAction = 'approved' | 'rejected';

/**
 * Extract timed words from recording metadata.
 * Priority: ElevenLabs word-level > Gemini segments > estimated from plain text.
 */
export function extractTimedWords(
  metadata: Record<string, unknown> | null,
  transcription: string | null,
  duration: number | null,
): TimedWord[] {
  // 1. ElevenLabs word-level timestamps
  const elWords = metadata?.elevenlabs_words as Array<{
    text: string; start: number; end: number; speaker?: string;
  }> | null;

  if (elWords && elWords.length > 0) {
    return elWords
      .filter(w => w.text?.trim()) // Filter out whitespace-only entries
      .map(w => ({
        text: w.text.trim(),
        start: w.start,
        end: w.end,
        speaker: w.speaker,
      }));
  }

  // 2. Gemini phrase-level segments
  const geminiSegments = metadata?.gemini_segments as Array<{
    start: string; end: string; text: string;
  }> | null;

  if (geminiSegments && geminiSegments.length > 0) {
    const words: TimedWord[] = [];
    for (const seg of geminiSegments) {
      const segStart = parseTimestamp(seg.start);
      const segEnd = parseTimestamp(seg.end);
      const segWords = seg.text.split(/\s+/).filter(Boolean);
      if (segWords.length === 0) continue;
      const wordDuration = (segEnd - segStart) / segWords.length;
      segWords.forEach((w, i) => {
        words.push({
          text: w,
          start: segStart + i * wordDuration,
          end: segStart + (i + 1) * wordDuration,
        });
      });
    }
    return words;
  }

  // 3. Fallback: distribute words evenly across duration
  if (transcription && duration && duration > 0) {
    const textWords = transcription.split(/\s+/).filter(Boolean);
    if (textWords.length === 0) return [];
    const wordDur = duration / textWords.length;
    return textWords.map((w, i) => ({
      text: w,
      start: i * wordDur,
      end: (i + 1) * wordDur,
    }));
  }

  return [];
}

/** Parse "M:SS" or "MM:SS" timestamp to seconds */
function parseTimestamp(ts: string): number {
  const parts = ts.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(ts) || 0;
}
