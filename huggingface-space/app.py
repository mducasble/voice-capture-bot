"""
Audio Quality Metrics API - HuggingFace Space
Computes real SRMR, DNSMOS (SigMOS proxy), WVMOS, UTMOS, and Mic SR.
Also provides audio enhancement (post-processing) via /enhance endpoint.
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
_dnsmos_model = None
_wvmos_model = None
_utmos_predictor = None

API_SECRET = os.environ.get("API_SECRET", "")

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
        from srmrpy import srmr
        _srmr_fn = srmr
    return _srmr_fn


def get_dnsmos():
    global _dnsmos_model
    if _dnsmos_model is None:
        from speechmos import dnsmos
        _dnsmos_model = dnsmos
    return _dnsmos_model


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


# ---------------------------------------------------------------------------
# Metric computation helpers
# ---------------------------------------------------------------------------

def compute_snr_vad(audio: np.ndarray, sr: int) -> Optional[float]:
    """Estimate SNR using simple VAD (energy-based) similar to process-audio Edge Function."""
    try:
        # Frame-level RMS (20ms frames)
        frame_len = int(sr * 0.02)
        if len(audio) < frame_len:
            return None
        num_frames = len(audio) // frame_len
        frames = audio[:num_frames * frame_len].reshape(num_frames, frame_len)
        frame_rms = np.sqrt(np.mean(frames ** 2, axis=1))
        frame_db = 20 * np.log10(frame_rms + 1e-12)

        # Adaptive threshold: noise floor + 15dB
        sorted_db = np.sort(frame_db)
        noise_floor = np.mean(sorted_db[:max(1, len(sorted_db) // 10)])  # bottom 10%
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
    try:
        srmr_fn = get_srmr()
        target_sr = 16000
        if sr != target_sr:
            audio_rs = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
        else:
            audio_rs = audio
        ratio, _ = srmr_fn(audio_rs, target_sr)
        return round(float(ratio), 4)
    except Exception as e:
        print(f"SRMR error: {e}")
        return None


def compute_dnsmos(filepath: str, sr: int) -> dict:
    try:
        dnsmos = get_dnsmos()
        target_sr = 16000
        if sr != target_sr:
            audio_data, _ = librosa.load(filepath, sr=target_sr, mono=True)
            resampled_path = filepath + ".16k.wav"
            sf.write(resampled_path, audio_data, target_sr)
            result = dnsmos.run(resampled_path, sr=target_sr, verbose=False)
            try:
                os.unlink(resampled_path)
            except OSError:
                pass
        else:
            result = dnsmos.run(filepath, sr=target_sr, verbose=False)
        if hasattr(result, 'iloc'):
            row = result.iloc[0]
            sig, bak, ovrl = float(row["SIG"]), float(row["BAK"]), float(row["OVRL"])
        elif isinstance(result, dict):
            sig = float(result.get("sig_mos", result.get("SIG", 0)))
            bak = float(result.get("bak_mos", result.get("BAK", 0)))
            ovrl = float(result.get("ovr_mos", result.get("OVRL", result.get("ovrl_mos", 0))))
        else:
            raise ValueError(f"Unexpected DNSMOS result type: {type(result)}")
        return {
            "sigmos_disc": round(sig, 4),
            "sigmos_reverb": round(bak, 4),
            "sigmos_ovrl": round(ovrl, 4),
        }
    except Exception as e:
        print(f"DNSMOS error: {e}")
        traceback.print_exc()
        return {"sigmos_disc": None, "sigmos_reverb": None, "sigmos_ovrl": None}


def compute_wvmos(filepath: str) -> Optional[float]:
    try:
        model = get_wvmos()
        score = model.calculate_one(filepath)
        return round(float(score), 4)
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
        score = predictor(wave, target_sr)
        return round(float(score.item()), 4)
    except Exception as e:
        print(f"UTMOS error: {e}")
        return None


def estimate_mic_sample_rate(audio: np.ndarray, sr: int) -> Optional[int]:
    try:
        freqs, psd = welch(audio, fs=sr, nperseg=min(4096, len(audio)))
        psd_db = 10 * np.log10(psd + 1e-12)
        max_db = np.max(psd_db)
        threshold = max_db - 40
        active = psd_db > threshold
        if not np.any(active):
            return sr
        last_active_idx = np.where(active)[0][-1]
        effective_max_freq = freqs[last_active_idx]
        effective_sr = int(effective_max_freq * 2)
        standard_rates = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 96000]
        closest = min(standard_rates, key=lambda r: abs(r - effective_sr))
        return closest
    except Exception as e:
        print(f"Mic SR estimation error: {e}")
        return None


def compute_vqscore_composite(
    srmr: Optional[float],
    sigmos_ovrl: Optional[float],
    wvmos: Optional[float],
    utmos: Optional[float],
) -> Optional[float]:
    scores = []
    weights = []

    if utmos is not None:
        scores.append((utmos - 1.0) / 4.0 * 100.0)
        weights.append(0.35)

    if wvmos is not None:
        scores.append((wvmos - 1.0) / 4.0 * 100.0)
        weights.append(0.30)

    if sigmos_ovrl is not None:
        scores.append((sigmos_ovrl - 1.0) / 4.0 * 100.0)
        weights.append(0.25)

    if srmr is not None:
        srmr_norm = min(srmr / 25.0, 1.0) * 100.0
        scores.append(srmr_norm)
        weights.append(0.10)

    if not scores:
        return None

    total_weight = sum(weights)
    composite = sum(s * w for s, w in zip(scores, weights)) / total_weight
    return round(max(0.0, min(100.0, composite)), 2)


# ---------------------------------------------------------------------------
# Audio Enhancement helpers
# ---------------------------------------------------------------------------

def enhance_normalize_lufs(audio: np.ndarray, target_lufs: float = -23.0) -> np.ndarray:
    """Normalize audio loudness to target LUFS (RMS-based approximation)."""
    # Calculate current RMS in dBFS
    rms = np.sqrt(np.mean(audio ** 2))
    if rms < 1e-10:
        return audio
    current_db = 20 * np.log10(rms)
    # LUFS ≈ dBFS for mono speech (simplified)
    gain_db = target_lufs - current_db
    gain = 10 ** (gain_db / 20)
    # Apply gain with hard clipping protection
    result = audio * gain
    return np.clip(result, -1.0, 1.0)


def enhance_highpass(audio: np.ndarray, sr: int, cutoff: float = 80.0) -> np.ndarray:
    """Apply highpass filter to remove rumble/low-frequency noise."""
    if cutoff <= 0 or cutoff >= sr / 2:
        return audio
    sos = butter(4, cutoff, btype='highpass', fs=sr, output='sos')
    return sosfilt(sos, audio).astype(np.float32)


def enhance_lowpass(audio: np.ndarray, sr: int, cutoff: float = 16000.0) -> np.ndarray:
    """Apply lowpass filter to remove high-frequency noise above mic bandwidth."""
    if cutoff <= 0 or cutoff >= sr / 2:
        return audio
    sos = butter(4, cutoff, btype='lowpass', fs=sr, output='sos')
    return sosfilt(sos, audio).astype(np.float32)


def enhance_speech_eq(audio: np.ndarray, sr: int, boost_db: float = 3.0) -> np.ndarray:
    """
    Boost speech presence frequencies (1-4kHz) using a bandpass shelf.
    This improves speech clarity and SigMOS scores.
    """
    if boost_db <= 0:
        return audio
    # Create bandpass for 1-4kHz
    low_freq = 1000.0
    high_freq = min(4000.0, sr / 2 - 100)
    if high_freq <= low_freq:
        return audio
    
    sos_bp = butter(2, [low_freq, high_freq], btype='bandpass', fs=sr, output='sos')
    speech_band = sosfilt(sos_bp, audio).astype(np.float32)
    
    # Mix: original + boosted speech band
    gain = 10 ** (boost_db / 20) - 1.0  # additional gain for the band
    result = audio + speech_band * gain
    return np.clip(result, -1.0, 1.0).astype(np.float32)


def enhance_noise_gate(
    audio: np.ndarray,
    sr: int,
    threshold_db: float = -40.0,
    attack_ms: float = 5.0,
    release_ms: float = 50.0,
    hold_ms: float = 100.0,
) -> np.ndarray:
    """
    Apply a smooth noise gate that silences non-speech sections.
    Uses RMS envelope with attack/release smoothing to avoid clicks.
    """
    # Compute RMS envelope with ~20ms window
    win_samples = int(sr * 0.02)
    if win_samples < 1 or len(audio) < win_samples:
        return audio
    
    # Sliding RMS
    kernel = np.ones(win_samples) / win_samples
    rms_env = np.sqrt(np.convolve(audio ** 2, kernel, mode='same'))
    rms_db = 20 * np.log10(rms_env + 1e-12)
    
    # Gate: 1.0 where above threshold, 0.0 where below
    gate = (rms_db >= threshold_db).astype(np.float32)
    
    # Hold: keep gate open for hold_ms after signal drops
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
    
    # Smooth attack/release
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
    return {"status": "ok", "service": "Audio Quality Metrics API"}


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
    Accepts WAV or MP3 files.
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
        
        wav_path = tmp_path
        if suffix == ".mp3":
            wav_path = tmp_path.replace(".mp3", ".wav")
            sf.write(wav_path, audio, sr)

        srmr_val = compute_srmr(audio, sr)
        dnsmos_vals = compute_dnsmos(wav_path, sr)
        wvmos_val = compute_wvmos(wav_path)
        utmos_val = compute_utmos(audio, sr)
        mic_sr = estimate_mic_sample_rate(audio, sr)
        snr_val = compute_snr_vad(audio, sr)
        rms_val = compute_rms_dbfs(audio)

        vqscore_val = compute_vqscore_composite(
            srmr_val,
            dnsmos_vals.get("sigmos_ovrl"),
            wvmos_val,
            utmos_val,
        )

        return {
            "srmr": srmr_val,
            "sigmos_disc": dnsmos_vals.get("sigmos_disc"),
            "sigmos_ovrl": dnsmos_vals.get("sigmos_ovrl"),
            "sigmos_reverb": dnsmos_vals.get("sigmos_reverb"),
            "vqscore": vqscore_val,
            "wvmos": wvmos_val,
            "utmos": utmos_val,
            "mic_sr": mic_sr,
            "file_sr": sr,
            "snr_db": snr_val,
            "rms_dbfs": rms_val,
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
    noise_gate_threshold_db: Optional[str] = Form("-45"),
    target_lufs: Optional[str] = Form("-23"),
    output_format: Optional[str] = Form("wav"),
):
    """
    Enhance an audio file with post-processing.
    Returns the enhanced WAV file as a binary stream.
    
    Parameters (all as form fields):
    - normalize: "true"/"false" - loudness normalization
    - highpass: "true"/"false" - highpass filter
    - highpass_freq: cutoff Hz (default 80)
    - lowpass: "true"/"false" - lowpass filter  
    - lowpass_freq: cutoff Hz (default 16000)
    - speech_eq: "true"/"false" - speech presence boost
    - speech_eq_boost_db: boost in dB (default 3)
    - noise_gate: "true"/"false" - noise gate
    - noise_gate_threshold_db: threshold in dBFS (default -40)
    - target_lufs: target loudness (default -23)
    - output_format: "wav" (only wav supported for now)
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
        # Load audio at original sample rate
        audio, sr = librosa.load(tmp_path, sr=None, mono=True)
        original_rms = float(20 * np.log10(np.sqrt(np.mean(audio ** 2)) + 1e-12))
        
        steps_applied = []

        # 1. Highpass filter (remove rumble)
        if highpass == "true":
            hp_freq = float(highpass_freq)
            audio = enhance_highpass(audio, sr, hp_freq)
            steps_applied.append(f"highpass_{hp_freq}Hz")
            print(f"[Enhance] Applied highpass filter at {hp_freq}Hz")

        # 2. Lowpass filter (remove noise above mic bandwidth)
        if lowpass == "true":
            lp_freq = float(lowpass_freq)
            audio = enhance_lowpass(audio, sr, lp_freq)
            steps_applied.append(f"lowpass_{lp_freq}Hz")
            print(f"[Enhance] Applied lowpass filter at {lp_freq}Hz")

        # 3. Noise gate (silence non-speech)
        if noise_gate == "true":
            ng_thresh = float(noise_gate_threshold_db)
            audio = enhance_noise_gate(audio, sr, threshold_db=ng_thresh)
            steps_applied.append(f"noise_gate_{ng_thresh}dB")
            print(f"[Enhance] Applied noise gate at {ng_thresh}dBFS")

        # 4. Speech EQ (boost clarity)
        if speech_eq == "true":
            eq_boost = float(speech_eq_boost_db)
            audio = enhance_speech_eq(audio, sr, boost_db=eq_boost)
            steps_applied.append(f"speech_eq_{eq_boost}dB")
            print(f"[Enhance] Applied speech EQ with {eq_boost}dB boost")

        # 5. Loudness normalization (last step to set final level)
        if normalize == "true":
            tgt = float(target_lufs)
            audio = enhance_normalize_lufs(audio, target_lufs=tgt)
            steps_applied.append(f"normalize_{tgt}LUFS")
            print(f"[Enhance] Normalized to {tgt} LUFS")

        final_rms = float(20 * np.log10(np.sqrt(np.mean(audio ** 2)) + 1e-12))
        print(f"[Enhance] RMS: {original_rms:.1f} dBFS → {final_rms:.1f} dBFS | Steps: {', '.join(steps_applied)}")

        # Write enhanced audio to WAV buffer
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
