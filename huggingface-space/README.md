---
title: Audio Quality Metrics API
emoji: 🎙️
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Audio Quality Metrics API

FastAPI service that computes **real** audio quality metrics using established ML models:

| Metric | Library | Scale | Description |
|--------|---------|-------|-------------|
| **SRMR** | SRMRpy | 0-40+ dB | Speech-to-Reverberation Modulation Ratio |
| **SigMOS DISC** | DNSMOS (SIG) | 1.0-5.0 | Speech signal distortion quality |
| **SigMOS OVRL** | DNSMOS (OVRL) | 1.0-5.0 | Overall speech quality |
| **SigMOS REVERB** | DNSMOS (BAK) | 1.0-5.0 | Background/reverb quality |
| **WVMOS** | wvmos | 1.0-5.0 | wav2vec 2.0 fine-tuned MOS |
| **UTMOS** | UTMOS | 1.0-5.0 | UTokyo-SaruLab MOS predictor |
| **VQScore** | Composite | 0-100 | Weighted composite of above metrics |
| **Mic SR** | Spectral analysis | Hz | Estimated effective microphone sample rate |

## Usage

```bash
curl -X POST https://YOUR-SPACE.hf.space/analyze \
  -H "Authorization: Bearer YOUR_SECRET" \
  -F "file=@audio.wav"
```

## Environment Variables

- `API_SECRET`: Bearer token for authentication (optional, open access if not set)

## Deploy to HuggingFace Spaces

1. Create a new Space with **Docker** SDK
2. Upload `app.py`, `requirements.txt`, `Dockerfile`
3. Set `API_SECRET` in Space settings → Secrets
4. Wait for build (~5-10 min first time)
