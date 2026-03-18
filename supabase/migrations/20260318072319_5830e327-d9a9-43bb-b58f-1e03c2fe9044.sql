
-- Threads: each conversation between admin and a user
CREATE TABLE public.inbox_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'open',
  last_message_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Messages within a thread
CREATE TABLE public.inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.inbox_threads(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inbox_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_messages ENABLE ROW LEVEL SECURITY;

-- Threads: users see own, admins see all
CREATE POLICY "Users can view own threads"
  ON public.inbox_threads FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all threads"
  ON public.inbox_threads FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can create support threads"
  ON public.inbox_threads FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND auth.uid() = created_by);

CREATE POLICY "Users can update own threads"
  ON public.inbox_threads FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- Messages: users see messages in own threads, admins see all
CREATE POLICY "Users can view messages in own threads"
  ON public.inbox_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.inbox_threads t
    WHERE t.id = thread_id AND t.user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage all messages"
  ON public.inbox_messages FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can send messages in own threads"
  ON public.inbox_messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM public.inbox_threads t
      WHERE t.id = thread_id AND t.user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX idx_inbox_threads_user_id ON public.inbox_threads(user_id);
CREATE INDEX idx_inbox_threads_status ON public.inbox_threads(status);
CREATE INDEX idx_inbox_messages_thread_id ON public.inbox_messages(thread_id);

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.inbox_messages;
