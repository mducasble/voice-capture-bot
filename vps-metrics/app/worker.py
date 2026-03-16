"""
Celery worker for async audio processing.
Used for long-running jobs that shouldn't block the API.
"""

import os
from celery import Celery

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "audio-metrics",
    broker=REDIS_URL,
    backend=REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    task_time_limit=1800,       # 30 min hard limit
    task_soft_time_limit=1500,  # 25 min soft limit
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=50,
)


@celery_app.task(bind=True, name="analyze_audio")
def analyze_audio_task(self, file_url: str, recording_id: str):
    """
    Download and analyze audio from URL.
    This runs in the Celery worker, not in the API process.
    """
    import tempfile
    import requests
    import numpy as np
    import librosa
    import soundfile as sf
    from app.metrics import (
        compute_snr_vad, compute_rms_dbfs, compute_srmr,
        compute_sigmos, compute_wvmos_chunked, compute_utmos,
        compute_vqscore, estimate_mic_sample_rate, sample_audio_chunks,
    )

    self.update_state(state="DOWNLOADING", meta={"recording_id": recording_id})

    # Download
    resp = requests.get(file_url, timeout=300)
    resp.raise_for_status()

    suffix = ".mp3" if ".mp3" in file_url.lower() else ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(resp.content)
        tmp_path = tmp.name

    try:
        self.update_state(state="ANALYZING", meta={"recording_id": recording_id})

        audio, sr = librosa.load(tmp_path, sr=None, mono=True)
        duration = len(audio) / sr

        wav_path = tmp_path
        if suffix == ".mp3":
            wav_path = tmp_path.replace(".mp3", ".wav")
            sf.write(wav_path, audio, sr)

        chunks = sample_audio_chunks(audio, sr, duration)

        srmr_scores = [s for ca, csr in chunks if (s := compute_srmr(ca, csr)) is not None]
        sigmos_accum = {"sigmos_disc": [], "sigmos_reverb": [], "sigmos_ovrl": []}
        for ca, csr in chunks:
            result = compute_sigmos(ca, csr)
            for k in sigmos_accum:
                if result.get(k) is not None:
                    sigmos_accum[k].append(result[k])

        vq_scores = []
        chunk_paths = []
        is_sampled = duration > 180
        for i, (ca, csr) in enumerate(chunks):
            if is_sampled:
                import os as _os
                chunk_path = _os.path.join(tempfile.gettempdir(), f"vq_{recording_id}_{i}.wav")
                sf.write(chunk_path, ca, csr)
                chunk_paths.append(chunk_path)
                s = compute_vqscore(chunk_path)
            else:
                s = compute_vqscore(wav_path)
            if s is not None:
                vq_scores.append(s)
            if not is_sampled:
                break

        wvmos_scores = [s for ca, csr in chunks if (s := compute_wvmos_chunked(ca, csr)) is not None]
        utmos_scores = [s for ca, csr in chunks if (s := compute_utmos(ca, csr)) is not None]

        mic_sr = estimate_mic_sample_rate(audio, sr)
        snr_val = compute_snr_vad(audio, sr)
        rms_val = compute_rms_dbfs(audio)

        for p in chunk_paths:
            try:
                os.unlink(p)
            except OSError:
                pass

        return {
            "recording_id": recording_id,
            "srmr": round(float(np.mean(srmr_scores)), 4) if srmr_scores else None,
            "sigmos_disc": round(float(np.mean(sigmos_accum["sigmos_disc"])), 4) if sigmos_accum["sigmos_disc"] else None,
            "sigmos_ovrl": round(float(np.mean(sigmos_accum["sigmos_ovrl"])), 4) if sigmos_accum["sigmos_ovrl"] else None,
            "sigmos_reverb": round(float(np.mean(sigmos_accum["sigmos_reverb"])), 4) if sigmos_accum["sigmos_reverb"] else None,
            "vqscore": round(float(np.mean(vq_scores)), 4) if vq_scores else None,
            "wvmos": round(float(np.mean(wvmos_scores)), 4) if wvmos_scores else None,
            "utmos": round(float(np.mean(utmos_scores)), 4) if utmos_scores else None,
            "mic_sr": mic_sr,
            "file_sr": sr,
            "snr_db": snr_val,
            "rms_dbfs": rms_val,
            "duration_seconds": round(duration, 1),
        }

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


@celery_app.task(bind=True, name="enhance_audio")
def enhance_audio_task(self, file_url: str, recording_id: str, options: dict):
    """
    Download, enhance, and return enhanced audio bytes.
    Runs in Celery worker — no timeout limits.
    """
    import tempfile
    import requests
    import numpy as np
    import librosa
    import soundfile as sf
    import io
    from app.enhance import (
        enhance_highpass, enhance_lowpass, enhance_speech_eq,
        enhance_noise_gate, enhance_normalize_lufs,
    )

    self.update_state(state="DOWNLOADING", meta={"recording_id": recording_id})

    resp = requests.get(file_url, timeout=300)
    resp.raise_for_status()

    suffix = ".mp3" if ".mp3" in file_url.lower() else ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(resp.content)
        tmp_path = tmp.name

    try:
        self.update_state(state="ENHANCING", meta={"recording_id": recording_id})

        audio, sr = librosa.load(tmp_path, sr=None, mono=True)
        steps = []

        if options.get("highpass"):
            audio = enhance_highpass(audio, sr, options.get("highpass_freq", 80))
            steps.append(f"highpass_{options.get('highpass_freq', 80)}Hz")

        if options.get("lowpass"):
            audio = enhance_lowpass(audio, sr, options.get("lowpass_freq", 16000))
            steps.append(f"lowpass_{options.get('lowpass_freq', 16000)}Hz")

        if options.get("noise_gate"):
            audio = enhance_noise_gate(audio, sr, threshold_db=options.get("noise_gate_threshold_db", -50))
            steps.append(f"noise_gate_{options.get('noise_gate_threshold_db', -50)}dB")

        if options.get("speech_eq"):
            audio = enhance_speech_eq(audio, sr, boost_db=options.get("speech_eq_boost_db", 1.5))
            steps.append(f"speech_eq_{options.get('speech_eq_boost_db', 1.5)}dB")

        if options.get("normalize"):
            audio = enhance_normalize_lufs(audio, target_lufs=options.get("target_lufs", -23))
            steps.append(f"normalize_{options.get('target_lufs', -23)}LUFS")

        # Write to temp file and return path
        out_path = os.path.join(tempfile.gettempdir(), f"enhanced_{recording_id}.wav")
        sf.write(out_path, audio, sr, format='WAV', subtype='PCM_16')

        return {
            "recording_id": recording_id,
            "enhanced_path": out_path,
            "steps": ",".join(steps),
            "sample_rate": sr,
        }

    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
