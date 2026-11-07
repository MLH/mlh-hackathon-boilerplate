const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CHECKOUT_PGLITE_PATH = "memory://";
process.env.CHECKOUT_FORCE_LIVE = "true";

const { getDatabase, resetDatabaseForTests } = require("../api/_lib/checkout-db");
const { REMOVED_COMPONENT_NAMES, applyComponentRemovals } = require("../scripts/remove-checkout-components");

test("confirmed obsolete inventory is removed idempotently while audit history remains", async function () {
  const database = await getDatabase();
  await database.query(
    `INSERT INTO checkout_users (username, password_hash, role, display_name)
     VALUES ('removal-auditor', 'not-used-in-this-test', 'admin', 'Removal Auditor')`
  );
  const actor = (await database.query("SELECT id FROM checkout_users WHERE username = 'removal-auditor'")).rows[0];

  for (const name of REMOVED_COMPONENT_NAMES) {
    await database.query(
      `INSERT INTO checkout_components
        (name, category, compatibility, total_quantity, max_active_per_team, active)
       VALUES ($1, 'Electronics', 'N/A', 40, 5, FALSE)`,
      [name]
    );
  }
  const firstComponent = (await database.query(
    "SELECT id FROM checkout_components WHERE name = $1",
    [REMOVED_COMPONENT_NAMES[0]]
  )).rows[0];
  await database.query(
    `INSERT INTO checkout_inventory_transactions
      (component_id, admin_id, actor_user_id, transaction_type, quantity, note)
     VALUES ($1, $2, $2, 'INVENTORY_ADJUSTMENT', 40, 'Original import')`,
    [firstComponent.id, actor.id]
  );

  const first = await applyComponentRemovals(database);
  assert.equal(first.removed.length, REMOVED_COMPONENT_NAMES.length);
  assert.equal(Number((await database.query("SELECT COUNT(*) AS count FROM checkout_components")).rows[0].count), 0);
  assert.equal((await database.query("SELECT component_id FROM checkout_inventory_transactions")).rows[0].component_id, null);

  const second = await applyComponentRemovals(database);
  assert.equal(second.removed.length, 0);
  assert.deepEqual(second.unchanged, REMOVED_COMPONENT_NAMES);
  await resetDatabaseForTests();
});
