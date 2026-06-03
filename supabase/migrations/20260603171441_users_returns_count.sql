-- Maintained counter of a user's active (pending/processing/complete) returns.
-- Kept in sync by the returns service so the admin Users table can sort and
-- colour rows without an aggregate join.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS returns_count INTEGER NOT NULL DEFAULT 0;

UPDATE public.users u
SET returns_count = COALESCE(sub.cnt, 0)
FROM (
  SELECT user_id, COUNT(*)::int AS cnt
  FROM public.order_returns
  WHERE status IN ('pending','processing','complete')
  GROUP BY user_id
) sub
WHERE sub.user_id = u.id;
