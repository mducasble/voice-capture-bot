FROM python:3.10-slim

WORKDIR /app

# System dependencies for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy model code and config
COPY models/ ./models/
COPY app.py .

# Download model weights at build time
RUN python -c "\
import requests, os; \
os.makedirs('models/weights', exist_ok=True); \
# SigMOS ONNX model \
print('Downloading SigMOS ONNX model...'); \
r = requests.get('https://raw.githubusercontent.com/ashishnoel-KGeN/TTS_Validation/main/metrics/sigmos/model-sigmos_1697718653_41d092e8-epo-200.onnx'); \
open('models/weights/sigmos.onnx', 'wb').write(r.content); \
print(f'SigMOS model: {len(r.content)} bytes'); \
# VQScore checkpoint \
print('Downloading VQScore checkpoint...'); \
r = requests.get('https://raw.githubusercontent.com/ashishnoel-KGeN/TTS_Validation/main/metrics/vqscore_exp/QE_cbook_size_2048_1_32_IN_input_encoder_z_Librispeech_clean_github/checkpoint-dnsmos_ovr_CC%3D0.835.pkl'); \
open('models/weights/vqscore_checkpoint.pkl', 'wb').write(r.content); \
print(f'VQScore checkpoint: {len(r.content)} bytes'); \
"

# HuggingFace Spaces uses port 7860
EXPOSE 7860

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
