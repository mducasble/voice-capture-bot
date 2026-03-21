"""
Audio Quality Metrics API - VPS Edition
Production-grade FastAPI service with Celery for async processing.
Compatible with the existing edge function interface (same /analyze and /enhance endpoints).
"""

import os
import io
import tempfile
import traceback
import time
from typing import Optional

import numpy as np
import librosa
import soundfile as sf
from fastapi import FastAPI, File, UploadFile, Header, HTTPException, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from scipy.signal import butter, sosfilt
import json

# ---------------------------------------------------------------------------
# Import model loaders & metric functions from the shared module
# ---------------------------------------------------------------------------
from app.metrics import (
    compute_snr_vad,
    compute_rms_dbfs,
    compute_srmr,
    compute_sigmos,
    compute_wvmos_chunked,
    compute_utmos,
    compute_vqscore,
    estimate_mic_sample_rate,
    sample_audio_chunks,
    preload_all_models,
)
from app.enhance import (
    enhance_highpass,
    enhance_lowpass,
    enhance_speech_eq,
    enhance_noise_gate,
    enhance_normalize_lufs,
)
from app.reconstruct import reconstruct_tracks, tracks_to_zip

# ---------------------------------------------------------------------------
# App config
# ---------------------------------------------------------------------------

API_SECRET = os.environ.get("API_SECRET", "")

app = FastAPI(
    title="Audio Quality Metrics API",
    version="3.0-vps",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _verify_auth(authorization: Optional[str]):
    """Simple bearer token check."""
    if not API_SECRET:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization[len("Bearer "):]
    if token != API_SECRET:
        raise HTTPException(status_code=403, detail="Invalid API secret")


# ---------------------------------------------------------------------------
# Startup: preload models into RAM
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup_event():
    """Preload all ML models into memory on startup — zero cold start."""
    print("=" * 60)
    print("  Audio Quality Metrics API - VPS Edition")
    print("  Preloading models...")
    print("=" * 60)
    start = time.time()
    preload_all_models()
    elapsed = time.time() - start
    print(f"  All models loaded in {elapsed:.1f}s")
    print("=" * 60)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return {
        "status": "ok",
        "service": "Audio Quality Metrics API",
        "version": "3.0-vps",
        "models": ["srmr", "sigmos", "wvmos", "utmos", "vqscore"],
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze_audio(
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
):
    """
    Analyze audio file → returns all quality metrics.
    For files > 3 minutes, uses 5×30s sampling.
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

        is_sampled = duration > 180
        chunks = sample_audio_chunks(audio, sr, duration)

        # --- SRMR ---
        srmr_scores = [s for ca, csr in chunks if (s := compute_srmr(ca, csr)) is not None]
        srmr_val = round(float(np.mean(srmr_scores)), 4) if srmr_scores else None

        # --- SigMOS ---
        sigmos_accum = {"sigmos_disc": [], "sigmos_reverb": [], "sigmos_ovrl": []}
        for ca, csr in chunks:
            result = compute_sigmos(ca, csr)
            for k in sigmos_accum:
                if result.get(k) is not None:
                    sigmos_accum[k].append(result[k])
        sigmos_vals = {k: round(float(np.mean(v)), 4) if v else None for k, v in sigmos_accum.items()}

        # --- VQScore ---
        vq_scores = []
        chunk_paths = []
        for i, (ca, csr) in enumerate(chunks):
            if is_sampled:
                chunk_path = os.path.join(tempfile.gettempdir(), f"vq_chunk_{i}.wav")
                sf.write(chunk_path, ca, csr)
                chunk_paths.append(chunk_path)
                s = compute_vqscore(chunk_path)
            else:
                s = compute_vqscore(wav_path)
            if s is not None:
                vq_scores.append(s)
            if not is_sampled:
                break
        vqscore_val = round(float(np.mean(vq_scores)), 4) if vq_scores else None

        # --- WVMOS ---
        wvmos_scores = [s for ca, csr in chunks if (s := compute_wvmos_chunked(ca, csr)) is not None]
        wvmos_val = round(float(np.mean(wvmos_scores)), 4) if wvmos_scores else None

        # --- UTMOS ---
        utmos_scores = [s for ca, csr in chunks if (s := compute_utmos(ca, csr)) is not None]
        utmos_val = round(float(np.mean(utmos_scores)), 4) if utmos_scores else None

        # --- Mic SR, SNR, RMS (full file) ---
        mic_sr = estimate_mic_sample_rate(audio, sr)
        snr_val = compute_snr_vad(audio, sr)
        rms_val = compute_rms_dbfs(audio)

        # Cleanup
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
async def enhance_audio_endpoint(
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
    Enhance audio with adaptive post-processing.
    Returns enhanced WAV as binary stream.
    No timeout limits — handles files of any size.
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
        print(f"[Enhance] RMS: {original_rms:.1f} → {final_rms:.1f} dBFS | Steps: {', '.join(steps_applied)}")

        wav_buffer = io.BytesIO()
        sf.write(wav_buffer, audio, sr, format='WAV', subtype='PCM_16')
        wav_buffer.seek(0)

        return StreamingResponse(
            wav_buffer,
            media_type="audio/wav",
            headers={
                "Content-Disposition": 'attachment; filename="enhanced.wav"',
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


@app.post("/reconstruct-tracks")
async def reconstruct_tracks_endpoint(
    file: UploadFile = File(None),
    diarization: str = Form(...),
    authorization: Optional[str] = Header(None),
    crossfade_ms: Optional[str] = Form("10"),
    padding_ms: Optional[str] = Form("50"),
    session_prefix: Optional[str] = Form("track"),
    file_url: Optional[str] = Form(None),
    upload_base_url: Optional[str] = Form(None),
    upload_auth: Optional[str] = Form(None),
    upload_folder: Optional[str] = Form(None),
):
    """
    Reconstruct individual speaker tracks from a mixed audio file.

    Accepts file upload OR file_url (VPS downloads directly).
    If upload_base_url is provided, VPS uploads each WAV to S3 via
    stream-upload-to-s3 and returns JSON with URLs instead of a ZIP.
    """
    _verify_auth(authorization)

    # Get audio content: from upload or URL
    if file and file.filename:
        content = await file.read()
        original_filename = file.filename
    elif file_url:
        import httpx
        print(f"[Reconstruct] Downloading from URL: {file_url[:100]}...")
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(file_url)
            resp.raise_for_status()
            content = resp.content
            original_filename = file_url.split("/")[-1].split("?")[0] or "mixed.wav"
        print(f"[Reconstruct] Downloaded {len(content)} bytes")
    else:
        raise HTTPException(status_code=400, detail="Either file or file_url is required")

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        words = json.loads(diarization)
        if not isinstance(words, list):
            raise ValueError("diarization must be a JSON array")
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid diarization JSON: {e}")

    if not words:
        raise HTTPException(status_code=400, detail="Empty diarization data")

    suffix = ".wav"
    if original_filename.lower().endswith(".mp3"):
        suffix = ".mp3"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    # Free content memory early
    del content

    try:
        audio, sr = librosa.load(tmp_path, sr=None, mono=True)
        duration = len(audio) / sr

        speakers = set(w.get("speaker", "unknown") for w in words)
        print(f"[Reconstruct] {len(words)} words, {len(speakers)} speakers, {duration:.1f}s audio")

        tracks = reconstruct_tracks(
            audio, sr, words,
            crossfade_ms=float(crossfade_ms),
            padding_ms=float(padding_ms),
        )

        # If upload URL provided, upload each track to S3 and return JSON
        if upload_base_url and upload_auth:
            import httpx
            results = []
            async with httpx.AsyncClient(timeout=120) as client:
                for speaker_label, audio_data in sorted(tracks.items()):
                    wav_buf = io.BytesIO()
                    sf.write(wav_buf, audio_data, sr, format="WAV", subtype="PCM_16")
                    wav_buf.seek(0)
                    wav_bytes = wav_buf.read()

                    filename = f"preview_{speaker_label}_{int(time.time())}.wav"
                    folder = upload_folder or f"rooms/{session_prefix}/previews"
                    upload_url = f"{upload_base_url}?filename={filename}&folder={folder}&content_type=audio/wav"

                    print(f"[Reconstruct] Uploading {speaker_label} ({len(wav_bytes)} bytes) to S3...")
                    up_resp = await client.post(
                        upload_url,
                        content=wav_bytes,
                        headers={
                            "Authorization": upload_auth,
                            "Content-Type": "audio/wav",
                        },
                    )
                    if up_resp.status_code == 200:
                        up_data = up_resp.json()
                        results.append({
                            "speaker": speaker_label,
                            "url": up_data.get("public_url", ""),
                        })
                        print(f"[Reconstruct] Uploaded {speaker_label} → {up_data.get('public_url', '')[:80]}")
                    else:
                        print(f"[Reconstruct] Upload failed for {speaker_label}: {up_resp.status_code} {up_resp.text[:200]}")

            return JSONResponse({
                "success": True,
                "speakers": results,
                "duration": round(duration, 1),
                "sample_rate": sr,
            })

        # Fallback: return ZIP (original behavior)
        zip_buffer = tracks_to_zip(tracks, sr, session_prefix=session_prefix)

        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{session_prefix}_tracks.zip"',
                "X-Speaker-Count": str(len(tracks)),
                "X-Duration-Seconds": f"{duration:.1f}",
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



async def queue_status(authorization: Optional[str] = Header(None)):
    """Get Celery queue status."""
    _verify_auth(authorization)
    try:
        from app.worker import celery_app
        inspector = celery_app.control.inspect()
        active = inspector.active() or {}
        reserved = inspector.reserved() or {}
        stats = inspector.stats() or {}

        total_active = sum(len(v) for v in active.values())
        total_reserved = sum(len(v) for v in reserved.values())
        workers = list(stats.keys())

        return {
            "workers": len(workers),
            "worker_names": workers,
            "active_tasks": total_active,
            "reserved_tasks": total_reserved,
        }
    except Exception as e:
        return {"error": str(e), "workers": 0}
