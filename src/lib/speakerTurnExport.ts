/**
 * Generates a speaker-turn-based JSON transcript from word-level ElevenLabs data.
 * Groups consecutive words by the same speaker into blocks.
 */

export interface SpeakerTurnSegment {
  start: string;
  end: string;
  speaker: string;
  text: string;
  emotion: string;
  language: string;
  end_of_speech: boolean;
}

interface WordData {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

/** Format seconds to HH:MM:SS */
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Build speaker-turn segments from word-level data.
 * Each turn = contiguous run of the same speaker.
 */
export function buildSpeakerTurns(
  words: WordData[],
  language: string = 'UNK',
): SpeakerTurnSegment[] {
  if (!words || words.length === 0) return [];

  // Filter and sort
  const sorted = words
    .filter(w => w.text?.trim())
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) return [];

  // Map raw speaker IDs to "Speaker A", "Speaker B", etc.
  const speakerMap = new Map<string, string>();
  const letterOf = (n: number) => String.fromCharCode(65 + n);

  const getSpeakerLabel = (raw: string | undefined): string => {
    const key = raw || 'unknown';
    if (!speakerMap.has(key)) {
      speakerMap.set(key, `Speaker ${letterOf(speakerMap.size)}`);
    }
    return speakerMap.get(key)!;
  };

  // Group into turns
  const turns: { speaker: string; words: string[]; start: number; end: number }[] = [];
  let current: typeof turns[0] | null = null;

  for (const w of sorted) {
    const label = getSpeakerLabel(w.speaker);
    if (!current || current.speaker !== label) {
      if (current) turns.push(current);
      current = { speaker: label, words: [w.text.trim()], start: w.start, end: w.end };
    } else {
      current.words.push(w.text.trim());
      current.end = Math.max(current.end, w.end);
    }
  }
  if (current) turns.push(current);

  // Find the last turn index for each speaker
  const lastTurnBySpeaker = new Map<string, number>();
  turns.forEach((t, i) => lastTurnBySpeaker.set(t.speaker, i));

  return turns.map((turn, i) => ({
    start: formatTimestamp(turn.start),
    end: formatTimestamp(turn.end),
    speaker: turn.speaker,
    text: turn.words.join(' '),
    emotion: 'neutral',
    language: language.toUpperCase(),
    end_of_speech: lastTurnBySpeaker.get(turn.speaker) === i,
  }));
}
