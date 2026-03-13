# Patch Notes

## [Unreleased]

### 2026-03-13

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
