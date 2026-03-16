# Patch Notes

## [1.02.0316.1]

### 2026-03-16

#### Backend (Edge Functions)
- **cron-analyze-next** — Worker cron unificado com suporte a job_type `enhance` (fire-and-forget via waitUntil) e `analyze`; release automático de jobs stuck (5 min analyze, 15 min enhance); claim otimista com prioridade + FIFO; checagem de maintenance_config antes de processar
- **batch-reanalyze** — Reprocessamento em cadeia com kill switch (`_kill_switch_off`), MAX_CONSECUTIVE_ERRORS e delay entre invocações; suporte a re-enfileiramento massivo por campanha
- **batch-enhance** — Enfileiramento em lote de jobs de enhance na analysis_queue a partir de array de recording_ids
- **backfill-quality-tier** — Recalcula quality_tier (PQ/HQ/MQ/LQ) para gravações existentes com métricas mas sem tier; processamento paginado por campanha

#### Admin
- **AdminAnalysisQueue** — Nova página de gerenciamento da fila de análise com stats em tempo real (pending/processing/done/failed), enfileiramento por campanha, botões de trigger/flush/retry, listagem dos 20 jobs mais recentes
- **MediaReviewTab** — Tab de revisão de mídia (imagens/vídeos) com filtros por campanha, status de qualidade/validação, preview inline e ações de aprovação/rejeição

#### Infraestrutura
- **vps-metrics/** — Pacote completo para servidor local de métricas de áudio: FastAPI + Celery + Redis + Nginx em Docker Compose; suporte GPU (CUDA 12.4, RTX 4080 Super) com fallback CPU; modelos pré-carregados (SigMOS, VQScore, WVMOS); endpoints `/analyze` e `/enhance`; setup.sh com detecção automática de GPU

---

## [1.01.0313.1]

### 2026-03-13

#### Arquitetura — Pipeline de Gravação Limpo
- **ParticipantAudio** — Substituído pipeline com audioProfile (gain, highpass, lowpass, RNNoise, Koala) por pipeline limpo idêntico ao mixed recorder: `source → gain(1.0) → AudioWorklet`. Garante que trilhas individuais e mixed tenham a mesma qualidade.
- **AudioTestFlow** — Simplificado para modo diagnóstico-only: mantém gravação de teste, análise de métricas e orientações práticas; removido painel de configuração de perfil adaptativo (sliders, toggles, apply/skip).
- **Room.tsx** — Removido estado `audioProfile`, `handleProfileApplied`, e todas as referências a filtros adaptativos. `getUserMedia` agora usa constraints fixas (echoCancellation/noiseSuppression/AGC = false) para captura crua consistente. Melhorias de áudio delegadas ao pós-processamento (Enhance via HuggingFace).

## [Unreleased — pre-1.01]

### 2026-03-13 (pre-release)

#### Admin
- **AdminReferralNetwork** — Nova página de visualização da rede de indicações com ranking por tamanho total (L1–L5), acordeão lazy-load por usuário mostrando membros com país, nível e contagem de sessões gravadas
- **ReviewQueue** — Sistema de classificação de qualidade por tiers (PQ/HQ/MQ/Below) com cores (azul/verde/amarelo/vermelho); classificação final baseada no pior resultado entre métricas críticas (`is_critical`); badge de tier por trilha; badge de aderência ao tema (🎯%); exibição de análise de conteúdo (speakers, resumo); botões de análise separados para original e enhanced; suporte a UTMOS nos metrics; indicador Upload vs Estúdio por trilha

#### Portal
- **PrivateUpload** — Módulo de upload privado dinâmico (`/c/:slug`) com suporte a vídeo/imagem/áudio via `campaign_type`; upload direto para AWS S3 via `stream-upload-to-s3`; registro em tabelas de submission com metadados (sender_name, slug, s3_key)

#### Backend (Edge Functions)
- **stream-upload-to-s3** — Adicionado suporte ao parâmetro `folder` para uploads fora do diretório `rooms/`
- **estimate-audio-metrics** — Segmentação individual de amostras (sem concatenação "Frankenstein") para evitar artefatos que penalizam WVMOS/SigMOS; envio de cada sample WAV separadamente ao endpoint `/analyze`; suporte a target `enhanced` com métricas separadas; retry automático para HuggingFace Spaces dormindo

#### Database
- **RPC `get_network_members_with_sessions`** — Função Security Definer que consolida membros da rede de um usuário com contagem de sessões, ignorando RLS
- **RPC `get_referral_network_stats`** — Função Security Definer que rankeia usuários por tamanho da rede (L1–L5)
- **Trigger `process_submission_earnings`** — Processamento automático de ganhos quando quality + validation são aprovados; cascata de referral com pool fixo ou percentual; incremento de `accumulated_value` na campanha com pausa automática ao atingir target

---

<!--
  Formato:
  ### YYYY-MM-DD
  #### Admin | Portal | Backend | Database
  - **Componente/Função** — Descrição curta da mudança
-->
