"""
VQScore - VQVAE-based voice quality estimation.
Ported from: https://github.com/ashishnoel-KGeN/TTS_Validation/blob/main/metrics/vqscore_metric.py
Uses cosine similarity between encoder output and quantized representation.
"""

import os
import yaml
import torch
import torchaudio
import numpy as np
import librosa

from models.VQVAE_models import VQVAE_QE

_vqscore_model = None
_vqscore_config = None
_device = None


def stft_magnitude(x, hop_size, fft_size=512, win_length=512):
    window = torch.hann_window(win_length).to(x.device)
    x_stft = torch.stft(
        x, fft_size, hop_size, win_length, window=window, return_complex=True
    )
    mag = torch.sqrt(torch.clamp(x_stft.real ** 2 + x_stft.imag ** 2, min=1e-7))
    return mag.transpose(2, 1)


def cos_loss(SP_noisy, SP_y_noisy):
    eps = 1e-5
    SP_noisy_norm = torch.norm(SP_noisy, p=2, dim=-1, keepdim=True) + eps
    SP_y_noisy_norm = torch.norm(SP_y_noisy, p=2, dim=-1, keepdim=True) + eps
    Cos_frame = torch.sum(SP_noisy / SP_noisy_norm * SP_y_noisy / SP_y_noisy_norm, dim=-1)
    return -torch.mean(Cos_frame)


def load_model(config_path: str, checkpoint_path: str):
    global _vqscore_model, _vqscore_config, _device
    if _vqscore_model is not None:
        return

    with open(config_path, 'r') as f:
        _vqscore_config = yaml.load(f, Loader=yaml.FullLoader)

    _device = torch.device('cpu')
    print(f"Loading VQScore model on {_device}...")

    _vqscore_model = VQVAE_QE(**_vqscore_config['VQVAE_params']).to(_device).eval()

    # Load checkpoint with weights_only=False for pickle compatibility
    checkpoint = torch.load(checkpoint_path, map_location=_device, weights_only=False)
    _vqscore_model.load_state_dict(checkpoint['model']['VQVAE'])
    print("VQScore model loaded successfully")


def calculate_vqscore(audio_path: str) -> float | None:
    """Calculate VQScore for an audio file. Returns value typically in range 0-0.81."""
    try:
        if _vqscore_model is None:
            raise RuntimeError("VQScore model not loaded. Call load_model() first.")

        hop_size = 256
        wav_input, fs = librosa.load(audio_path, sr=None, mono=False)
        wav_input = torch.from_numpy(wav_input)

        if wav_input.ndim == 1:
            wav_input = wav_input.unsqueeze(0)

        # VQScore expects 16kHz
        if fs != 16000:
            resampler = torchaudio.transforms.Resample(fs, 16000)
            wav_input = resampler(wav_input)

        wav_input = wav_input.to(_device)
        SP_input = stft_magnitude(wav_input, hop_size=hop_size)

        if _vqscore_config.get('input_transform') == 'log1p':
            SP_input = torch.log1p(SP_input)

        with torch.no_grad():
            z = _vqscore_model.CNN_1D_encoder(SP_input)
            zq, indices, vqloss, distance = _vqscore_model.quantizer(z, stochastic=False, update=False)
            score = -cos_loss(z.transpose(2, 1).cpu(), zq.cpu()).item()

        return score
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Error calculating VQScore for {audio_path}: {e}")
        return None
