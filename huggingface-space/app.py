"""
Audio Quality Metrics API - HuggingFace Space
Computes real SRMR, DNSMOS (SigMOS proxy), WVMOS, UTMOS, and Mic SR.
"""

import os
import io
import tempfile
import traceback
from typing import Optional

import numpy as np
import librosa
import soundfile as sf
from fastapi import FastAPI, File, UploadFile, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from scipy.signal import welch

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
        # Patch torch.load BEFORE importing wvmos so its internal
        # imports also pick up the patched version.
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

        # The pip package "speechmos" (DNSMOS-only) shadows the torch.hub
        # repo's "speechmos" package which contains utmos22.  Temporarily
        # remove the pip version from sys.modules so torch.hub can load
        # its own speechmos.utmos22 sub-module.
        saved_modules = {k: v for k, v in sys.modules.items() if k.startswith('speechmos')}
        for k in saved_modules:
            del sys.modules[k]

        try:
            _utmos_predictor = torch.hub.load(
                "tarepan/SpeechMOS:v1.2.0", "utmos22_strong", trust_repo=True
            )
        finally:
            torch.load = _original_load
            # Restore the pip speechmos so DNSMOS keeps working
            sys.modules.update(saved_modules)
    return _utmos_predictor


# ---------------------------------------------------------------------------
# Metric computation helpers
# ---------------------------------------------------------------------------

def compute_srmr(audio: np.ndarray, sr: int) -> Optional[float]:
    """Compute Speech-to-Reverberation Modulation Energy Ratio."""
    try:
        srmr_fn = get_srmr()
        # SRMRpy expects 8kHz or 16kHz
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
    """
    Compute DNSMOS P.835 scores (used as SigMOS proxy).
    Returns SIG (speech quality), BAK (background quality), OVRL (overall).
    Mapping: SIG → sigmos_disc, BAK → sigmos_reverb, OVRL → sigmos_ovrl
    DNSMOS requires 16kHz audio - we resample if needed.
    """
    try:
        dnsmos = get_dnsmos()
        target_sr = 16000
        if sr != target_sr:
            # Resample audio to 16kHz and save to temp file
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
        # result can be a DataFrame or a dict depending on speechmos version
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
    """Compute WV-MOS (wav2vec 2.0 fine-tuned MOS predictor)."""
    try:
        model = get_wvmos()
        score = model.calculate_one(filepath)
        return round(float(score), 4)
    except Exception as e:
        print(f"WVMOS error: {e}")
        return None


def compute_utmos(audio: np.ndarray, sr: int) -> Optional[float]:
    """Compute UTMOS (UTokyo-SaruLab MOS predictor)."""
    try:
        import torch
        predictor = get_utmos()
        # UTMOS expects 16kHz
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
    """
    Estimate the effective microphone sample rate by finding
    the frequency where the power spectrum drops significantly.
    This detects if audio was upsampled from a lower rate.
    """
    try:
        freqs, psd = welch(audio, fs=sr, nperseg=min(4096, len(audio)))
        # Normalize PSD
        psd_db = 10 * np.log10(psd + 1e-12)
        max_db = np.max(psd_db)
        
        # Find where energy drops more than 40dB below peak
        threshold = max_db - 40
        active = psd_db > threshold
        
        if not np.any(active):
            return sr
        
        # Find the highest frequency with significant energy
        last_active_idx = np.where(active)[0][-1]
        effective_max_freq = freqs[last_active_idx]
        
        # Nyquist: effective SR = 2 * max_freq
        effective_sr = int(effective_max_freq * 2)
        
        # Round to nearest standard sample rate
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
    """
    Compute a composite VQScore (0-100) from available metrics.
    VQScore's original model requires a trained VQVAE which is impractical
    for a lightweight API. This composite approximation uses the available
    real metrics to produce a 0-100 quality score.
    """
    scores = []
    weights = []

    if utmos is not None:
        # UTMOS 1-5 → 0-100
        scores.append((utmos - 1.0) / 4.0 * 100.0)
        weights.append(0.35)

    if wvmos is not None:
        # WVMOS 1-5 → 0-100
        scores.append((wvmos - 1.0) / 4.0 * 100.0)
        weights.append(0.30)

    if sigmos_ovrl is not None:
        # SigMOS OVRL 1-5 → 0-100
        scores.append((sigmos_ovrl - 1.0) / 4.0 * 100.0)
        weights.append(0.25)

    if srmr is not None:
        # SRMR: map 0-25dB → 0-100 (capped)
        srmr_norm = min(srmr / 25.0, 1.0) * 100.0
        scores.append(srmr_norm)
        weights.append(0.10)

    if not scores:
        return None

    total_weight = sum(weights)
    composite = sum(s * w for s, w in zip(scores, weights)) / total_weight
    return round(max(0.0, min(100.0, composite)), 2)


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

    # Read uploaded file
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    # Save to temp file (needed by some models)
    suffix = ".wav"
    if file.filename and file.filename.lower().endswith(".mp3"):
        suffix = ".mp3"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Load audio
        audio, sr = librosa.load(tmp_path, sr=None, mono=True)
        
        # If MP3, re-save as WAV for models that need WAV
        wav_path = tmp_path
        if suffix == ".mp3":
            wav_path = tmp_path.replace(".mp3", ".wav")
            sf.write(wav_path, audio, sr)

        # Compute all metrics
        srmr_val = compute_srmr(audio, sr)
        dnsmos_vals = compute_dnsmos(wav_path, sr)
        wvmos_val = compute_wvmos(wav_path)
        utmos_val = compute_utmos(audio, sr)
        mic_sr = estimate_mic_sample_rate(audio, sr)

        # Composite VQScore
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
        }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        # Cleanup temp files
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
