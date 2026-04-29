INSERT INTO settings (key, value, description)
VALUES
  ('manual_default_tax_percent', '0', 'Default tax percentage applied to manual fulfillment orders'),
  ('manual_state_tax_rates', '{}', 'JSON map of state tax override percentages for manual fulfillment orders'),
  ('manual_free_shipping_cutoff', '0', 'Manual fulfillment free shipping cutoff in dollars; subtotal must meet or exceed this amount'),
  ('manual_shipping_fee', '0', 'Flat manual fulfillment shipping fee in dollars for orders below the free shipping cutoff')
ON CONFLICT (key) DO NOTHING;
