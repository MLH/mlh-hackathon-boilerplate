const { getDatabase, resetDatabaseForTests } = require("../api/_lib/checkout-db");

const REMOVED_COMPONENT_NAMES = [
  "10pc Jumpers Pack",
  "Jumpers",
  "Female to Female Jumper Wire",
  "Male to Female Jumper Wire",
  "Male to Male Jumper Wire",
  "Rocker Switch",
  "1309 Series Sonic Hub (6mm Bore)",
  "Elegoo starter Kit",
  "Hex Inverter Buffer",
  "Packs of mounting/replacement",
  "Pair of Pluggable Terminal Block",
  "Passive Eletronics Kit",
  "Rotors",
  "Sensor Kit",
  "Sensors from Elegoo sensor Kit",
  "Motor Replacement Package",
  "Thin Film Precision Resistor",
  "Vesc NRF dongle",
  "Vesc motor controllers",
  "Wireless Charger",
  "550 Titan 12-Turn",
  "Dark motors with no name",
  "Motor with PCB soldered",
  "Photosensitive Sensors",
  "Reed Sensor",
  "Tilt Switches",
  "Weighing Sensor",
  "Large Storage box",
  "Plastic storage boxes"
];

async function historicalReferenceCount(transaction, componentId) {
  const result = await transaction.query(
    `SELECT
       (SELECT COUNT(*) FROM checkout_order_items WHERE component_id = $1) +
       (SELECT COUNT(*) FROM checkout_team_inventory WHERE component_id = $1) +
       (SELECT COUNT(*) FROM checkout_return_items WHERE component_id = $1) +
       (SELECT COUNT(*) FROM checkout_return_correction_items WHERE component_id = $1) AS count`,
    [componentId]
  );
  return Number(result.rows[0].count);
}

async function applyComponentRemovals(database) {
  return database.transaction(async function (transaction) {
    const actorResult = await transaction.query(
      "SELECT id FROM checkout_users WHERE role = 'admin' AND active = TRUE ORDER BY id LIMIT 1"
    );
    const actor = actorResult.rows[0];
    if (!actor) throw new Error("Seed an active admin before removing untracked components.");

    const result = { removed: [], unchanged: [] };
    for (const name of REMOVED_COMPONENT_NAMES) {
      const componentResult = await transaction.query(
        "SELECT * FROM checkout_components WHERE LOWER(name) = LOWER($1) FOR UPDATE",
        [name]
      );
      const component = componentResult.rows[0];
      if (!component) {
        result.unchanged.push(name);
        continue;
      }

      const allocated = Number(component.reserved_quantity) + Number(component.checked_out_quantity);
      if (allocated > 0) {
        throw new Error(`${component.name} still has ${allocated} reserved or checked-out units and cannot be removed.`);
      }
      const references = await historicalReferenceCount(transaction, component.id);
      if (references > 0) {
        throw new Error(`${component.name} has ${references} order, holding, or return references. Preserve it as an archived item instead of deleting it.`);
      }

      await transaction.query(
        "DELETE FROM checkout_component_relationships WHERE source_component_id = $1 OR target_component_id = $1",
        [component.id]
      );
      await transaction.query(
        "UPDATE checkout_inventory_transactions SET component_id = NULL WHERE component_id = $1",
        [component.id]
      );
      await transaction.query("DELETE FROM checkout_components WHERE id = $1", [component.id]);
      await transaction.query(
        "INSERT INTO checkout_activity (actor_user_id, message) VALUES ($1, $2)",
        [actor.id, `Permanently removed ${component.name} from tracked inventory after confirming it had no order, holding, or return references.`]
      );
      result.removed.push({ name: component.name, totalQuantity: Number(component.total_quantity) });
    }
    return result;
  });
}

async function main() {
  const database = await getDatabase();
  const result = await applyComponentRemovals(database);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await resetDatabaseForTests();
}

if (require.main === module) {
  main().catch(async function (error) {
    console.error(error);
    await resetDatabaseForTests().catch(function () {});
    process.exitCode = 1;
  });
}

module.exports = { REMOVED_COMPONENT_NAMES, applyComponentRemovals };
