"""
Audio enhancement functions.
Identical to HuggingFace Space version — extracted for reuse.
"""

import numpy as np
from scipy.signal import butter, sosfilt


def enhance_normalize_lufs(audio: np.ndarray, target_lufs: float = -23.0) -> np.ndarray:
    rms = np.sqrt(np.mean(audio ** 2))
    if rms < 1e-10:
        return audio
    current_db = 20 * np.log10(rms)
    gain_db = target_lufs - current_db
    gain = 10 ** (gain_db / 20)
    result = audio * gain
    return np.clip(result, -1.0, 1.0)


def enhance_highpass(audio: np.ndarray, sr: int, cutoff: float = 80.0) -> np.ndarray:
    if cutoff <= 0 or cutoff >= sr / 2:
        return audio
    sos = butter(4, cutoff, btype='highpass', fs=sr, output='sos')
    return sosfilt(sos, audio).astype(np.float32)


def enhance_lowpass(audio: np.ndarray, sr: int, cutoff: float = 16000.0) -> np.ndarray:
    if cutoff <= 0 or cutoff >= sr / 2:
        return audio
    sos = butter(4, cutoff, btype='lowpass', fs=sr, output='sos')
    return sosfilt(sos, audio).astype(np.float32)


def enhance_speech_eq(audio: np.ndarray, sr: int, boost_db: float = 3.0) -> np.ndarray:
    if boost_db <= 0:
        return audio
    low_freq = 1000.0
    high_freq = min(4000.0, sr / 2 - 100)
    if high_freq <= low_freq:
        return audio
    sos_bp = butter(2, [low_freq, high_freq], btype='bandpass', fs=sr, output='sos')
    speech_band = sosfilt(sos_bp, audio).astype(np.float32)
    gain = 10 ** (boost_db / 20) - 1.0
    result = audio + speech_band * gain
    return np.clip(result, -1.0, 1.0).astype(np.float32)


def enhance_noise_gate(
    audio: np.ndarray,
    sr: int,
    threshold_db: float = -50.0,
    attack_ms: float = 5.0,
    release_ms: float = 150.0,
    hold_ms: float = 200.0,
) -> np.ndarray:
    win_samples = int(sr * 0.02)
    if win_samples < 1 or len(audio) < win_samples:
        return audio
    kernel = np.ones(win_samples) / win_samples
    rms_env = np.sqrt(np.convolve(audio ** 2, kernel, mode='same'))
    rms_db = 20 * np.log10(rms_env + 1e-12)
    gate = (rms_db >= threshold_db).astype(np.float32)
    hold_samples = int(sr * hold_ms / 1000)
    if hold_samples > 0:
        held_gate = np.copy(gate)
        last_open = -hold_samples - 1
        for i in range(len(gate)):
            if gate[i] > 0.5:
                last_open = i
            elif i - last_open <= hold_samples:
                held_gate[i] = 1.0
        gate = held_gate
    attack_coeff = np.exp(-1.0 / (sr * attack_ms / 1000)) if attack_ms > 0 else 0.0
    release_coeff = np.exp(-1.0 / (sr * release_ms / 1000)) if release_ms > 0 else 0.0
    smooth_gate = np.zeros_like(gate)
    smooth_gate[0] = gate[0]
    for i in range(1, len(gate)):
        if gate[i] > smooth_gate[i - 1]:
            smooth_gate[i] = attack_coeff * smooth_gate[i - 1] + (1 - attack_coeff) * gate[i]
        else:
            smooth_gate[i] = release_coeff * smooth_gate[i - 1] + (1 - release_coeff) * gate[i]
    return (audio * smooth_gate).astype(np.float32)
