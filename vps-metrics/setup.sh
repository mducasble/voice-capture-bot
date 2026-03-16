#!/bin/bash
set -euo pipefail

# =============================================================================
# Audio Quality Metrics VPS - Automated Setup Script
# Tested on: Ubuntu 22.04 LTS
# =============================================================================

echo "============================================================"
echo "  Audio Quality Metrics VPS - Setup"
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
    err "Este script precisa ser executado como root (sudo ./setup.sh)"
    exit 1
fi

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$INSTALL_DIR"

# =============================================================================
# 1. System packages
# =============================================================================
echo ""
echo "--- 1/6: Atualizando sistema e instalando dependências ---"

apt-get update -qq
apt-get install -y -qq \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    ufw \
    certbot \
    htop \
    > /dev/null 2>&1

log "Pacotes do sistema instalados"

# =============================================================================
# 2. Docker
# =============================================================================
echo ""
echo "--- 2/6: Instalando Docker ---"

if command -v docker &> /dev/null; then
    log "Docker já instalado: $(docker --version)"
else
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    log "Docker instalado: $(docker --version)"
fi

# Docker Compose plugin
if docker compose version &> /dev/null; then
    log "Docker Compose já instalado"
else
    apt-get install -y -qq docker-compose-plugin > /dev/null 2>&1
    log "Docker Compose instalado"
fi

# =============================================================================
# 3. Firewall
# =============================================================================
echo ""
echo "--- 3/6: Configurando firewall ---"

ufw default deny incoming > /dev/null 2>&1
ufw default allow outgoing > /dev/null 2>&1
ufw allow ssh > /dev/null 2>&1
ufw allow 80/tcp > /dev/null 2>&1
ufw allow 443/tcp > /dev/null 2>&1
ufw --force enable > /dev/null 2>&1

log "Firewall configurado (SSH, HTTP, HTTPS)"

# =============================================================================
# 4. Configuração
# =============================================================================
echo ""
echo "--- 4/6: Configurando ambiente ---"

if [ ! -f .env ]; then
    cp .env.example .env
    # Generate random API secret
    API_SECRET=$(openssl rand -hex 32)
    sed -i "s/change-me-to-a-secure-random-string/$API_SECRET/" .env
    log "Arquivo .env criado com API_SECRET gerada automaticamente"
    warn "Sua API_SECRET: $API_SECRET"
    warn "GUARDE ESTA CHAVE! Você precisará dela para configurar o METRICS_API_SECRET no projeto."
else
    log "Arquivo .env já existe"
fi

# Create nginx SSL directory
mkdir -p nginx/ssl

# =============================================================================
# 5. SSL (optional)
# =============================================================================
echo ""
echo "--- 5/6: SSL ---"

source .env 2>/dev/null || true

if [ -n "${DOMAIN:-}" ]; then
    echo "Configurando SSL para $DOMAIN..."
    
    # Get certificate using standalone mode (before starting nginx)
    certbot certonly --standalone \
        --non-interactive \
        --agree-tos \
        --email "admin@$DOMAIN" \
        -d "$DOMAIN" \
        || warn "Certbot falhou — verifique se o DNS do domínio aponta para este servidor"
    
    if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
        cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" nginx/ssl/fullchain.pem
        cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" nginx/ssl/privkey.pem
        
        # Enable HTTPS in nginx config
        sed -i "s/YOUR_DOMAIN/$DOMAIN/g" nginx/nginx.conf
        sed -i 's/# \(listen 443\)/\1/' nginx/nginx.conf
        sed -i 's/# \(ssl_\)/\1/' nginx/nginx.conf
        sed -i 's/# \(server_name\)/\1/' nginx/nginx.conf
        sed -i 's/# \(location\)/\1/' nginx/nginx.conf
        sed -i 's/# \(limit_req\)/\1/' nginx/nginx.conf
        sed -i 's/# \(proxy_\)/\1/' nginx/nginx.conf
        sed -i 's/# \(}\)/\1/' nginx/nginx.conf
        
        log "SSL configurado para $DOMAIN"
        
        # Auto-renew cron
        (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem $INSTALL_DIR/nginx/ssl/ && cp /etc/letsencrypt/live/$DOMAIN/privkey.pem $INSTALL_DIR/nginx/ssl/ && docker compose -f $INSTALL_DIR/docker-compose.yml restart nginx") | crontab -
        log "Auto-renovação SSL configurada"
    fi
else
    warn "Sem domínio configurado — SSL desabilitado. Edite .env e re-execute para ativar."
fi

# =============================================================================
# 6. Build & Start
# =============================================================================
echo ""
echo "--- 6/6: Construindo e iniciando serviços ---"
echo "Isso pode levar 10-15 minutos na primeira vez (download de modelos ML)..."

docker compose build --no-cache 2>&1 | tail -5
docker compose up -d

# Wait for health
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
    warn "API ainda não respondeu — verifique os logs: docker compose logs -f"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "============================================================"
echo -e "  ${GREEN}Setup completo!${NC}"
echo "============================================================"
echo ""

# Get public IP
PUBLIC_IP=$(curl -sf https://api.ipify.org || echo "SEU_IP")

echo "  Endpoints:"
if [ -n "${DOMAIN:-}" ] && [ -f "nginx/ssl/fullchain.pem" ]; then
    echo "    https://$DOMAIN/health"
    echo "    https://$DOMAIN/analyze"
    echo "    https://$DOMAIN/enhance"
    echo ""
    echo "  METRICS_API_URL = https://$DOMAIN"
else
    echo "    http://$PUBLIC_IP/health"
    echo "    http://$PUBLIC_IP/analyze"
    echo "    http://$PUBLIC_IP/enhance"
    echo ""
    echo "  METRICS_API_URL = http://$PUBLIC_IP"
fi

echo ""
echo "  Próximos passos:"
echo "    1. Atualize o secret METRICS_API_URL no seu projeto Lovable"
echo "    2. Atualize o secret METRICS_API_SECRET com a API_SECRET acima"
echo "    3. Teste: curl -H 'Authorization: Bearer SUA_KEY' http://$PUBLIC_IP/health"
echo ""
echo "  Comandos úteis:"
echo "    docker compose logs -f         # Ver logs"
echo "    docker compose ps              # Status dos serviços"
echo "    docker compose restart         # Reiniciar"
echo "    docker compose down && docker compose up -d  # Rebuild"
echo ""
