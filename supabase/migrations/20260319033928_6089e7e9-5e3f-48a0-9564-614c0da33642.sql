insert into public.task_type_catalog (
  task_type,
  category,
  ui_label,
  primary_unit,
  secondary_unit,
  default_admin_rules,
  default_tech_validation,
  default_content_validation,
  is_active,
  sort_order
)
values (
  'video_prompt_pair',
  'video',
  'Envio ou Gravação de Vídeos (Múltiplos)',
  'submission',
  null,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  true,
  9
)
on conflict (task_type)
do update set
  category = excluded.category,
  ui_label = excluded.ui_label,
  primary_unit = excluded.primary_unit,
  secondary_unit = excluded.secondary_unit,
  default_admin_rules = excluded.default_admin_rules,
  default_tech_validation = excluded.default_tech_validation,
  default_content_validation = excluded.default_content_validation,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;