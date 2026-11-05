const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CHECKOUT_PGLITE_PATH = "memory://";
process.env.CHECKOUT_FORCE_LIVE = "true";

const { getDatabase, resetDatabaseForTests } = require("../api/_lib/checkout-db");
const { applyLocalImages } = require("../scripts/apply-checkout-local-images");

test("organizer-provided photos are applied and the missing Pin Headers entry is created idempotently", async function () {
  const database = await getDatabase();
  await database.query(
    `INSERT INTO checkout_users (username, password_hash, role, display_name)
     VALUES ('image-auditor', 'not-used-in-this-test', 'admin', 'Image Auditor')`
  );
  await database.query(
    `INSERT INTO checkout_components
      (name, description, image_url, image_alt, category, compatibility, total_quantity, mlh_quantity, max_active_per_team, active)
     VALUES ('Capacitor', 'Test capacitor', '/images/checkout-image-pending.svg', 'Photo pending review for Capacitor', 'Electronics', 'N/A', 20, 0, 5, TRUE),
            ('Google Home Mini', 'Test MLH smart speaker', '/images/checkout-image-pending.svg', 'Photo pending review for Google Home Mini', 'Communication', 'N/A', 2, 2, 1, TRUE)`
  );

  const first = await applyLocalImages(database);
  assert.deepEqual(first.created, [{ name: "Pin Headers", totalQuantity: 25 }]);
  assert.ok(first.updated.includes("Capacitor"));

  const stored = await database.query(
    "SELECT name, image_url, image_alt, total_quantity, mlh_quantity, protected_stock FROM checkout_components WHERE name IN ('Capacitor', 'Google Home Mini', 'Pin Headers') ORDER BY name"
  );
  assert.equal(stored.rows[0].image_url, "/images/checkout/components/capacitor.webp");
  assert.equal(stored.rows[1].image_url, "/images/checkout/components/google home mini.webp");
  assert.equal(Number(stored.rows[1].mlh_quantity), 2);
  assert.equal(stored.rows[2].image_url, "/images/checkout/components/Pin headers.webp");
  assert.equal(Number(stored.rows[2].total_quantity), 25);
  assert.equal(Number(stored.rows[2].protected_stock), 2);

  const second = await applyLocalImages(database);
  assert.equal(second.created.length, 0);
  assert.ok(second.unchanged.includes("Capacitor"));
  assert.ok(second.unchanged.includes("Pin Headers"));
  await resetDatabaseForTests();
});
