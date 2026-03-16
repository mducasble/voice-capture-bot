#!/bin/bash
set -euo pipefail

# =============================================================================
# Audio Quality Metrics — Local Setup Script (GPU-first)
# Tested on: Ubuntu 22.04 LTS / WSL2
# =============================================================================

echo "============================================================"
echo "  Audio Quality Metrics — Local Setup (GPU)"
echo "============================================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check root
if [ "$EUID" -ne 0 ]; then
    err "Execute como root: sudo ./setup.sh"
    exit 1
fi

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$INSTALL_DIR"

# =============================================================================
# 1. System packages
# =============================================================================
echo ""
echo "--- 1/5: Verificando dependências do sistema ---"

apt-get update -qq
apt-get install -y -qq \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    htop \
    > /dev/null 2>&1

log "Pacotes do sistema instalados"

# =============================================================================
# 2. Docker
# =============================================================================
echo ""
echo "--- 2/5: Verificando Docker ---"

if command -v docker &> /dev/null; then
    log "Docker já instalado: $(docker --version)"
else
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    log "Docker instalado: $(docker --version)"
fi

if docker compose version &> /dev/null; then
    log "Docker Compose já instalado"
else
    apt-get install -y -qq docker-compose-plugin > /dev/null 2>&1
    log "Docker Compose instalado"
fi

# =============================================================================
# 3. GPU check
# =============================================================================
echo ""
echo "--- 3/5: Verificando GPU ---"

USE_GPU=false
COMPOSE_FILE="docker-compose.yml"

if command -v nvidia-smi &> /dev/null; then
    GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || echo "")
    GPU_VRAM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 || echo "0")
    
    if [ -n "$GPU_NAME" ]; then
        log "GPU detectada: $GPU_NAME (${GPU_VRAM}MB VRAM)"
        
        # Check nvidia-container-toolkit
        if docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi > /dev/null 2>&1; then
            log "NVIDIA Container Toolkit funcionando"
            USE_GPU=true
        else
            warn "NVIDIA Container Toolkit NÃO encontrado!"
            echo ""
            echo "  Para habilitar GPU no Docker, instale:"
            echo "    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg"
            echo "    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \\"
            echo "        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \\"
            echo "        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list"
            echo "    sudo apt update && sudo apt install -y nvidia-container-toolkit"
            echo "    sudo nvidia-ctk runtime configure --runtime=docker"
            echo "    sudo systemctl restart docker"
            echo ""
            warn "Usando modo CPU como fallback"
        fi
    fi
else
    warn "nvidia-smi não encontrado — usando modo CPU"
fi

if [ "$USE_GPU" = false ]; then
    COMPOSE_FILE="docker-compose.cpu.yml"
    warn "Rodando em modo CPU (use docker-compose.yml quando GPU estiver pronta)"
fi

# =============================================================================
# 4. Configuração
# =============================================================================
echo ""
echo "--- 4/5: Configurando ambiente ---"

if [ ! -f .env ]; then
    cp .env.example .env
    API_SECRET=$(openssl rand -hex 32)
    sed -i "s/change-me-to-a-secure-random-string/$API_SECRET/" .env
    log "Arquivo .env criado com API_SECRET gerada automaticamente"
    warn "Sua API_SECRET: $API_SECRET"
    warn "GUARDE ESTA CHAVE! Você precisará dela para configurar o METRICS_API_SECRET no projeto."
else
    log "Arquivo .env já existe"
fi

mkdir -p nginx/ssl

# =============================================================================
# 5. Build & Start
# =============================================================================
echo ""
echo "--- 5/5: Construindo e iniciando serviços ---"

if [ "$USE_GPU" = true ]; then
    echo "Modo: GPU (RTX 4080 Super)"
else
    echo "Modo: CPU"
fi
echo "Compose file: $COMPOSE_FILE"
echo "Isso pode levar 10-15 minutos na primeira vez (download de modelos ML)..."
echo ""

docker compose -f "$COMPOSE_FILE" build --no-cache 2>&1 | tail -10
docker compose -f "$COMPOSE_FILE" up -d

# Wait for health
echo ""
echo "Aguardando API ficar pronta..."
for i in $(seq 1 60); do
    if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
        break
    fi
    sleep 5
done

if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    log "API está rodando!"
else
    warn "API ainda não respondeu — verifique: docker compose -f $COMPOSE_FILE logs -f"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "============================================================"
echo -e "  ${GREEN}Setup completo!${NC}"
echo "============================================================"
echo ""

LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo "  Modo: $([ "$USE_GPU" = true ] && echo "GPU 🚀" || echo "CPU")"
echo ""
echo "  Endpoints:"
echo "    http://localhost/health"
echo "    http://localhost/analyze"
echo "    http://localhost/enhance"
echo ""
echo "  Na rede local:"
echo "    http://$LOCAL_IP/health"
echo ""
echo "  METRICS_API_URL = http://$LOCAL_IP"
echo ""
echo "  Próximos passos:"
echo "    1. Atualize o secret METRICS_API_URL no Lovable com o endereço acima"
echo "    2. Atualize o secret METRICS_API_SECRET com a API_SECRET"
echo "    3. Para acesso externo, configure Cloudflare Tunnel (veja README)"
echo ""
echo "  Comandos úteis:"
echo "    docker compose -f $COMPOSE_FILE logs -f      # Ver logs"
echo "    docker compose -f $COMPOSE_FILE ps            # Status"
echo "    nvidia-smi -l 2                               # Monitorar GPU"
echo "    docker compose -f $COMPOSE_FILE restart       # Reiniciar"
echo ""
