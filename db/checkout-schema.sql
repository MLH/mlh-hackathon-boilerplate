CREATE TABLE IF NOT EXISTS checkout_teams (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  identifier TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkout_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('team', 'admin')),
  team_id BIGINT REFERENCES checkout_teams(id),
  display_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((role = 'team' AND team_id IS NOT NULL) OR (role = 'admin' AND team_id IS NULL))
);

ALTER TABLE checkout_users ADD COLUMN IF NOT EXISTS name_change_count INTEGER NOT NULL DEFAULT 0
  CHECK (name_change_count BETWEEN 0 AND 1);
ALTER TABLE checkout_teams ADD COLUMN IF NOT EXISTS member_names TEXT[] NOT NULL DEFAULT ARRAY['', '', '', '']::TEXT[]
  CHECK (cardinality(member_names) = 4);
ALTER TABLE checkout_teams ADD COLUMN IF NOT EXISTS contact_email TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_teams ADD COLUMN IF NOT EXISTS profile_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS checkout_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES checkout_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkout_components (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  image_alt TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  compatibility TEXT NOT NULL CHECK (compatibility IN ('Arduino', 'Raspberry Pi', 'Arduino + Raspberry Pi', 'N/A')),
  arduino_guidance TEXT NOT NULL DEFAULT '',
  raspberry_pi_guidance TEXT NOT NULL DEFAULT '',
  bin_location TEXT NOT NULL DEFAULT '',
  technical_specs TEXT NOT NULL DEFAULT '',
  total_quantity INTEGER NOT NULL CHECK (total_quantity >= 0),
  mlh_quantity INTEGER NOT NULL DEFAULT 0 CHECK (mlh_quantity >= 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  checked_out_quantity INTEGER NOT NULL DEFAULT 0 CHECK (checked_out_quantity >= 0),
  unavailable_quantity INTEGER NOT NULL DEFAULT 0 CHECK (unavailable_quantity >= 0),
  protected_stock INTEGER NOT NULL DEFAULT 0 CHECK (protected_stock >= 0 AND protected_stock <= total_quantity),
  max_active_per_team INTEGER CHECK (max_active_per_team IS NULL OR max_active_per_team > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  admin_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT checkout_components_inventory_balance_check
    CHECK (mlh_quantity + reserved_quantity + checked_out_quantity + unavailable_quantity <= total_quantity)
);

CREATE TABLE IF NOT EXISTS checkout_orders (
  id BIGSERIAL PRIMARY KEY,
  receipt_code TEXT UNIQUE,
  team_id BIGINT NOT NULL REFERENCES checkout_teams(id),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewing', 'accepted', 'ready', 'picked_up', 'cancelled', 'expired')),
  reviewed_by BIGINT REFERENCES checkout_users(id),
  accepted_by BIGINT REFERENCES checkout_users(id),
  ready_by BIGINT REFERENCES checkout_users(id),
  picked_up_by BIGINT REFERENCES checkout_users(id),
  cancelled_by BIGINT REFERENCES checkout_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewing_at TIMESTAMPTZ,
  claim_expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  reservation_expires_at TIMESTAMPTZ,
  cancellation_note TEXT NOT NULL DEFAULT '',
  protected_stock_override_by BIGINT REFERENCES checkout_users(id),
  protected_stock_override_reason TEXT NOT NULL DEFAULT '',
  protected_stock_override_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS checkout_order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES checkout_orders(id) ON DELETE CASCADE,
  component_id BIGINT NOT NULL REFERENCES checkout_components(id),
  requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
  approved_quantity INTEGER NOT NULL CHECK (approved_quantity >= 0),
  adjustment_reason TEXT,
  note TEXT NOT NULL DEFAULT '',
  component_name_snapshot TEXT NOT NULL DEFAULT '',
  component_image_url_snapshot TEXT NOT NULL DEFAULT '',
  component_image_alt_snapshot TEXT NOT NULL DEFAULT '',
  component_category_snapshot TEXT NOT NULL DEFAULT '',
  UNIQUE (order_id, component_id)
);

CREATE TABLE IF NOT EXISTS checkout_team_inventory (
  team_id BIGINT NOT NULL REFERENCES checkout_teams(id),
  component_id BIGINT NOT NULL REFERENCES checkout_components(id),
  checked_out_quantity INTEGER NOT NULL DEFAULT 0 CHECK (checked_out_quantity >= 0),
  PRIMARY KEY (team_id, component_id)
);

CREATE TABLE IF NOT EXISTS checkout_component_relationships (
  id BIGSERIAL PRIMARY KEY,
  source_component_id BIGINT NOT NULL REFERENCES checkout_components(id) ON DELETE CASCADE,
  target_component_id BIGINT NOT NULL REFERENCES checkout_components(id),
  relation_type TEXT NOT NULL CHECK (relation_type IN ('requires', 'recommends', 'compatible_driver', 'compatible_power_supply')),
  quantity_ratio NUMERIC(10, 3) NOT NULL DEFAULT 1 CHECK (quantity_ratio > 0),
  minimum_source_quantity INTEGER NOT NULL DEFAULT 1 CHECK (minimum_source_quantity > 0),
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_component_id <> target_component_id),
  UNIQUE (source_component_id, target_component_id, relation_type)
);

CREATE TABLE IF NOT EXISTS checkout_return_receipts (
  id BIGSERIAL PRIMARY KEY,
  receipt_code TEXT UNIQUE,
  team_id BIGINT NOT NULL REFERENCES checkout_teams(id),
  processed_by BIGINT NOT NULL REFERENCES checkout_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkout_return_items (
  id BIGSERIAL PRIMARY KEY,
  return_receipt_id BIGINT NOT NULL REFERENCES checkout_return_receipts(id) ON DELETE CASCADE,
  component_id BIGINT NOT NULL REFERENCES checkout_components(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  condition TEXT NOT NULL CHECK (condition IN ('good', 'damaged', 'missing')),
  note TEXT NOT NULL DEFAULT '',
  component_name_snapshot TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS checkout_return_corrections (
  id BIGSERIAL PRIMARY KEY,
  receipt_code TEXT UNIQUE,
  original_return_receipt_id BIGINT NOT NULL REFERENCES checkout_return_receipts(id),
  team_id BIGINT NOT NULL REFERENCES checkout_teams(id),
  processed_by BIGINT NOT NULL REFERENCES checkout_users(id),
  reason TEXT NOT NULL CHECK (reason <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkout_return_correction_items (
  id BIGSERIAL PRIMARY KEY,
  correction_receipt_id BIGINT NOT NULL REFERENCES checkout_return_corrections(id) ON DELETE CASCADE,
  original_return_item_id BIGINT NOT NULL REFERENCES checkout_return_items(id),
  component_id BIGINT NOT NULL REFERENCES checkout_components(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  original_condition TEXT NOT NULL CHECK (original_condition IN ('good', 'damaged', 'missing')),
  corrected_condition TEXT NOT NULL CHECK (corrected_condition IN ('still_held', 'good', 'damaged', 'missing')),
  note TEXT NOT NULL DEFAULT '',
  component_name_snapshot TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS checkout_order_events (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES checkout_orders(id) ON DELETE CASCADE,
  actor_user_id BIGINT REFERENCES checkout_users(id),
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkout_idempotency_requests (
  actor_user_id BIGINT NOT NULL REFERENCES checkout_users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL DEFAULT '',
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (actor_user_id, action, idempotency_key)
);

CREATE TABLE IF NOT EXISTS checkout_order_cooldown_overrides (
  id BIGSERIAL PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES checkout_teams(id) ON DELETE CASCADE,
  granted_by BIGINT NOT NULL REFERENCES checkout_users(id),
  reason TEXT NOT NULL CHECK (reason <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  order_id BIGINT REFERENCES checkout_orders(id),
  CHECK ((consumed_at IS NULL AND order_id IS NULL) OR (consumed_at IS NOT NULL AND order_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS checkout_login_attempts (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  client_address TEXT NOT NULL,
  succeeded BOOLEAN NOT NULL DEFAULT FALSE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkout_inventory_transactions (
  id BIGSERIAL PRIMARY KEY,
  component_id BIGINT REFERENCES checkout_components(id),
  team_id BIGINT REFERENCES checkout_teams(id),
  order_id BIGINT REFERENCES checkout_orders(id),
  admin_id BIGINT REFERENCES checkout_users(id),
  actor_user_id BIGINT REFERENCES checkout_users(id),
  transaction_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  previous_state JSONB,
  new_state JSONB,
  note TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkout_activity (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES checkout_users(id),
  team_id BIGINT REFERENCES checkout_teams(id),
  order_id BIGINT REFERENCES checkout_orders(id),
  return_receipt_id BIGINT REFERENCES checkout_return_receipts(id),
  return_correction_id BIGINT REFERENCES checkout_return_corrections(id),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS checkout_orders_team_created_idx ON checkout_orders(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS checkout_orders_status_created_idx ON checkout_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS checkout_activity_created_idx ON checkout_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS checkout_transactions_created_idx ON checkout_inventory_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS checkout_order_events_order_created_idx ON checkout_order_events(order_id, created_at);
CREATE INDEX IF NOT EXISTS checkout_relationships_source_idx ON checkout_component_relationships(source_component_id);
CREATE INDEX IF NOT EXISTS checkout_relationships_target_idx ON checkout_component_relationships(target_component_id);
CREATE INDEX IF NOT EXISTS checkout_return_corrections_original_idx ON checkout_return_corrections(original_return_receipt_id);
CREATE INDEX IF NOT EXISTS checkout_return_correction_items_original_idx ON checkout_return_correction_items(original_return_item_id);
CREATE INDEX IF NOT EXISTS checkout_cooldown_overrides_team_idx
  ON checkout_order_cooldown_overrides(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS checkout_login_attempts_lookup_idx
  ON checkout_login_attempts(username, client_address, attempted_at DESC);

ALTER TABLE checkout_components ADD COLUMN IF NOT EXISTS image_alt TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_components ADD COLUMN IF NOT EXISTS bin_location TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_components ADD COLUMN IF NOT EXISTS technical_specs TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_components ADD COLUMN IF NOT EXISTS protected_stock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE checkout_components ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE checkout_components ADD COLUMN IF NOT EXISTS arduino_guidance TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_components ADD COLUMN IF NOT EXISTS raspberry_pi_guidance TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_components ADD COLUMN IF NOT EXISTS mlh_quantity INTEGER;

UPDATE checkout_components
   SET mlh_quantity = CASE
     -- Preserve inventory that was already reserved or checked out before the
     -- MLH allocation column existed. Treat only the unallocated remainder as
     -- MLH-managed so this migration cannot invalidate live orders.
     WHEN admin_notes ILIKE '%Source: MLH.%' THEN
       GREATEST(0, total_quantity - reserved_quantity - checked_out_quantity - unavailable_quantity)
     WHEN LOWER(name) = 'moisture sensor' AND admin_notes ILIKE '%Source: CURC, MLH.%' THEN
       LEAST(2, GREATEST(0, total_quantity - reserved_quantity - checked_out_quantity - unavailable_quantity))
     ELSE 0
   END
 WHERE mlh_quantity IS NULL;

ALTER TABLE checkout_components ALTER COLUMN mlh_quantity SET DEFAULT 0;
ALTER TABLE checkout_components ALTER COLUMN mlh_quantity SET NOT NULL;
ALTER TABLE checkout_components DROP CONSTRAINT IF EXISTS checkout_components_check;

-- Avoid dropping and rebuilding the inventory constraint on every serverless
-- cold start. Besides taking an unnecessary table lock, rebuilding it lets one
-- inconsistent row prevent the entire checkout API from starting.
DO $$
DECLARE
  inventory_constraint_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
    INTO inventory_constraint_definition
    FROM pg_constraint
   WHERE conrelid = 'checkout_components'::regclass
     AND conname = 'checkout_components_inventory_balance_check';

  IF inventory_constraint_definition IS NULL OR inventory_constraint_definition NOT ILIKE '%mlh_quantity%' THEN
    ALTER TABLE checkout_components DROP CONSTRAINT IF EXISTS checkout_components_inventory_balance_check;
    ALTER TABLE checkout_components ADD CONSTRAINT checkout_components_inventory_balance_check
      CHECK (mlh_quantity >= 0 AND mlh_quantity + reserved_quantity + checked_out_quantity + unavailable_quantity <= total_quantity);
  END IF;
END
$$;

ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS receipt_code TEXT UNIQUE;
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS accepted_by BIGINT REFERENCES checkout_users(id);
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS ready_by BIGINT REFERENCES checkout_users(id);
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS picked_up_by BIGINT REFERENCES checkout_users(id);
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS cancelled_by BIGINT REFERENCES checkout_users(id);
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS reservation_expires_at TIMESTAMPTZ;
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS cancellation_note TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS protected_stock_override_by BIGINT REFERENCES checkout_users(id);
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS protected_stock_override_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS protected_stock_override_at TIMESTAMPTZ;
ALTER TABLE checkout_orders DROP CONSTRAINT IF EXISTS checkout_orders_status_check;
ALTER TABLE checkout_orders ADD CONSTRAINT checkout_orders_status_check
  CHECK (status IN ('submitted', 'reviewing', 'accepted', 'ready', 'picked_up', 'cancelled', 'expired'));

ALTER TABLE checkout_order_items ADD COLUMN IF NOT EXISTS component_name_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_order_items ADD COLUMN IF NOT EXISTS component_image_url_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_order_items ADD COLUMN IF NOT EXISTS component_image_alt_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_order_items ADD COLUMN IF NOT EXISTS component_category_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE checkout_return_receipts ADD COLUMN IF NOT EXISTS receipt_code TEXT UNIQUE;
ALTER TABLE checkout_return_items ADD COLUMN IF NOT EXISTS component_name_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_idempotency_requests ADD COLUMN IF NOT EXISTS request_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE checkout_activity ADD COLUMN IF NOT EXISTS return_receipt_id BIGINT REFERENCES checkout_return_receipts(id);
ALTER TABLE checkout_activity ADD COLUMN IF NOT EXISTS return_correction_id BIGINT REFERENCES checkout_return_corrections(id);

CREATE INDEX IF NOT EXISTS checkout_activity_return_receipt_idx ON checkout_activity(return_receipt_id);
CREATE INDEX IF NOT EXISTS checkout_activity_return_correction_idx ON checkout_activity(return_correction_id);

UPDATE checkout_orders SET receipt_code = 'O-' || LPAD(id::text, 5, '0') WHERE receipt_code IS NULL;
UPDATE checkout_return_receipts SET receipt_code = 'R-' || LPAD(id::text, 5, '0') WHERE receipt_code IS NULL;
UPDATE checkout_activity activity
   SET return_receipt_id = receipts.id
  FROM checkout_return_receipts receipts
 WHERE activity.return_receipt_id IS NULL
   AND activity.team_id = receipts.team_id
   AND activity.message LIKE '% ' || receipts.receipt_code || '.%';
UPDATE checkout_activity activity
   SET return_correction_id = corrections.id
  FROM checkout_return_corrections corrections
 WHERE activity.return_correction_id IS NULL
   AND activity.team_id = corrections.team_id
   AND activity.message LIKE '% ' || corrections.receipt_code || ' correcting %';
UPDATE checkout_order_items items
   SET component_name_snapshot = components.name,
       component_image_url_snapshot = components.image_url,
       component_image_alt_snapshot = components.image_alt,
       component_category_snapshot = components.category
  FROM checkout_components components
 WHERE items.component_id = components.id AND items.component_name_snapshot = '';
UPDATE checkout_return_items items
   SET component_name_snapshot = components.name
  FROM checkout_components components
 WHERE items.component_id = components.id AND items.component_name_snapshot = '';
UPDATE checkout_components
   SET active = FALSE
 WHERE active = TRUE AND (image_url = '' OR image_alt = '');
