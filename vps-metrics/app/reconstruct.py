"""
Reconstruct individual speaker tracks from a mixed audio file
using ElevenLabs diarization (word-level timestamps + speaker IDs).

Strategy: "silence mask" — each speaker gets a full-length WAV where
segments belonging to OTHER speakers are zeroed out. This preserves
the original timing/sync between tracks.
"""

import io
import json
import zipfile
import numpy as np
import soundfile as sf
from collections import defaultdict
from typing import List, Dict, Tuple


def _build_speaker_segments(
    words: List[Dict],
    merge_gap: float = 0.15,
) -> Dict[str, List[Tuple[float, float]]]:
    """
    Group word-level timestamps into contiguous segments per speaker.
    Words from the same speaker closer than `merge_gap` seconds are merged.
    """
    raw: Dict[str, List[Tuple[float, float]]] = defaultdict(list)
    for w in words:
        spk = w.get("speaker", "unknown")
        start = float(w.get("start", 0))
        end = float(w.get("end", start))
        if end <= start:
            continue
        raw[spk].append((start, end))

    merged: Dict[str, List[Tuple[float, float]]] = {}
    for spk, segs in raw.items():
        segs.sort(key=lambda s: s[0])
        result = [segs[0]]
        for s, e in segs[1:]:
            prev_s, prev_e = result[-1]
            if s - prev_e <= merge_gap:
                result[-1] = (prev_s, max(prev_e, e))
            else:
                result.append((s, e))
        merged[spk] = result

    return merged


def _apply_crossfade(
    mask: np.ndarray,
    segments: List[Tuple[int, int]],
    fade_samples: int = 480,
) -> np.ndarray:
    """Apply short crossfade ramps at segment boundaries to avoid clicks."""
    for seg_start, seg_end in segments:
        # Fade in
        n_in = min(fade_samples, seg_end - seg_start)
        if n_in > 0:
            mask[seg_start:seg_start + n_in] *= np.linspace(0, 1, n_in)
        # Fade out
        n_out = min(fade_samples, seg_end - seg_start)
        if n_out > 0:
            mask[seg_end - n_out:seg_end] *= np.linspace(1, 0, n_out)
    return mask


def reconstruct_tracks(
    audio: np.ndarray,
    sr: int,
    words: List[Dict],
    crossfade_ms: float = 10.0,
    padding_ms: float = 50.0,
) -> Dict[str, np.ndarray]:
    """
    Given mixed audio and ElevenLabs word-level diarization,
    produce a dict of {speaker_label: audio_array}.

    Strategy: each speaker's track keeps ALL audio EXCEPT segments
    where ANOTHER speaker is actively talking (and the current speaker
    is NOT). This preserves ambient sound, breathing, and natural
    pauses while removing cross-talk.

    Args:
        audio: mono float32 array
        words: list of dicts with keys: text, start, end, speaker
        crossfade_ms: fade duration at segment edges (avoids clicks)
        padding_ms: extra padding around each segment
    """
    total_samples = len(audio)
    speaker_segments = _build_speaker_segments(words)

    fade_samples = int(sr * crossfade_ms / 1000)
    pad_samples = int(sr * padding_ms / 1000)

    tracks: Dict[str, np.ndarray] = {}

    for speaker, segments in speaker_segments.items():
        # Start with everything audible
        mask = np.ones(total_samples, dtype=np.float32)

        # Build a set of sample ranges where THIS speaker is active
        my_active = np.zeros(total_samples, dtype=bool)
        for seg_start_s, seg_end_s in segments:
            s = max(0, int(seg_start_s * sr) - pad_samples)
            e = min(total_samples, int(seg_end_s * sr) + pad_samples)
            my_active[s:e] = True

        # Mute regions where OTHER speakers are active and this one is NOT
        others_active = np.zeros(total_samples, dtype=bool)
        for other_spk, other_segs in speaker_segments.items():
            if other_spk == speaker:
                continue
            for seg_start_s, seg_end_s in other_segs:
                s = max(0, int(seg_start_s * sr) - pad_samples)
                e = min(total_samples, int(seg_end_s * sr) + pad_samples)
                others_active[s:e] = True

        # Mute only where others talk AND this speaker is silent
        mute_mask = others_active & ~my_active
        mask[mute_mask] = 0.0

        # Apply crossfade at mute boundaries to avoid clicks
        mask = _apply_crossfade_mute(mask, fade_samples)
        tracks[speaker] = audio * mask

    return tracks


def _apply_crossfade_mute(
    mask: np.ndarray,
    fade_samples: int = 480,
) -> np.ndarray:
    """Apply short crossfade ramps at 1→0 and 0→1 transitions."""
    if fade_samples <= 0:
        return mask
    
    # Find transition points
    diff = np.diff(mask)
    
    # 1→0 transitions (fade out)
    fadeout_points = np.where(diff < -0.5)[0]
    for p in fadeout_points:
        start = max(0, p - fade_samples // 2)
        end = min(len(mask), p + fade_samples // 2)
        length = end - start
        if length > 0:
            mask[start:end] = np.minimum(mask[start:end], np.linspace(1, 0, length))
    
    # 0→1 transitions (fade in)
    fadein_points = np.where(diff > 0.5)[0]
    for p in fadein_points:
        start = max(0, p - fade_samples // 2)
        end = min(len(mask), p + fade_samples // 2)
        length = end - start
        if length > 0:
            mask[start:end] = np.minimum(mask[start:end], np.linspace(0, 1, length))
    
    return mask


def tracks_to_zip(
    tracks: Dict[str, np.ndarray],
    sr: int,
    session_prefix: str = "track",
) -> io.BytesIO:
    """
    Package speaker tracks into a ZIP file.
    Each track is a 16-bit PCM WAV.
    """
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for speaker, audio_data in sorted(tracks.items()):
            wav_buf = io.BytesIO()
            sf.write(wav_buf, audio_data, sr, format="WAV", subtype="PCM_16")
            wav_buf.seek(0)
            filename = f"{session_prefix}_{speaker}.wav"
            zf.writestr(filename, wav_buf.read())

    zip_buffer.seek(0)
    return zip_buffer
