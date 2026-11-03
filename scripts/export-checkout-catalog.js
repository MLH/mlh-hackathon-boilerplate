const fs = require("node:fs");
const path = require("node:path");
const { getDatabase } = require("../api/_lib/checkout-db");

const DEFAULT_OUTPUT = path.join(process.cwd(), "db", "checkout-catalog.json");

async function exportCatalog(database) {
  const components = await database.query(
    `SELECT name, description, image_url, image_alt, category, compatibility,
            arduino_guidance, raspberry_pi_guidance, bin_location, technical_specs,
            total_quantity, mlh_quantity, unavailable_quantity, protected_stock, max_active_per_team,
            active, admin_notes
       FROM checkout_components
      ORDER BY category, name`
  );
  const relationships = await database.query(
    `SELECT sources.name AS source_name, targets.name AS target_name,
            relationships.relation_type, relationships.quantity_ratio,
            relationships.minimum_source_quantity, relationships.message
       FROM checkout_component_relationships relationships
       JOIN checkout_components sources ON sources.id = relationships.source_component_id
       JOIN checkout_components targets ON targets.id = relationships.target_component_id
      ORDER BY sources.name, targets.name, relationships.relation_type`
  );

  return {
    version: 1,
    source: "Finalized MakeCU 2026 checkout catalog",
    components: components.rows.map(function (row) {
      return {
        name: row.name,
        description: row.description,
        imageUrl: row.image_url,
        imageAlt: row.image_alt,
        category: row.category,
        compatibility: row.compatibility,
        arduinoGuidance: row.arduino_guidance,
        raspberryPiGuidance: row.raspberry_pi_guidance,
        binLocation: row.bin_location,
        technicalSpecs: row.technical_specs,
        totalQuantity: Number(row.total_quantity),
        mlhQuantity: Number(row.mlh_quantity || 0),
        unavailableQuantity: Number(row.unavailable_quantity),
        protectedStock: Number(row.protected_stock),
        maxActivePerTeam: row.max_active_per_team == null ? null : Number(row.max_active_per_team),
        active: row.active,
        adminNotes: row.admin_notes
      };
    }),
    relationships: relationships.rows.map(function (row) {
      return {
        sourceName: row.source_name,
        targetName: row.target_name,
        relationType: row.relation_type,
        quantityRatio: Number(row.quantity_ratio),
        minimumSourceQuantity: Number(row.minimum_source_quantity),
        message: row.message
      };
    })
  };
}

async function main() {
  const outputPath = path.resolve(process.argv[2] || DEFAULT_OUTPUT);
  const database = await getDatabase();
  const catalog = await exportCatalog(database);
  fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  process.stdout.write(`Exported ${catalog.components.length} components and ${catalog.relationships.length} relationships to ${outputPath}.\n`);
  await database.close();
}

if (require.main === module) {
  main().catch(function (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { exportCatalog };
