FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

# Avoid interactive prompts and make large wheel downloads more resilient
ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DEFAULT_TIMEOUT=600 \
    PIP_RETRIES=10 \
    PIP_PROGRESS_BAR=off

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 \
    python3-pip \
    python3.10-venv \
    git \
    ffmpeg \
    libsndfile1 \
    curl \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && ln -sf /usr/bin/pip3 /usr/bin/pip \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt .
RUN python -m pip install --upgrade pip setuptools wheel \
    && pip install \
        --index-url https://download.pytorch.org/whl/cu124 \
        torch==2.6.0+cu124 \
        torchaudio==2.6.0+cu124 \
    && pip install -r requirements.txt

# Copy model code and config
COPY app/ ./app/
COPY models/ ./models/

# Download model weights at build time
RUN python -c "\
import requests, os; \
os.makedirs('models/weights', exist_ok=True); \
print('Downloading SigMOS ONNX model...'); \
r = requests.get('https://raw.githubusercontent.com/ashishnoel-KGeN/TTS_Validation/main/metrics/sigmos/model-sigmos_1697718653_41d092e8-epo-200.onnx'); \
open('models/weights/sigmos.onnx', 'wb').write(r.content); \
print(f'SigMOS model: {len(r.content)} bytes'); \
print('Downloading VQScore checkpoint...'); \
r = requests.get('https://raw.githubusercontent.com/ashishnoel-KGeN/TTS_Validation/main/metrics/vqscore_exp/QE_cbook_size_2048_1_32_IN_input_encoder_z_Librispeech_clean_github/checkpoint-dnsmos_ovr_CC%3D0.835.pkl'); \
open('models/weights/vqscore_checkpoint.pkl', 'wb').write(r.content); \
print(f'VQScore checkpoint: {len(r.content)} bytes'); \
"

# Validate GPU detection
RUN python -c "import torch; print(f'PyTorch {torch.__version__}'); print(f'CUDA available: {torch.cuda.is_available()}'); print(f'CUDA version: {torch.version.cuda}')"

EXPOSE 8000

# Entrypoint script handles role switching (api vs worker)
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
