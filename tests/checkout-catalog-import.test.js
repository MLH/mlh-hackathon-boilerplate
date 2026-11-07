const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.CHECKOUT_PGLITE_PATH = "memory://";

const { getDatabase, resetDatabaseForTests } = require("../api/_lib/checkout-db");
const { importCatalog, readCatalog } = require("../scripts/import-checkout-catalog");

const catalogPath = path.join(process.cwd(), "db", "checkout-catalog.json");

test("the finalized catalog imports atomically only into an empty inventory", async function () {
  const database = await getDatabase();
  await database.query(
    `INSERT INTO checkout_users (username, password_hash, role, display_name)
     VALUES ('catalog-admin', 'not-used-in-this-test', 'admin', 'Catalog Admin')`
  );
  const catalog = readCatalog(catalogPath);
  const result = await importCatalog(database, catalog);

  assert.deepEqual(result, { componentCount: catalog.components.length, relationshipCount: catalog.relationships.length });
  const counts = await database.query(
    `SELECT
       (SELECT COUNT(*) FROM checkout_components) AS components,
       (SELECT COUNT(*) FROM checkout_component_relationships) AS relationships,
       (SELECT COUNT(*) FROM checkout_inventory_transactions) AS transactions`
  );
  assert.equal(Number(counts.rows[0].components), catalog.components.length);
  assert.equal(Number(counts.rows[0].relationships), 14);
  assert.equal(Number(counts.rows[0].transactions), catalog.components.length);
  const mlh = await database.query(
    `SELECT
       COUNT(*) FILTER (WHERE mlh_quantity = total_quantity AND total_quantity > 0) AS mlh_only,
       MAX(mlh_quantity) FILTER (WHERE LOWER(name) = 'moisture sensor') AS moisture_mlh
       FROM checkout_components`
  );
  assert.equal(Number(mlh.rows[0].mlh_only), 52);
  assert.equal(Number(mlh.rows[0].moisture_mlh), 2);
  await assert.rejects(importCatalog(database, catalog), /only when checkout_components is empty/);
  await resetDatabaseForTests();
});

test("all local catalog photos have full and thumbnail WebP files", function () {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const localPhotos = catalog.components
    .map(function (component) { return component.imageUrl; })
    .filter(function (url) { return /^\/images\/checkout\/components\/[^/]+\.webp$/i.test(url); });

  for (const url of localPhotos) {
    const name = path.basename(url);
    assert.equal(fs.existsSync(path.join(process.cwd(), "images", "checkout", "components", name)), true, name);
    assert.equal(fs.existsSync(path.join(process.cwd(), "images", "checkout", "components", "thumbnails", name)), true, `thumbnail ${name}`);
  }
});
