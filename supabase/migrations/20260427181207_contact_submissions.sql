-- Store public contact form submissions for admin support management.
CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0 AND char_length(name) <= 200),
  email TEXT NOT NULL CHECK (char_length(trim(email)) > 0 AND char_length(email) <= 320),
  company TEXT NULL CHECK (company IS NULL OR char_length(company) <= 200),
  role TEXT NOT NULL CHECK (role IN ('merchant', 'investor', 'partner', 'press', 'other')),
  message TEXT NOT NULL CHECK (char_length(trim(message)) > 0 AND char_length(message) <= 10000),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_review', 'resolved', 'archived')),
  admin_notes TEXT NULL CHECK (admin_notes IS NULL OR char_length(admin_notes) <= 10000),
  handled_by UUID NULL REFERENCES public.admin_users(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ NULL,
  source_path TEXT NULL CHECK (source_path IS NULL OR char_length(source_path) <= 500),
  user_agent TEXT NULL CHECK (user_agent IS NULL OR char_length(user_agent) <= 1000),
  ip_address INET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_contact_submissions_created_at ON public.contact_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_status ON public.contact_submissions (status);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_role ON public.contact_submissions (role);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_email_lower ON public.contact_submissions (lower(email));

DROP TRIGGER IF EXISTS trg_contact_submissions_updated_at ON public.contact_submissions;
CREATE TRIGGER trg_contact_submissions_updated_at
  BEFORE UPDATE ON public.contact_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
