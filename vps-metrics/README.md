# Audio Quality Metrics VPS

Servidor dedicado para análise de qualidade e melhoria de áudio.
Substitui o HuggingFace Space com zero cold start e sem limites de timeout.

## Requisitos

- **VPS recomendada**: Hetzner AX41 (AMD Ryzen 5, 64GB RAM, 2x NVMe) — ~€40/mês
- **SO**: Ubuntu 22.04 LTS
- **RAM mínimo**: 16GB (modelos usam ~4-6GB)
- **Disco**: 50GB+ livres

## Deploy rápido (3 comandos)

```bash
# 1. Copie os arquivos para o servidor
scp -r vps-metrics/ user@seu-servidor:/opt/audio-metrics/

# 2. Acesse o servidor
ssh user@seu-servidor

# 3. Execute o setup
cd /opt/audio-metrics
chmod +x setup.sh
sudo ./setup.sh
```

O script `setup.sh` instala Docker, configura firewall, SSL, e sobe tudo automaticamente.

## O que roda

| Serviço | Porta | Descrição |
|---------|-------|-----------|
| **Nginx** | 80/443 | Reverse proxy com SSL |
| **FastAPI** | 8000 | API de métricas e enhance |
| **Redis** | 6379 | Broker de filas |
| **Celery Worker** | — | Processamento assíncrono |

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Status |
| GET | `/health` | Health check |
| POST | `/analyze` | Analisa áudio (SRMR, SigMOS, WVMOS, UTMOS, VQScore) |
| POST | `/enhance` | Melhora áudio (noise gate, EQ, normalize) |
| GET | `/queue/status` | Status da fila Celery |

## Configuração

Edite `.env` antes de rodar:

```env
API_SECRET=gere-uma-chave-segura-aqui
DOMAIN=metrics.seudominio.com    # para SSL
WORKERS=4                        # número de workers uvicorn
CELERY_CONCURRENCY=2             # workers Celery paralelos
```

## Upgrade para GPU

1. Instale NVIDIA drivers + nvidia-container-toolkit
2. Altere `docker-compose.yml`: descomente a seção `deploy.resources.reservations`
3. O Dockerfile já detecta CUDA automaticamente

## Monitoramento

```bash
# Logs em tempo real
docker compose logs -f

# Status dos containers
docker compose ps

# Status da fila
curl -H "Authorization: Bearer SUA_KEY" http://localhost:8000/queue/status
```

## Atualização

```bash
cd /opt/audio-metrics
git pull  # ou scp novos arquivos
docker compose build --no-cache
docker compose up -d
```
