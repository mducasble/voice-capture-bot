"""
Audio Quality Metrics API - HuggingFace Space
Computes real SRMR, SigMOS (P.804 ONNX), WVMOS, UTMOS, VQScore (VQVAE), and Mic SR.
Also provides audio enhancement (post-processing) via /enhance endpoint.

Aligned with TTS_Validation reference:
  https://github.com/ashishnoel-KGeN/TTS_Validation
"""

import os
import io
import tempfile
import traceback
from typing import Optional

import numpy as np
import librosa
import soundfile as sf
from fastapi import FastAPI, File, UploadFile, Header, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from scipy.signal import welch, butter, sosfilt

# ---------------------------------------------------------------------------
# Global model cache (loaded once at startup)
# ---------------------------------------------------------------------------
_srmr_fn = None
_sigmos_model = None
_wvmos_model = None
_utmos_predictor = None
_vqscore_loaded = False

API_SECRET = os.environ.get("API_SECRET", "")

# Model paths (downloaded at Docker build time)
SIGMOS_MODEL_PATH = os.environ.get("SIGMOS_MODEL_PATH", "models/weights/sigmos.onnx")
VQSCORE_CONFIG_PATH = os.environ.get("VQSCORE_CONFIG_PATH", "models/vqscore_config.yaml")
VQSCORE_CHECKPOINT_PATH = os.environ.get("VQSCORE_CHECKPOINT_PATH", "models/weights/vqscore_checkpoint.pkl")

app = FastAPI(title="Audio Quality Metrics API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _verify_auth(authorization: Optional[str]):
    """Simple bearer token check."""
    if not API_SECRET:
        return  # No secret configured = open access
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization[len("Bearer "):]
    if token != API_SECRET:
        raise HTTPException(status_code=403, detail="Invalid API secret")


# ---------------------------------------------------------------------------
# Lazy model loaders
# ---------------------------------------------------------------------------

def get_srmr():
    global _srmr_fn
    if _srmr_fn is None:
        from srmrpy.srmr import srmr
        _srmr_fn = srmr
    return _srmr_fn


def get_sigmos():
    global _sigmos_model
    if _sigmos_model is None:
        from models.sigmos import SigMOS
        if not os.path.exists(SIGMOS_MODEL_PATH):
            print(f"WARNING: SigMOS model not found at {SIGMOS_MODEL_PATH}")
            return None
        _sigmos_model = SigMOS(model_path=SIGMOS_MODEL_PATH)
        print("SigMOS P.804 model loaded")
    return _sigmos_model


def get_wvmos():
    global _wvmos_model
    if _wvmos_model is None:
        import torch
        _original_load = torch.load
        def _patched_load(*args, **kwargs):
            kwargs['weights_only'] = False
            kwargs['map_location'] = torch.device('cpu')
            return _original_load(*args, **kwargs)
        torch.load = _patched_load
        try:
            from wvmos import get_wvmos as _init_wvmos
            _wvmos_model = _init_wvmos(cuda=False)
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
            kwargs['map_location'] = torch.device('cpu')
            return _original_load(*args, **kwargs)
        torch.load = _patched_load

        saved_modules = {k: v for k, v in sys.modules.items() if k.startswith('speechmos')}
        for k in saved_modules:
            del sys.modules[k]

        try:
            _utmos_predictor = torch.hub.load(
                "tarepan/SpeechMOS:v1.2.0", "utmos22_strong", trust_repo=True
            )
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
        kwargs['map_location'] = torch.device('cpu')
        return _original_load(*args, **kwargs)
    torch.load = _patched_load
    try:
        from models.vqscore import load_model
        load_model(VQSCORE_CONFIG_PATH, VQSCORE_CHECKPOINT_PATH)
        _vqscore_loaded = True
    except Exception as e:
        print(f"VQScore load error: {e}")
        traceback.print_exc()
    finally:
        torch.load = _original_load
    return _vqscore_loaded


# ---------------------------------------------------------------------------
# Metric computation helpers
# ---------------------------------------------------------------------------

def compute_snr_vad(audio: np.ndarray, sr: int) -> Optional[float]:
    """Estimate SNR using simple VAD (energy-based)."""
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
        print(f"SNR estimation error: {e}")
        return None


def compute_rms_dbfs(audio: np.ndarray) -> Optional[float]:
    """Compute RMS level in dBFS."""
    try:
        rms = np.sqrt(np.mean(audio ** 2))
        if rms < 1e-12:
            return None
        return round(float(20 * np.log10(rms)), 1)
    except Exception as e:
        print(f"RMS error: {e}")
        return None


def compute_srmr(audio: np.ndarray, sr: int) -> Optional[float]:
    """Compute SRMR using shimhz/SRMRpy fork (aligned with TTS_Validation)."""
    try:
        srmr_fn = get_srmr()
        target_sr = 16000
        if sr != target_sr:
            audio_rs = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
        else:
            audio_rs = audio

        # Ensure float and normalize if integer
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
    """Compute SigMOS using P.804 ONNX model (aligned with TTS_Validation)."""
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
        traceback.print_exc()
        return {"sigmos_disc": None, "sigmos_reverb": None, "sigmos_ovrl": None}


def compute_wvmos(filepath: str) -> Optional[float]:
    """Compute WVMOS on a single file. For chunked computation use compute_wvmos_chunked."""
    try:
        model = get_wvmos()
        score = model.calculate_one(filepath)
        return round(float(score), 4)
    except Exception as e:
        print(f"WVMOS error: {e}")
        return None


def compute_wvmos_chunked(audio: np.ndarray, sr: int, chunk_seconds: float = 10.0) -> Optional[float]:
    """Compute WVMOS by splitting audio into small chunks and averaging.
    This avoids artifacts from discontinuities in pre-sampled/concatenated audio.
    Aligned with TTS_Validation which processes chunks independently."""
    try:
        model = get_wvmos()
        chunk_samples = int(chunk_seconds * sr)
        total_samples = len(audio)

        if total_samples < sr:  # Less than 1 second, skip
            return None

        scores = []
        num_chunks = max(1, total_samples // chunk_samples)

        for i in range(num_chunks):
            start = i * chunk_samples
            end = min(start + chunk_samples, total_samples)
            chunk = audio[start:end]

            if len(chunk) < sr:  # Skip chunks shorter than 1 second
                continue

            # Write chunk to temp file for wvmos
            chunk_path = os.path.join(tempfile.gettempdir(), f"wvmos_auto_chunk_{i}.wav")
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
        print(f"WVMOS chunked error: {e}")
        traceback.print_exc()
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
        score = predictor(wave, target_sr)
        return round(float(score.item()), 4)
    except Exception as e:
        print(f"UTMOS error: {e}")
        return None


def compute_vqscore(filepath: str) -> Optional[float]:
    """Compute VQScore using real VQVAE model (aligned with TTS_Validation).
    Returns value typically in range 0 to ~0.81 (cosine similarity)."""
    try:
        if not load_vqscore():
            return None
        from models.vqscore import calculate_vqscore
        return calculate_vqscore(filepath)
    except Exception as e:
        print(f"VQScore error: {e}")
        return None


def estimate_mic_sample_rate(audio: np.ndarray, sr: int) -> Optional[int]:
    """Estimate effective mic bandwidth using max-hold spectrum (aligned with TTS_Validation)."""
    try:
        # Use STFT max-hold approach (matches reference samplerate_metric.py)
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
        print(f"Mic SR estimation error: {e}")
        return None


# ---------------------------------------------------------------------------
# Sampling logic for large files (aligned with TTS_Validation: 5 x 30s chunks)
# ---------------------------------------------------------------------------

def sample_audio_chunks(audio: np.ndarray, sr: int, duration: float,
                        num_chunks: int = 5, chunk_duration: float = 30.0):
    """
    For files > 3 minutes, extract representative chunks distributed across the file.
    Returns list of (audio_chunk, sr) tuples.
    """
    if duration <= 180:  # <= 3 minutes, use full file
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


# ---------------------------------------------------------------------------
# Audio Enhancement helpers (unchanged)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return {"status": "ok", "service": "Audio Quality Metrics API", "version": "2.0-aligned"}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze_audio(
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
):
    """
    Analyze an audio file and return all quality metrics.
    For files > 3 minutes, uses 5x30s sampling (aligned with TTS_Validation).
    """
    _verify_auth(authorization)

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    suffix = ".wav"
    if file.filename and file.filename.lower().endswith(".mp3"):
        suffix = ".mp3"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        audio, sr = librosa.load(tmp_path, sr=None, mono=True)
        duration = len(audio) / sr

        wav_path = tmp_path
        if suffix == ".mp3":
            wav_path = tmp_path.replace(".mp3", ".wav")
            sf.write(wav_path, audio, sr)

        # Determine sampling mode
        is_sampled = duration > 180
        chunks = sample_audio_chunks(audio, sr, duration)

        # --- SRMR (averaged over chunks) ---
        srmr_scores = []
        for chunk_audio, chunk_sr in chunks:
            s = compute_srmr(chunk_audio, chunk_sr)
            if s is not None:
                srmr_scores.append(s)
        srmr_val = round(float(np.mean(srmr_scores)), 4) if srmr_scores else None

        # --- SigMOS (averaged over chunks) ---
        sigmos_accum = {"sigmos_disc": [], "sigmos_reverb": [], "sigmos_ovrl": []}
        for chunk_audio, chunk_sr in chunks:
            result = compute_sigmos(chunk_audio, chunk_sr)
            for k in sigmos_accum:
                if result.get(k) is not None:
                    sigmos_accum[k].append(result[k])

        sigmos_vals = {
            k: round(float(np.mean(v)), 4) if v else None
            for k, v in sigmos_accum.items()
        }

        # --- VQScore (averaged over chunk files) ---
        vq_scores = []
        chunk_paths = []
        for i, (chunk_audio, chunk_sr) in enumerate(chunks):
            if is_sampled:
                chunk_path = os.path.join(tempfile.gettempdir(), f"vq_chunk_{i}.wav")
                sf.write(chunk_path, chunk_audio, chunk_sr)
                chunk_paths.append(chunk_path)
                s = compute_vqscore(chunk_path)
            else:
                s = compute_vqscore(wav_path)
            if s is not None:
                vq_scores.append(s)
            if not is_sampled:
                break  # Only one chunk for short files
        vqscore_val = round(float(np.mean(vq_scores)), 4) if vq_scores else None

        # --- WVMOS (always chunked to avoid discontinuity artifacts) ---
        # Uses compute_wvmos_chunked which splits audio into 10s segments
        # This prevents low scores from concatenated pre-sampled audio
        wvmos_scores = []
        for chunk_audio, chunk_sr in chunks:
            s = compute_wvmos_chunked(chunk_audio, chunk_sr, chunk_seconds=10.0)
            if s is not None:
                wvmos_scores.append(s)
        wvmos_val = round(float(np.mean(wvmos_scores)), 4) if wvmos_scores else None

        # --- UTMOS (averaged over chunks, extra metric) ---
        utmos_scores = []
        for chunk_audio, chunk_sr in chunks:
            s = compute_utmos(chunk_audio, chunk_sr)
            if s is not None:
                utmos_scores.append(s)
        utmos_val = round(float(np.mean(utmos_scores)), 4) if utmos_scores else None

        # --- Mic SR & SNR & RMS (full file) ---
        mic_sr = estimate_mic_sample_rate(audio, sr)
        snr_val = compute_snr_vad(audio, sr)
        rms_val = compute_rms_dbfs(audio)

        # Cleanup chunk temp files
        for p in chunk_paths:
            try:
                os.unlink(p)
            except OSError:
                pass

        return {
            "srmr": srmr_val,
            "sigmos_disc": sigmos_vals.get("sigmos_disc"),
            "sigmos_ovrl": sigmos_vals.get("sigmos_ovrl"),
            "sigmos_reverb": sigmos_vals.get("sigmos_reverb"),
            "vqscore": vqscore_val,
            "wvmos": wvmos_val,
            "utmos": utmos_val,
            "mic_sr": mic_sr,
            "file_sr": sr,
            "snr_db": snr_val,
            "rms_dbfs": rms_val,
            "analysis_mode": "sampled_5x30s" if is_sampled else "full",
            "duration_seconds": round(duration, 1),
        }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        if suffix == ".mp3":
            try:
                os.unlink(tmp_path.replace(".mp3", ".wav"))
            except OSError:
                pass


@app.post("/enhance")
async def enhance_audio(
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
    normalize: Optional[str] = Form("true"),
    highpass: Optional[str] = Form("true"),
    highpass_freq: Optional[str] = Form("80"),
    lowpass: Optional[str] = Form("false"),
    lowpass_freq: Optional[str] = Form("16000"),
    speech_eq: Optional[str] = Form("true"),
    speech_eq_boost_db: Optional[str] = Form("1.5"),
    noise_gate: Optional[str] = Form("true"),
    noise_gate_threshold_db: Optional[str] = Form("-50"),
    target_lufs: Optional[str] = Form("-23"),
    output_format: Optional[str] = Form("wav"),
):
    """
    Enhance an audio file with post-processing.
    Returns the enhanced WAV file as a binary stream.
    """
    _verify_auth(authorization)

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    suffix = ".wav"
    if file.filename and file.filename.lower().endswith(".mp3"):
        suffix = ".mp3"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        audio, sr = librosa.load(tmp_path, sr=None, mono=True)
        original_rms = float(20 * np.log10(np.sqrt(np.mean(audio ** 2)) + 1e-12))

        steps_applied = []

        if highpass == "true":
            hp_freq = float(highpass_freq)
            audio = enhance_highpass(audio, sr, hp_freq)
            steps_applied.append(f"highpass_{hp_freq}Hz")

        if lowpass == "true":
            lp_freq = float(lowpass_freq)
            audio = enhance_lowpass(audio, sr, lp_freq)
            steps_applied.append(f"lowpass_{lp_freq}Hz")

        if noise_gate == "true":
            ng_thresh = float(noise_gate_threshold_db)
            audio = enhance_noise_gate(audio, sr, threshold_db=ng_thresh)
            steps_applied.append(f"noise_gate_{ng_thresh}dB")

        if speech_eq == "true":
            eq_boost = float(speech_eq_boost_db)
            audio = enhance_speech_eq(audio, sr, boost_db=eq_boost)
            steps_applied.append(f"speech_eq_{eq_boost}dB")

        if normalize == "true":
            tgt = float(target_lufs)
            audio = enhance_normalize_lufs(audio, target_lufs=tgt)
            steps_applied.append(f"normalize_{tgt}LUFS")

        final_rms = float(20 * np.log10(np.sqrt(np.mean(audio ** 2)) + 1e-12))
        print(f"[Enhance] RMS: {original_rms:.1f} dBFS → {final_rms:.1f} dBFS | Steps: {', '.join(steps_applied)}")

        wav_buffer = io.BytesIO()
        sf.write(wav_buffer, audio, sr, format='WAV', subtype='PCM_16')
        wav_buffer.seek(0)

        return StreamingResponse(
            wav_buffer,
            media_type="audio/wav",
            headers={
                "Content-Disposition": f'attachment; filename="enhanced.wav"',
                "X-Enhancement-Steps": ",".join(steps_applied),
                "X-Original-RMS": f"{original_rms:.2f}",
                "X-Enhanced-RMS": f"{final_rms:.2f}",
                "X-Sample-Rate": str(sr),
            },
        )

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        if suffix == ".mp3":
            try:
                os.unlink(tmp_path.replace(".mp3", ".wav"))
            except OSError:
                pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
