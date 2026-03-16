"""
Shared metric computation functions.
All models are loaded lazily and cached in global variables.
"""

import os
import tempfile
import traceback
from typing import Optional, List, Tuple

import numpy as np
import librosa
import soundfile as sf

# ---------------------------------------------------------------------------
# Global model cache
# ---------------------------------------------------------------------------
_srmr_fn = None
_sigmos_model = None
_wvmos_model = None
_utmos_predictor = None
_vqscore_loaded = False

SIGMOS_MODEL_PATH = os.environ.get("SIGMOS_MODEL_PATH", "models/weights/sigmos.onnx")
VQSCORE_CONFIG_PATH = os.environ.get("VQSCORE_CONFIG_PATH", "models/vqscore_config.yaml")
VQSCORE_CHECKPOINT_PATH = os.environ.get("VQSCORE_CHECKPOINT_PATH", "models/weights/vqscore_checkpoint.pkl")


# ---------------------------------------------------------------------------
# Model loaders
# ---------------------------------------------------------------------------

def get_srmr():
    global _srmr_fn
    if _srmr_fn is None:
        from srmrpy.srmr import srmr
        _srmr_fn = srmr
        print("✓ SRMR loaded")
    return _srmr_fn


def get_sigmos():
    global _sigmos_model
    if _sigmos_model is None:
        from models.sigmos import SigMOS
        if not os.path.exists(SIGMOS_MODEL_PATH):
            print(f"WARNING: SigMOS model not found at {SIGMOS_MODEL_PATH}")
            return None
        _sigmos_model = SigMOS(model_path=SIGMOS_MODEL_PATH)
        print("✓ SigMOS P.804 loaded")
    return _sigmos_model


def get_wvmos():
    global _wvmos_model
    if _wvmos_model is None:
        import torch
        _original_load = torch.load
        def _patched_load(*args, **kwargs):
            kwargs['weights_only'] = False
            kwargs['map_location'] = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            return _original_load(*args, **kwargs)
        torch.load = _patched_load
        try:
            from wvmos import get_wvmos as _init_wvmos
            _wvmos_model = _init_wvmos(cuda=torch.cuda.is_available())
            print(f"✓ WVMOS loaded (CUDA: {torch.cuda.is_available()})")
        finally:
            torch.load = _original_load
    return _wvmos_model


def get_utmos():
    global _utmos_predictor
    if _utmos_predictor is None:
        import sys
        import torch

        _original_load = torch.load
        def _patched_load(*args, **kwargs):
            kwargs['weights_only'] = False
            kwargs['map_location'] = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            return _original_load(*args, **kwargs)
        torch.load = _patched_load

        saved_modules = {k: v for k, v in sys.modules.items() if k.startswith('speechmos')}
        for k in saved_modules:
            del sys.modules[k]

        try:
            _utmos_predictor = torch.hub.load(
                "tarepan/SpeechMOS:v1.2.0", "utmos22_strong", trust_repo=True
            )
            if torch.cuda.is_available():
                _utmos_predictor = _utmos_predictor.cuda()
            print(f"✓ UTMOS loaded (CUDA: {torch.cuda.is_available()})")
        finally:
            torch.load = _original_load
            sys.modules.update(saved_modules)
    return _utmos_predictor


def load_vqscore():
    global _vqscore_loaded
    if _vqscore_loaded:
        return True
    if not os.path.exists(VQSCORE_CHECKPOINT_PATH):
        print(f"WARNING: VQScore checkpoint not found at {VQSCORE_CHECKPOINT_PATH}")
        return False
    if not os.path.exists(VQSCORE_CONFIG_PATH):
        print(f"WARNING: VQScore config not found at {VQSCORE_CONFIG_PATH}")
        return False

    import torch
    _original_load = torch.load
    def _patched_load(*args, **kwargs):
        kwargs['weights_only'] = False
        kwargs['map_location'] = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        return _original_load(*args, **kwargs)
    torch.load = _patched_load
    try:
        from models.vqscore import load_model
        load_model(VQSCORE_CONFIG_PATH, VQSCORE_CHECKPOINT_PATH)
        _vqscore_loaded = True
        print("✓ VQScore loaded")
    except Exception as e:
        print(f"VQScore load error: {e}")
        traceback.print_exc()
    finally:
        torch.load = _original_load
    return _vqscore_loaded


def preload_all_models():
    """Force-load all models into RAM at startup."""
    get_srmr()
    get_sigmos()
    get_wvmos()
    get_utmos()
    load_vqscore()


# ---------------------------------------------------------------------------
# Metric computation
# ---------------------------------------------------------------------------

def compute_snr_vad(audio: np.ndarray, sr: int) -> Optional[float]:
    try:
        frame_len = int(sr * 0.02)
        if len(audio) < frame_len:
            return None
        num_frames = len(audio) // frame_len
        frames = audio[:num_frames * frame_len].reshape(num_frames, frame_len)
        frame_rms = np.sqrt(np.mean(frames ** 2, axis=1))
        frame_db = 20 * np.log10(frame_rms + 1e-12)
        sorted_db = np.sort(frame_db)
        noise_floor = np.mean(sorted_db[:max(1, len(sorted_db) // 10)])
        threshold = noise_floor + 15
        speech_mask = frame_db > threshold
        if not np.any(speech_mask) or not np.any(~speech_mask):
            return None
        speech_rms = np.sqrt(np.mean(frames[speech_mask] ** 2))
        noise_rms = np.sqrt(np.mean(frames[~speech_mask] ** 2))
        if noise_rms < 1e-12:
            return None
        snr = 20 * np.log10(speech_rms / noise_rms)
        return round(float(snr), 1)
    except Exception as e:
        print(f"SNR error: {e}")
        return None


def compute_rms_dbfs(audio: np.ndarray) -> Optional[float]:
    try:
        rms = np.sqrt(np.mean(audio ** 2))
        if rms < 1e-12:
            return None
        return round(float(20 * np.log10(rms)), 1)
    except Exception as e:
        print(f"RMS error: {e}")
        return None


def compute_srmr(audio: np.ndarray, sr: int) -> Optional[float]:
    try:
        srmr_fn = get_srmr()
        target_sr = 16000
        if sr != target_sr:
            audio_rs = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
        else:
            audio_rs = audio
        if np.issubdtype(audio_rs.dtype, np.integer):
            audio_rs = audio_rs.astype('float') / np.iinfo(audio_rs.dtype).max
        score = srmr_fn(audio_rs, target_sr)
        if isinstance(score, (tuple, list, np.ndarray)) and len(score) > 0:
            score = score[0]
        return round(float(score), 4)
    except Exception as e:
        print(f"SRMR error: {e}")
        return None


def compute_sigmos(audio: np.ndarray, sr: int) -> dict:
    try:
        estimator = get_sigmos()
        if estimator is None:
            return {"sigmos_disc": None, "sigmos_reverb": None, "sigmos_ovrl": None}
        result = estimator.run(audio, sr=sr)
        return {
            "sigmos_disc": round(result['MOS_DISC'], 4),
            "sigmos_reverb": round(result['MOS_REVERB'], 4),
            "sigmos_ovrl": round(result['MOS_OVRL'], 4),
        }
    except Exception as e:
        print(f"SigMOS error: {e}")
        return {"sigmos_disc": None, "sigmos_reverb": None, "sigmos_ovrl": None}


def compute_wvmos_chunked(audio: np.ndarray, sr: int, chunk_seconds: float = 10.0) -> Optional[float]:
    try:
        model = get_wvmos()
        chunk_samples = int(chunk_seconds * sr)
        total_samples = len(audio)
        if total_samples < sr:
            return None
        scores = []
        num_chunks = max(1, total_samples // chunk_samples)
        for i in range(num_chunks):
            start = i * chunk_samples
            end = min(start + chunk_samples, total_samples)
            chunk = audio[start:end]
            if len(chunk) < sr:
                continue
            chunk_path = os.path.join(tempfile.gettempdir(), f"wvmos_chunk_{os.getpid()}_{i}.wav")
            sf.write(chunk_path, chunk, sr)
            try:
                score = model.calculate_one(chunk_path)
                if score is not None:
                    scores.append(float(score))
            finally:
                try:
                    os.unlink(chunk_path)
                except OSError:
                    pass
        if not scores:
            return None
        return round(float(np.mean(scores)), 4)
    except Exception as e:
        print(f"WVMOS error: {e}")
        return None


def compute_utmos(audio: np.ndarray, sr: int) -> Optional[float]:
    try:
        import torch
        predictor = get_utmos()
        target_sr = 16000
        if sr != target_sr:
            audio_rs = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
        else:
            audio_rs = audio
        wave = torch.from_numpy(audio_rs).unsqueeze(0).float()
        if torch.cuda.is_available():
            wave = wave.cuda()
        score = predictor(wave, target_sr)
        return round(float(score.item()), 4)
    except Exception as e:
        print(f"UTMOS error: {e}")
        return None


def compute_vqscore(filepath: str) -> Optional[float]:
    try:
        if not load_vqscore():
            return None
        from models.vqscore import calculate_vqscore
        return calculate_vqscore(filepath)
    except Exception as e:
        print(f"VQScore error: {e}")
        return None


def estimate_mic_sample_rate(audio: np.ndarray, sr: int) -> Optional[int]:
    try:
        S_full, phase = librosa.magphase(librosa.stft(audio))
        S_max = np.max(S_full, axis=1)
        S_ref = np.max(S_max)
        if S_ref == 0:
            return sr
        S_db = librosa.amplitude_to_db(S_max, ref=S_ref)
        threshold_db = -80.0
        fft_freqs = librosa.fft_frequencies(sr=sr)
        valid_indices = np.where(S_db > threshold_db)[0]
        if len(valid_indices) == 0:
            return sr
        max_freq_idx = valid_indices[-1]
        effective_bandwidth = fft_freqs[max_freq_idx]
        effective_sr = int(effective_bandwidth * 2)
        standard_rates = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 96000]
        closest = min(standard_rates, key=lambda r: abs(r - effective_sr))
        return closest
    except Exception as e:
        print(f"Mic SR error: {e}")
        return None


# ---------------------------------------------------------------------------
# Sampling for large files
# ---------------------------------------------------------------------------

def sample_audio_chunks(
    audio: np.ndarray, sr: int, duration: float,
    num_chunks: int = 5, chunk_duration: float = 30.0
) -> List[Tuple[np.ndarray, int]]:
    if duration <= 180:
        return [(audio, sr)]
    chunks = []
    segment_length = duration / num_chunks
    for i in range(num_chunks):
        segment_center = (i * segment_length) + (segment_length / 2)
        start_time = max(0, segment_center - (chunk_duration / 2))
        if start_time + chunk_duration > duration:
            start_time = max(0, duration - chunk_duration)
        start_sample = int(start_time * sr)
        end_sample = min(int((start_time + chunk_duration) * sr), len(audio))
        if end_sample > start_sample:
            chunks.append((audio[start_sample:end_sample], sr))
    return chunks if chunks else [(audio, sr)]
