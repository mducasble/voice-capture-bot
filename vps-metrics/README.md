# Audio Quality Metrics — Local Server

Servidor local para análise de qualidade e melhoria de áudio.
Roda na sua máquina com GPU (RTX 4080 Super) para máxima performance.

## Specs da máquina

- **CPU**: Ryzen 9 9950X3D (16C/32T)
- **RAM**: 64GB DDR5
- **GPU**: RTX 4080 Super (16GB VRAM)
- **SO recomendado**: Ubuntu 22.04 LTS ou Windows 11 + WSL2

## Pré-requisitos (antes do setup)

### Linux (Ubuntu/Debian)
```bash
# 1. NVIDIA Driver (se ainda não instalado)
sudo apt install nvidia-driver-550

# 2. NVIDIA Container Toolkit (obrigatório para Docker + GPU)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update && sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# 3. Verificar que o Docker enxerga a GPU
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

### Windows (WSL2)
```powershell
# 1. Instale o WSL2 com Ubuntu 22.04
wsl --install -d Ubuntu-22.04

# 2. Instale o NVIDIA Driver no Windows (não no WSL!)
# Baixe em: https://www.nvidia.com/download/index.aspx

# 3. Dentro do WSL2, instale Docker Desktop ou Docker Engine
# Docker Desktop: https://docs.docker.com/desktop/install/windows-install/
# Ou siga o guia do Docker Engine para Ubuntu dentro do WSL2

# 4. Instale nvidia-container-toolkit dentro do WSL2
# (mesmo procedimento do Linux acima)
```

## Deploy rápido (3 comandos)

```bash
# 1. Acesse a pasta
cd vps-metrics

# 2. Execute o setup
chmod +x setup.sh
sudo ./setup.sh

# 3. Pronto! Teste:
curl http://localhost/health
```

O script `setup.sh` instala Docker, configura firewall, e sobe tudo automaticamente.

## O que roda

| Serviço | Porta | Descrição |
|---------|-------|-----------|
| **Nginx** | 80/443 | Reverse proxy |
| **FastAPI** | 8000 | API de métricas e enhance (GPU) |
| **Redis** | 6379 | Broker de filas |
| **Celery Worker** | — | Processamento assíncrono (GPU) |

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Status + info GPU |
| GET | `/health` | Health check |
| POST | `/analyze` | Analisa áudio (SRMR, SigMOS, WVMOS, UTMOS, VQScore) |
| POST | `/enhance` | Melhora áudio (noise gate, EQ, normalize) |
| GET | `/queue/status` | Status da fila Celery |

## Configuração

Edite `.env`:

```env
API_SECRET=gere-uma-chave-segura-aqui
WORKERS=2         # API workers (2 é ideal com GPU)
CELERY_CONCURRENCY=1   # Workers Celery (1 pra não sobrecarregar VRAM)
```

## Modo CPU (fallback)

Se a GPU não estiver disponível, use o compose alternativo:

```bash
docker compose -f docker-compose.cpu.yml up -d --build
```

## Acesso remoto (tunnel)

Para acessar de fora da rede local (ex: edge functions):

### Opção 1: Cloudflare Tunnel (grátis, recomendado)
```bash
# Instale cloudflared
curl -fsSL https://pkg.cloudflare.com/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Crie tunnel
cloudflared tunnel login
cloudflared tunnel create audio-metrics
cloudflared tunnel route dns audio-metrics metrics.seudominio.com

# Rode
cloudflared tunnel run --url http://localhost:80 audio-metrics
```

### Opção 2: Tailscale (VPN mesh, zero config)
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# Use o IP do Tailscale como METRICS_API_URL
```

### Opção 3: Port forwarding no roteador
- Forward porta 80/443 para o IP local da máquina
- Configure DDNS se o IP externo for dinâmico

## Monitoramento

```bash
# Logs em tempo real
docker compose logs -f

# Ver uso da GPU
nvidia-smi -l 2

# Status dos containers
docker compose ps

# Status da fila
curl -H "Authorization: Bearer SUA_KEY" http://localhost:8000/queue/status
```

## Atualização

```bash
cd vps-metrics  # ou onde estiver
git pull
docker compose build --no-cache
docker compose up -d
```

## Performance esperada (RTX 4080 Super)

| Operação | Tempo estimado |
|----------|----------------|
| Análise completa (30s áudio) | ~2-4s |
| Análise completa (5min áudio) | ~8-15s |
| Enhancement (5min áudio) | ~3-5s |
| Throughput | ~300-500 arquivos/dia |
