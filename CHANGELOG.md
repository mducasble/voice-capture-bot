# Patch Notes

## [Unreleased]

### 2026-03-13

#### Portal
- **PrivateUpload** — Migração do upload para AWS S3 via `stream-upload-to-s3`, com estrutura `campaigns/{id}/{type}/{user_id}/`; registro de metadados nas tabelas de submission (`video_submissions`, `image_submissions`, `voice_recordings`)

#### Backend (Edge Functions)
- **stream-upload-to-s3** — Adicionado suporte ao parâmetro `folder` para uploads fora do diretório `rooms/`

#### Admin
- _(sem alterações nesta data)_

---

<!--
  Formato:
  ### YYYY-MM-DD
  #### Admin | Portal | Backend | Database
  - **Componente/Função** — Descrição curta da mudança
-->
