-- Add is_verified to payment_methods.
-- A card is considered verified once it has successfully passed an auth
-- (or, historically, was already on file / admin-created). Cards entered
-- during the IVR checkout flow are inserted as unverified and only promoted
-- to verified after a successful Sola auth hold. Unverified cards are hidden
-- from saved-card pickers and are deleted if the auth declines.
ALTER TABLE payment_methods
  ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX idx_payment_methods_user_verified
  ON payment_methods (user_id, is_verified);
