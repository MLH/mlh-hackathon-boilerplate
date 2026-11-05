const fs = require("node:fs");
const path = require("node:path");
const { getDatabase, resetDatabaseForTests } = require("../api/_lib/checkout-db");
const service = require("../api/_lib/checkout-service");

const CHANGE_REASON = "Applied organizer inventory review from 2026-11-05.";

const COMPONENT_UPDATES = {
  "Dweii Mini Speaker": { maxActivePerTeam: 1 },
  "Touch Button": { maxActivePerTeam: 3 },
  "Arducam 5MP Camera": { maxActivePerTeam: 1 },
  "ESP32-CAM Development Board with USB Programmer": { maxActivePerTeam: 1 },
  "ESP (Wifi + Bluetooth) with Camera": { maxActivePerTeam: 1 },
  "USB Cameras": { maxActivePerTeam: 1 },
  "Pseudo-LiDAR Sensor": { maxActivePerTeam: 1 },
  "10k Trimmer": { compatibility: "N/A" },
  "5V 650nm 5mW Red Dot Laser": { maxActivePerTeam: 2 },
  "7 Segment Serial Display": { compatibility: "Arduino + Raspberry Pi" },
  "Display": {
    name: "Graphic LCD Display TFT",
    imageUrl: "/images/checkout/components/Graphic LCD Display TFT.webp",
    imageAlt: "Product photo of a graphic TFT LCD display with controller board"
  },
  "Graphic LCD Display TFT": {
    imageUrl: "/images/checkout/components/Graphic LCD Display TFT.webp",
    imageAlt: "Product photo of a graphic TFT LCD display with controller board"
  },
  "Breadboards": {
    imageUrl: "/images/checkout/components/breadboards.webp",
    imageAlt: "Product photo of a solderless breadboard"
  },
  "DC 5V Relay Module": { maxActivePerTeam: 2 },
  "DC5V Black Mini Active Piezo Buzzers": { maxActivePerTeam: 3 },
  "Grove LCD": {
    imageUrl: "/images/checkout/components/Grove LCD.webp",
    imageAlt: "Product photo of a Grove RGB-backlit character LCD module"
  },
  "Grove LED": {
    imageUrl: "/images/checkout/components/Grove LED.webp",
    imageAlt: "Product photo of a Grove LED module"
  },
  "Grove Wire": {
    imageUrl: "/images/checkout/components/Grove Wire.webp",
    imageAlt: "Product photo of Grove-compatible four-conductor cables"
  },
  "Joystick": {
    imageUrl: "/images/checkout/components/joystick MLH.webp",
    imageAlt: "Product photo of a compact two-axis joystick"
  },
  "Load Cell Amplifier": {
    imageUrl: "/images/checkout/components/load cell amplifier MLH.webp",
    imageAlt: "Product photo of an HX711 load-cell amplifier breakout"
  },
  "Misc. LEDs": {
    imageUrl: "/images/checkout/components/Misc. LEDs.webp",
    imageAlt: "Product photo of assorted through-hole LEDs"
  },
  "LCD Display": { maxActivePerTeam: 1 },
  "Pin Headers": { maxActivePerTeam: 2 },
  "Pluggable Terminal Blocks": { maxActivePerTeam: 2 },
  "Resistor Kit": {
    imageUrl: "/images/checkout/components/resistor kit (MLH).webp",
    imageAlt: "Product photo of an assorted through-hole resistor kit"
  },
  "Sense CAP Indicator": {
    imageUrl: "/images/checkout/components/Sense CAP Indicator.webp",
    imageAlt: "Product photo of a SenseCAP Indicator display"
  },
  "Servo Driver": {
    description: "Adafruit 16-Channel 12-bit PWM/Servo Driver with an I2C interface, based on the PCA9685 controller. It generates stable PWM signals for up to 16 servos while using only two control lines.",
    technicalSpecs: "Adafruit PCA9685; 16 channels; 12-bit PWM; I2C interface.",
    imageUrl: "/images/checkout/components/Servo Driver.webp",
    imageAlt: "Product photo of an Adafruit PCA9685 16-channel PWM servo driver"
  },
  "Solderless Breadboard": { maxActivePerTeam: 1 },
  "SparkFun Snappable protoboard": {
    imageUrl: "/images/checkout/components/sparkfun snappable protoboard.webp",
    imageAlt: "Product photo of a SparkFun snappable protoboard"
  },
  "Through Hole Mosfet": {
    imageUrl: "/images/checkout/components/Through Hole Mosfet.webp",
    imageAlt: "Product illustration of a through-hole power MOSFET"
  },
  "Toggle Switch SPDT Panel Mount": {
    imageUrl: "/images/checkout/components/Toggle Switch SPDT Panel Mount.webp",
    imageAlt: "Product photo of a panel-mount SPDT toggle switch"
  },
  "USB 3.1TYPE male plug breakout": {
    imageUrl: "/images/checkout/components/usb 3.1 type male plug breakout.webp",
    imageAlt: "Product photo of a USB Type-C male plug breakout board"
  },
  "Vanja SD Card Reader": {
    imageUrl: "/images/checkout/components/vanja sd card reader.webp",
    imageAlt: "Product photo of a Vanja USB SD and microSD card reader"
  },
  "XBee Shield (Wireless transceiver)": {
    imageUrl: "/images/checkout/components/xbee shield.webp",
    imageAlt: "Product photo of an XBee wireless transceiver shield"
  },
  "Arduino and Base Shields": {
    imageUrl: "/images/checkout/components/arduino and base shields.webp",
    imageAlt: "Product photo of an Arduino with a Grove base shield"
  },
  "RPI Kit": {
    arduinoGuidance: "",
    imageUrl: "/images/checkout/components/RPI KIT.webp",
    imageAlt: "Product photo of a Raspberry Pi project kit with accessories"
  },
  "Raspberry Pi 5 (2GB)": {
    imageUrl: "/images/checkout/components/raspberry-pi-4-1gb-1071788d0f.webp",
    imageAlt: "Product photo of a Raspberry Pi board"
  },
  "Raspberry Pi 5 (4GB)": {
    imageUrl: "/images/checkout/components/raspberry-pi-4-1gb-1071788d0f.webp",
    imageAlt: "Product photo of a Raspberry Pi board"
  },
  "28BYJ-48 stepper": {
    imageUrl: "/images/checkout/components/28by j-48 stepper.webp",
    imageAlt: "Product photo of a 28BYJ-48 geared stepper motor",
    technicalSpecs: "Requires one 4 Phase ULN2003 Stepper Motor Driver."
  },
  "4 Phase ULN2003 Stepper Motor Driver": {
    imageUrl: "/images/checkout/components/4 Phase ULN2003 Stepper Motor Driver.webp",
    imageAlt: "Product photo of a four-phase ULN2003 stepper motor driver board"
  },
  "9g Micro Servo": {
    imageUrl: "/images/checkout/components/9g micro servo.webp",
    imageAlt: "Product photo of a blue 9 g micro servo"
  },
  "DC Gearbox": {
    imageUrl: "/images/checkout/components/dc gearbox.webp",
    imageAlt: "Product photo of a yellow DC gearbox motor"
  },
  "Grover Stepper Motor": {
    imageUrl: "/images/checkout/components/Grover stepper motor.webp",
    imageAlt: "Product photo of a compact geared stepper motor"
  },
  "Nema 17": {
    imageUrl: "/images/checkout/components/nema 17.webp",
    imageAlt: "Product photo of a NEMA 17 stepper motor"
  },
  "SG90 Servo": {
    imageUrl: "/images/checkout/components/SG90 Servo.webp",
    imageAlt: "Product photo of a blue SG90 micro servo"
  },
  "TT Gearbox motor": {
    imageUrl: "/images/checkout/components/TT Gearbox motor.webp",
    imageAlt: "Product photo of a yellow TT gearbox motor"
  },
  "Vibration Motors": {
    imageUrl: "/images/checkout/components/Vibration motors.webp",
    imageAlt: "Product photo of a coin-style vibration motor"
  },
  "Buck convertor (lipos to PIs)": { maxActivePerTeam: 2 },
  "DC Barrel Jack to Female Thing": {
    name: "DC Barrel Jack to Female",
    maxActivePerTeam: 3
  },
  "DC Barrel Jack to Female": { maxActivePerTeam: 3 },
  "DC Motors": {
    imageUrl: "/images/checkout/components/DC Motors.webp",
    imageAlt: "Product photo of a small brushed DC motor"
  },
  "Grove Buzzer": {
    imageUrl: "/images/checkout/components/Grove Buzzer.webp",
    imageAlt: "Product photo of a Grove buzzer module and cable"
  },
  "L298N motor driver": { maxActivePerTeam: 2 },
  "Motor Shield V2.0": {
    imageUrl: "/images/checkout/components/motor shield v2.0.webp",
    imageAlt: "Product photo of a Motor Shield V2.0"
  },
  "Motor Shield V2.3": {
    name: "Motor Shield V3.0",
    imageUrl: "/images/checkout/components/Motor shield v3.webp",
    imageAlt: "Product photo of a Motor Shield V3.0 controlling motors and servos"
  },
  "Motor Shield V3.0": {
    imageUrl: "/images/checkout/components/Motor shield v3.webp",
    imageAlt: "Product photo of a Motor Shield V3.0 controlling motors and servos"
  },
  "Ethernet Cable (1ft, 10GB)": { maxActivePerTeam: 1 },
  "SD Cards (16GB)": { maxActivePerTeam: 1 },
  "Wire Spool": {
    imageUrl: "/images/checkout/components/wire spool.webp",
    imageAlt: "Product photo of assorted hookup-wire spools"
  },
  "10Pcs Pressure Resistance Strain Gauge": {
    name: "Pressure Resistance Strain Gauge",
    maxActivePerTeam: 2
  },
  "Pressure Resistance Strain Gauge": { maxActivePerTeam: 2 },
  "12-key touch sensor": {
    imageUrl: "/images/checkout/components/12-key touch sensor.webp",
    imageAlt: "Product photo of a 12-key capacitive touch sensor board"
  },
  "4x4 Matrix Keypad": {
    imageUrl: "/images/checkout/components/4x4 matrix keypad.webp",
    imageAlt: "Product photo of a 4x4 matrix keypad"
  },
  "9-DOF IMU + TEMP sensor": {
    imageUrl: "/images/checkout/components/9-dof imu + temp sensor.webp",
    imageAlt: "Product photo of a 9-DOF IMU and temperature sensor board"
  },
  "Air Quality Sensor": {
    imageUrl: "/images/checkout/components/Air quality sensor.webp",
    imageAlt: "Product photo of an air-quality sensor breakout board"
  },
  "Barometer Sense Board": {
    imageUrl: "/images/checkout/components/barometer sense board.webp",
    imageAlt: "Product photo of a barometer and altimeter sensor board"
  },
  "Grove - Piezo Vibration Sensor": {
    imageUrl: "/images/checkout/components/Grove - Piezo Vibration Sensor.webp",
    imageAlt: "Product photo of a Grove piezo vibration sensor"
  },
  "Grove 3 Axis Digital": {
    imageUrl: "/images/checkout/components/grove 3 axis digital.webp",
    imageAlt: "Product photo of a Grove three-axis digital sensor"
  },
  "Grove Light Sensor": {
    imageUrl: "/images/checkout/components/Grove light sensor.webp",
    imageAlt: "Product photo of a Grove light sensor module"
  },
  "Grove Rotary Angle Sensor": {
    imageUrl: "/images/checkout/components/Grove Rotary angle sensor.webp",
    imageAlt: "Product photo of a Grove rotary angle sensor and cable"
  },
  "IMU": { maxActivePerTeam: 2 },
  "Heart Rate Sensor": { maxActivePerTeam: 1 },
  "MAX30102 Pulse Oximeter (Heart Rate + SpO₂)": { maxActivePerTeam: 1 },
  "GPS Module": { maxActivePerTeam: 1 },
  "Encoder Sensor - slotted optical interrupter": { maxActivePerTeam: 2 },
  "5MM Phototransistor": { maxActivePerTeam: 2 },
  "3MM Photodiode": { maxActivePerTeam: 3 },
  "41mm Piezo Disc": { maxActivePerTeam: 3 },
  "IR Break Beam Sensor": {
    imageUrl: "/images/checkout/components/IR Break Beam Sensor.webp",
    imageAlt: "Product photo of an infrared break-beam sensor pair"
  },
  "IR Break Beam Sensor 1528-2526-ND": {
    imageUrl: "/images/checkout/components/IR Break Beam Sensor 1528-2526-ND.webp",
    imageAlt: "Product photo of an infrared break-beam transmitter and receiver pair"
  },
  "MP503 Gas Sensor": { maxActivePerTeam: 1 },
  "RGB Color Sensor with IR Filter": {
    imageUrl: "/images/checkout/components/RGB Color Sensor with IR Filter.webp",
    imageAlt: "Product photo of a TCS34725 RGB color sensor with IR filter"
  },
  "SEN-14585 (fingerprint)": {
    imageUrl: "/images/checkout/components/SEN-14585 (fingerprint).webp",
    imageAlt: "Product photo of a SEN-14585 fingerprint sensor module"
  },
  "Temperature Sensor": { maxActivePerTeam: 2 },
  "Thin Film Pressure Sensor": { maxActivePerTeam: 1 },
  "Curved Tweezers EROP7SA-ND": {
    imageUrl: "/images/checkout/components/Curved Tweezers EROP7SA-ND.webp",
    imageAlt: "Product photo of curved precision tweezers"
  },
  "DMM": {
    imageUrl: "/images/checkout/components/DMM.webp",
    imageAlt: "Product photo of a digital multimeter"
  },
  "Flush Cutters 170MN-ND": {
    imageUrl: "/images/checkout/components/Flush Cutters 170MN-ND.webp",
    imageAlt: "Product photo of flush cutters"
  },
  "Needle Nose Pliers 243-1215-ND": {
    imageUrl: "/images/checkout/components/Needle Nose Pliers 243-1215-ND.webp",
    imageAlt: "Product photo of needle-nose pliers"
  },
  "Pointed Tweezers EROPAASA-ND": {
    imageUrl: "/images/checkout/components/Pointed Tweezers EROPAASA-ND.webp",
    imageAlt: "Product photo of pointed precision tweezers"
  },
  "Wire Strippers K604-ND": {
    imageUrl: "/images/checkout/components/Wire Strippers K604-ND.webp",
    imageAlt: "Product photo of wire strippers"
  }
};

const ARCHIVED_COMPONENT_NAMES = [
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

const ULTRASONIC_CURC_NAME = "Ultrasonic Distance Sensor (CURC)";
const ULTRASONIC_MLH_NAME = "Ultrasonic Distance Sensor (MLH)";
const ULTRASONIC_DESCRIPTION = "HC-SR04-style ultrasonic distance sensor for non-contact ranging, obstacle detection, and tank-level prototypes. Protect 3.3 V GPIO from a 5 V echo output when required.";
const ULTRASONIC_IMAGE = "/images/checkout/components/ultrasonic-sensor-3b04496e58.webp";

function reviewedComponent(component) {
  const originalName = component.name;
  let reviewed = { ...component };
  const patch = COMPONENT_UPDATES[originalName];
  if (patch) reviewed = { ...reviewed, ...patch };
  if (ARCHIVED_COMPONENT_NAMES.includes(originalName)) reviewed.active = false;

  if (originalName === "Ultrasonic Sensors" || originalName === ULTRASONIC_CURC_NAME) {
    reviewed = {
      ...reviewed,
      name: ULTRASONIC_CURC_NAME,
      description: ULTRASONIC_DESCRIPTION,
      imageUrl: ULTRASONIC_IMAGE,
      imageAlt: "Product photo of an ultrasonic distance sensor module",
      totalQuantity: 6,
      mlhQuantity: 0,
      maxActivePerTeam: 2,
      adminNotes: "Organizer correction on 2026-11-05: 6 units managed by CURC. Source: CURC."
    };
  }

  if (originalName === ULTRASONIC_MLH_NAME) {
    reviewed = { ...reviewed, ...ultrasonicMlhComponent() };
  }
  if (Number(reviewed.mlhQuantity || 0) > 0) {
    reviewed.protectedStock = 0;
  }
  return reviewed;
}

function ultrasonicMlhComponent() {
  return {
    name: ULTRASONIC_MLH_NAME,
    description: ULTRASONIC_DESCRIPTION,
    imageUrl: ULTRASONIC_IMAGE,
    imageAlt: "Product photo of an ultrasonic distance sensor module",
    category: "Distance",
    compatibility: "Arduino + Raspberry Pi",
    arduinoGuidance: "",
    raspberryPiGuidance: "",
    binLocation: "",
    technicalSpecs: "",
    totalQuantity: 3,
    mlhQuantity: 3,
    unavailableQuantity: 0,
    protectedStock: 0,
    maxActivePerTeam: 2,
    active: true,
    adminNotes: "Organizer correction on 2026-11-05: 3 units managed by MLH. Source: MLH."
  };
}

function reviewCatalog(catalog) {
  const components = catalog.components.map(reviewedComponent);
  if (!components.some(function (component) { return component.name === ULTRASONIC_MLH_NAME; })) {
    components.push(ultrasonicMlhComponent());
  }
  components.sort(function (left, right) {
    return left.category.localeCompare(right.category) || left.name.localeCompare(right.name);
  });
  const relationships = catalog.relationships.map(function (relationship) {
    const requiresUln2003 = relationship.sourceName === "28BYJ-48 stepper" &&
      relationship.targetName === "4 Phase ULN2003 Stepper Motor Driver";
    return {
      ...relationship,
      sourceName: relationship.sourceName === "Display" ? "Graphic LCD Display TFT" : relationship.sourceName,
      targetName: relationship.targetName === "Display" ? "Graphic LCD Display TFT" : relationship.targetName,
      relationType: requiresUln2003 ? "requires" : relationship.relationType,
      message: requiresUln2003 ? "Each 28BYJ-48 stepper requires one ULN2003 driver board." : relationship.message
    };
  });
  return { ...catalog, components, relationships };
}

function saveInput(component, reviewed) {
  const relationships = (component.relationships || []).map(function (relationship) {
    if (component.name === "28BYJ-48 stepper" && relationship.targetName === "4 Phase ULN2003 Stepper Motor Driver") {
      return {
        ...relationship,
        relationType: "requires",
        message: "Each 28BYJ-48 stepper requires one ULN2003 driver board."
      };
    }
    return relationship;
  });
  return {
    id: component.id,
    expectedVersion: component.version,
    name: reviewed.name,
    description: reviewed.description,
    imageUrl: reviewed.imageUrl,
    imageAlt: reviewed.imageAlt,
    category: reviewed.category,
    compatibility: reviewed.compatibility,
    arduinoGuidance: reviewed.arduinoGuidance,
    raspberryPiGuidance: reviewed.raspberryPiGuidance,
    binLocation: reviewed.binLocation,
    technicalSpecs: reviewed.technicalSpecs,
    totalQuantity: reviewed.totalQuantity,
    mlhQuantity: reviewed.mlhQuantity,
    unavailableQuantity: reviewed.unavailableQuantity,
    protectedStock: reviewed.protectedStock,
    maxActivePerTeam: reviewed.maxActivePerTeam,
    active: reviewed.active,
    adminNotes: reviewed.adminNotes,
    relationships,
    changeReason: CHANGE_REASON
  };
}

function materiallyDifferent(component, reviewed) {
  return Object.keys(reviewed).some(function (key) {
    if (["id", "version", "updatedAt", "relationships", "reservedQuantity", "checkedOutQuantity", "availableQuantity", "teamAvailableQuantity", "teamActiveQuantity", "curcTotalQuantity", "mlhManaged", "mlhOnly"].includes(key)) return false;
    return JSON.stringify(component[key] == null ? null : component[key]) !== JSON.stringify(reviewed[key] == null ? null : reviewed[key]);
  });
}

async function applyDatabaseReview(database) {
  const actorResult = await database.query(
    "SELECT id, username, role, display_name FROM checkout_users WHERE role = 'admin' AND active = TRUE ORDER BY id LIMIT 1"
  );
  const actorRow = actorResult.rows[0];
  if (!actorRow) throw new Error("Seed an active admin before applying the inventory review.");
  const actor = {
    id: Number(actorRow.id),
    username: actorRow.username,
    role: actorRow.role,
    display_name: actorRow.display_name,
    displayName: actorRow.display_name
  };
  const result = { updated: [], created: [], unchanged: [] };
  let components = await service.catalog(database, actor, true);

  for (const component of components) {
    const reviewed = reviewedComponent(component);
    if (!materiallyDifferent(component, reviewed)) {
      if (COMPONENT_UPDATES[component.name] || ARCHIVED_COMPONENT_NAMES.includes(component.name) || component.name === ULTRASONIC_CURC_NAME) {
        result.unchanged.push(component.name);
      }
      continue;
    }
    let updated;
    try {
      updated = await service.saveComponent(database, saveInput(component, reviewed), actor);
    } catch (error) {
      error.message = `${component.name}: ${error.message}`;
      throw error;
    }
    result.updated.push(updated.name);
  }

  components = await service.catalog(database, actor, true);
  if (!components.some(function (component) { return component.name === ULTRASONIC_MLH_NAME; })) {
    const created = await service.saveComponent(database, {
      ...ultrasonicMlhComponent(),
      relationships: [],
      changeReason: CHANGE_REASON
    }, actor);
    result.created.push(created.name);
  }
  return result;
}

async function main() {
  if (process.argv.includes("--catalog")) {
    const inputIndex = process.argv.indexOf("--catalog") + 1;
    const filename = path.resolve(process.argv[inputIndex] || path.join("db", "checkout-catalog.json"));
    const catalog = JSON.parse(fs.readFileSync(filename, "utf8"));
    fs.writeFileSync(filename, `${JSON.stringify(reviewCatalog(catalog), null, 2)}\n`, "utf8");
    process.stdout.write(`Updated ${filename}.\n`);
    return;
  }
  const database = await getDatabase();
  const result = await applyDatabaseReview(database);
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

module.exports = {
  ARCHIVED_COMPONENT_NAMES,
  COMPONENT_UPDATES,
  ULTRASONIC_CURC_NAME,
  ULTRASONIC_MLH_NAME,
  applyDatabaseReview,
  reviewCatalog
};
