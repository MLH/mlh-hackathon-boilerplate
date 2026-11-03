const fs = require("node:fs");
const path = require("node:path");
const { getDatabase } = require("../api/_lib/checkout-db");

const DEFAULT_INPUT = path.join(process.cwd(), "db", "checkout-catalog.json");

function readCatalog(filename) {
  const catalog = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (catalog.version !== 1 || !Array.isArray(catalog.components) || !Array.isArray(catalog.relationships)) {
    throw new Error("The checkout catalog snapshot is not in the expected format.");
  }
  return catalog;
}

function catalogMlhQuantity(component) {
  if (component.mlhQuantity != null) {
    return Number(component.mlhQuantity);
  }

  const notes = String(component.adminNotes || "");
  if (/Source:\s*MLH\./i.test(notes)) {
    return Number(component.totalQuantity);
  }
  if (/^Moisture sensor$/i.test(component.name) && /Source:\s*CURC,\s*MLH\./i.test(notes)) {
    return 2;
  }
  return 0;
}

async function importCatalog(database, catalog) {
  return database.transaction(async function (transaction) {
    const existing = await transaction.query("SELECT COUNT(*) AS count FROM checkout_components");
    if (Number(existing.rows[0].count) !== 0) {
      throw new Error("Catalog import is allowed only when checkout_components is empty.");
    }

    const adminResult = await transaction.query(
      "SELECT id FROM checkout_users WHERE role = 'admin' AND active = TRUE ORDER BY id LIMIT 1"
    );
    const admin = adminResult.rows[0];
    if (!admin) {
      throw new Error("Provision at least one active admin before importing the catalog.");
    }

    const ids = new Map();
    for (const component of catalog.components) {
      if (ids.has(component.name)) {
        throw new Error(`Duplicate component name in catalog snapshot: ${component.name}`);
      }
      const inserted = await transaction.query(
        `INSERT INTO checkout_components
          (name, description, image_url, image_alt, category, compatibility,
           arduino_guidance, raspberry_pi_guidance, bin_location, technical_specs,
           total_quantity, mlh_quantity, unavailable_quantity, protected_stock,
           max_active_per_team, active, admin_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING id`,
        [component.name, component.description, component.imageUrl, component.imageAlt,
          component.category, component.compatibility, component.arduinoGuidance,
          component.raspberryPiGuidance, component.binLocation, component.technicalSpecs,
          component.totalQuantity, catalogMlhQuantity(component), component.unavailableQuantity, component.protectedStock,
          component.maxActivePerTeam, component.active, component.adminNotes]
      );
      const id = Number(inserted.rows[0].id);
      ids.set(component.name, id);
      await transaction.query(
        `INSERT INTO checkout_inventory_transactions
          (component_id, admin_id, actor_user_id, transaction_type, quantity, new_state, note)
         VALUES ($1, $2, $2, 'INVENTORY_ADJUSTMENT', $3, $4, $5)`,
        [id, admin.id, component.totalQuantity, JSON.stringify(component), "Imported finalized MakeCU 2026 catalog snapshot."]
      );
    }

    for (const relationship of catalog.relationships) {
      const sourceId = ids.get(relationship.sourceName);
      const targetId = ids.get(relationship.targetName);
      if (!sourceId || !targetId) {
        throw new Error(`Catalog relationship references an unknown component: ${relationship.sourceName} -> ${relationship.targetName}`);
      }
      await transaction.query(
        `INSERT INTO checkout_component_relationships
          (source_component_id, target_component_id, relation_type, quantity_ratio,
           minimum_source_quantity, message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sourceId, targetId, relationship.relationType, relationship.quantityRatio,
          relationship.minimumSourceQuantity, relationship.message]
      );
    }

    await transaction.query(
      `INSERT INTO checkout_activity (actor_user_id, message)
       VALUES ($1, $2)`,
      [admin.id, `Imported ${catalog.components.length} finalized inventory components.`]
    );
    return { componentCount: catalog.components.length, relationshipCount: catalog.relationships.length };
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required so the catalog cannot be imported into a temporary local database by mistake.");
  }
  const inputPath = path.resolve(process.argv[2] || DEFAULT_INPUT);
  const catalog = readCatalog(inputPath);
  const database = await getDatabase();
  const result = await importCatalog(database, catalog);
  process.stdout.write(`Imported ${result.componentCount} components and ${result.relationshipCount} relationships.\n`);
  await database.close();
}

if (require.main === module) {
  main().catch(function (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { catalogMlhQuantity, importCatalog, readCatalog };
