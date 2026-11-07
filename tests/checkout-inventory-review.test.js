const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ARCHIVED_COMPONENT_NAMES,
  COMPONENT_UPDATES,
  ULTRASONIC_CURC_NAME,
  ULTRASONIC_MLH_NAME,
  reviewCatalog
} = require("../scripts/apply-inventory-review-2026-11-05");

const catalogPath = path.join(process.cwd(), "db", "checkout-catalog.json");

test("the organizer inventory review is reflected in the finalized catalog", function () {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const reviewed = reviewCatalog(catalog);
  assert.deepEqual(reviewed, catalog, "the catalog review should be idempotent");

  const components = new Map(catalog.components.map(function (component) {
    return [component.name, component];
  }));

  for (const name of ARCHIVED_COMPONENT_NAMES) {
    assert.equal(components.has(name), false, `${name} should be permanently removed`);
  }

  for (const [name, patch] of Object.entries(COMPONENT_UPDATES)) {
    if (["Display", "ESP (Wifi + Bluetooth) with Camera", "DC Barrel Jack to Female Thing", "Motor Shield V2.3", "10Pcs Pressure Resistance Strain Gauge", "Heart Rate Sensor"].includes(name)) continue;
    const currentNames = {"ESP32-CAM Development Board with USB Programmer":"ESP32-CAM Camera Development Module","Solderless Breadboard":"Solderless Breadboard (full)","Wall power supply":"Facmogu Adjustable DC Power Supply","50Pcs Potentiometer Kit":"Potentiometers","S3004 servo":"FUTABA S3004 servo"};
    const component = components.get(require('../scripts/inventory-name-policy').correctedName(currentNames[name] || name));
    assert.ok(component, name);
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'description' && currentNames[name]) continue;
      assert.deepEqual(component[key], value, `${name}.${key}`);
    }
  }

  const curc = components.get(ULTRASONIC_CURC_NAME);
  const mlh = components.get(ULTRASONIC_MLH_NAME);
  assert.equal(curc.totalQuantity, 6);
  assert.equal(curc.mlhQuantity, 0);
  assert.equal(curc.maxActivePerTeam, 2);
  assert.equal(mlh.totalQuantity, 3);
  assert.equal(mlh.mlhQuantity, 3);
  assert.equal(mlh.maxActivePerTeam, 2);

  assert.equal(components.has("Display"), false);
  assert.equal(components.get("Graphic LCD Display TFT").imageUrl, "/images/checkout/components/Graphic LCD Display TFT.webp");
  assert.equal(components.get("RPI Kit").arduinoGuidance, "");
  assert.equal(
    components.get("Raspberry Pi 5 (2GB)").imageUrl,
    components.get("Raspberry Pi 4 (1GB)").imageUrl
  );
  assert.equal(
    components.get("Raspberry Pi 5 (4GB)").imageUrl,
    components.get("Raspberry Pi 4 (1GB)").imageUrl
  );

  const stepperDriver = catalog.relationships.find(function (relationship) {
    return relationship.sourceName === "28BYJ-48 stepper" &&
      relationship.targetName === "4 Phase ULN2003 Stepper Motor Driver";
  });
  assert.ok(stepperDriver);
  assert.equal(stepperDriver.relationType, "requires");
  assert.match(stepperDriver.message, /requires one ULN2003 driver/i);

  assert.match(components.get("9g Micro Servo").adminNotes, /Source: MLH/i);
  assert.match(components.get("SG90 Servo").adminNotes, /Source: CURC/i);
});

test("new organizer photos exist with matching thumbnails", function () {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const imageDirectory = path.join(process.cwd(), "images", "checkout", "components");
  const reviewedNames = Object.keys(COMPONENT_UPDATES).concat(["Graphic LCD Display TFT"]);
  const components = catalog.components.filter(function (component) {
    return reviewedNames.includes(component.name) && /\/images\/checkout\/components\/.+\.webp$/i.test(component.imageUrl);
  });

  for (const component of components) {
    const filename = path.basename(component.imageUrl);
    assert.equal(fs.existsSync(path.join(imageDirectory, filename)), true, filename);
    assert.equal(fs.existsSync(path.join(imageDirectory, "thumbnails", filename)), true, `thumbnail ${filename}`);
  }
});
