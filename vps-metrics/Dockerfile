FROM python:3.10-slim

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

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

# Preload models during build to validate they work
RUN python -c "\
import torch; \
print(f'PyTorch {torch.__version__}, CUDA available: {torch.cuda.is_available()}'); \
print('Models will be loaded on first request (lazy loading)'); \
"

EXPOSE 8000

# Entrypoint script handles role switching (api vs worker)
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
