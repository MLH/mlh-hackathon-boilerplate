const fs = require("node:fs/promises");
const path = require("node:path");
const { getDatabase, resetDatabaseForTests } = require("../api/_lib/checkout-db");
const service = require("../api/_lib/checkout-service");
const LOCAL_COMPONENT_IMAGES = require("./checkout-local-images.json");

const PIN_HEADERS = {
  name: "Pin Headers",
  description: "Breakaway male pin-header strips for adding board connections, making adapters, and exposing signals. Cut or snap off the required number of positions and solder them in place.",
  imageUrl: "/images/checkout/components/Pin headers.webp",
  imageAlt: "Product photo of breakaway male pin-header strips",
  category: "Electronics",
  compatibility: "N/A",
  arduinoGuidance: "Use the number of positions needed for the board or shield, and verify the row spacing before soldering.",
  raspberryPiGuidance: "Use only for passive board connections; confirm the target board's pinout and voltage before wiring it to Raspberry Pi GPIO.",
  binLocation: "",
  technicalSpecs: "Verify pitch, row count, and pin length against the target board before cutting or soldering.",
  totalQuantity: 25,
  unavailableQuantity: 0,
  protectedStock: 2,
  maxActivePerTeam: 5,
  active: true,
  adminNotes: "Added from the organizer-provided inventory update with a stated quantity of 25.",
  relationships: []
};

function updateInput(component, image) {
  return {
    id: component.id,
    expectedVersion: component.version,
    name: component.name,
    description: component.description,
    imageUrl: `/images/checkout/components/${image.file}`,
    imageAlt: image.alt,
    category: component.category,
    compatibility: component.compatibility,
    arduinoGuidance: component.arduinoGuidance,
    raspberryPiGuidance: component.raspberryPiGuidance,
    binLocation: component.binLocation,
    technicalSpecs: component.technicalSpecs,
    totalQuantity: component.totalQuantity,
    mlhQuantity: component.mlhQuantity,
    unavailableQuantity: component.unavailableQuantity,
    protectedStock: component.protectedStock,
    maxActivePerTeam: component.maxActivePerTeam,
    active: component.active,
    adminNotes: component.adminNotes,
    relationships: component.relationships,
    changeReason: `Attached organizer-provided local photo ${image.file}.`
  };
}

async function verifyFiles() {
  for (const image of LOCAL_COMPONENT_IMAGES) {
    await fs.access(path.join(__dirname, "..", "images", "checkout", "components", image.file));
  }
}

async function applyLocalImages(database) {
  await verifyFiles();
  const actorResult = await database.query(
    "SELECT id, username, role, display_name FROM checkout_users WHERE role = 'admin' AND active = TRUE ORDER BY id LIMIT 1"
  );
  const actorRow = actorResult.rows[0];
  if (!actorRow) throw new Error("Seed an active admin before applying local component photos.");
  const actor = {
    id: Number(actorRow.id),
    username: actorRow.username,
    role: actorRow.role,
    display_name: actorRow.display_name,
    displayName: actorRow.display_name
  };

  let components = await service.catalog(database, actor, true);
  let byName = new Map(components.map(function (component) {
    return [component.name.toLocaleLowerCase("en-US"), component];
  }));
  const result = { created: [], updated: [], unchanged: [], missing: [] };

  if (!byName.has(PIN_HEADERS.name.toLocaleLowerCase("en-US"))) {
    const created = await service.saveComponent(database, PIN_HEADERS, actor);
    result.created.push({ name: created.name, totalQuantity: created.totalQuantity });
    components = await service.catalog(database, actor, true);
    byName = new Map(components.map(function (component) {
      return [component.name.toLocaleLowerCase("en-US"), component];
    }));
  }

  for (const image of LOCAL_COMPONENT_IMAGES) {
    const component = byName.get(image.name.toLocaleLowerCase("en-US"));
    if (!component) {
      result.missing.push(image.name);
      continue;
    }
    const imageUrl = `/images/checkout/components/${image.file}`;
    if (component.imageUrl === imageUrl && component.imageAlt === image.alt) {
      result.unchanged.push(image.name);
      continue;
    }
    const updated = await service.saveComponent(database, updateInput(component, image), actor);
    result.updated.push(updated.name);
    byName.set(updated.name.toLocaleLowerCase("en-US"), updated);
  }
  return result;
}

async function main() {
  const database = await getDatabase();
  const result = await applyLocalImages(database);
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

module.exports = { LOCAL_COMPONENT_IMAGES, PIN_HEADERS, applyLocalImages };
