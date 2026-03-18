
CREATE TABLE public.inbox_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inbox_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage inbox_message_templates"
  ON public.inbox_message_templates
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.inbox_message_templates (template_key, subject, category, body) VALUES
  ('welcome', 'Bem-vindo(a) à KGeN! 👋', 'general',
   E'Olá! Seja muito bem-vindo(a) à KGeN!\n\nEstamos felizes em ter você conosco. Aqui estão alguns links importantes para começar:\n\n🎮 Discord: [LINK_DISCORD]\n📸 Instagram: [LINK_INSTAGRAM]\n🐦 Twitter/X: [LINK_TWITTER]\n📺 YouTube: [LINK_YOUTUBE]\n📚 Tutoriais: [LINK_TUTORIAIS]\n\nSe tiver qualquer dúvida, é só responder esta mensagem.\n\nEquipe KGeN'),
  ('wallet_test_tx', 'Transação de teste para sua wallet 💰', 'payment',
   E'Olá!\n\nVamos realizar uma transação de teste para verificar se sua wallet está configurada corretamente.\n\nPor favor, confirme os dados:\n• Endereço da wallet: [WALLET_ADDRESS]\n• Rede: Polygon (MATIC)\n• Valor de teste: 0.01 USDT\n\nApós a confirmação, enviaremos a transação e você receberá uma notificação quando for concluída.\n\nEquipe KGeN');
