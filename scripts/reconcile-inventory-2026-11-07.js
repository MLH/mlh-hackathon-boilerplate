const fs = require('node:fs');
const path = require('node:path');
const evidence = require('./inventory-review-2026-11-07.json');
const { WISHLIST_COMPONENTS, WISHLIST_UPDATES } = require('./apply-wishlist-catalog');
const service = require('../api/_lib/checkout-service');
const {correctedName,protectedFromRemoval} = require('./inventory-name-policy');
const PENDING = '/images/checkout-image-pending.svg';
const REASON = 'Reconciled with November 6 physical inventory and received wishlist, reviewed November 7, 2026.';
const normalize = name => name.trim().toLowerCase().replace(/\s+/g, ' ');

// These rows need organizer input, rather than a guessed merge or package count.
const pendingMain = new Map();
const pendingWishlist = new Map();
const aliases = {
  '50Pcs Potentiometer Kit': ['Potentiometers'],
  'Solderless Breadboard (full)': ['Solderless Breadboard'],
  'FUTABA S3004 servo': ['S3004 servo'],
  'DC Motors': ['DC Motors 1.5-6V'],
  'Facmogu Power Supply': ['Wall power supply'],
  'OCR 180Pcs Tactile Push Button Switch 10 Values 6x6mm Micro Momentary Tact Button Switches Assortment Kit': ['Tactile Push Buttons (Assorted)'],
  'SF3218MG sunfounder': ['SF3218MG Servo'],
  'Pin headers': ['Pin Headers'],
  '550 Titan 12-Turn w/ ESC': ['550 Titan 12-Turn']
};
// New names state only the model/interface supported by the physical-inventory row.
const mainDetails = {
  6: ['Tactile Push Buttons (Assorted)', 'Button', 'Assorted tactile momentary push button switches for user controls and breadboard circuits. Organizer confirmed 250 individual switches in the combined inventory.'],
  21: ['Potentiometers', 'Electronics', 'Assorted WH148 rotary potentiometers for adjustable analog inputs. Issued individually from the counted 50-piece kit.'],
  51: ['Pin Headers', 'Electronics', 'Pin header strips for soldered connections on development boards and prototyping circuits.'],
  63: ['Solderless Breadboard (Half Size)', 'Electronics', 'Half-size solderless breadboard for prototyping circuits without solder. Check the power-rail continuity before wiring.'],
  86: ['8-Channel Servo Power Distribution Node', 'Power', 'Eight-channel servo power distribution node. Verify supply polarity, connector pinout, and current rating before connecting servos.'],
  89: ['Traxxas Titan 550 12-Turn Motor with ESC', 'Motor Related', 'Titan 550 12-turn brushed DC motor with an electronic speed controller. Check the ESC input voltage and control connections before powering.'],
  98: ['Sunfounder 55 g Servo', 'Motor', 'Sunfounder 55 g servo for robotics mechanisms. This is a separate servo type from the SF3218MG. Verify the label, voltage, and horn fit before use.'],
  232: ['Sunfounder SF3218MG Servo', 'Motor', 'Sunfounder SF3218MG servo for robotics mechanisms. Research the SF3218MG model for voltage, control pulse, and mechanical specifications.'],
  117: ['Facmogu Adjustable DC Power Supply', 'Power', 'Facmogu adjustable DC power supply. Set and measure the output voltage and verify connector polarity before connecting hardware.'],
  206: ['TouchTronix SNX0505-SNS-01 Tactile Sensor', 'Sensor', 'TouchTronix Robotics SNX0505-SNS-01 tactile sensor for contact sensing in robotics. Research this exact part number for integration and connection details.'],
  207: ['USB-C Power Supply', 'Power', 'USB-C power supply for compatible hardware. Check the adapter label and supported output profiles before use.'],
  208: ['Alligator Clip Test Lead', 'Electronics', 'Alligator clip lead for temporary electrical connections and circuit testing. Check insulation and use only with an appropriate low-voltage circuit.'],
  210: ['9 V Battery Snap Connector (Bare Leads)', 'Power', 'Snap connector with bare leads for a 9 V battery. This connector has no DC barrel jack. Verify polarity before wiring.'],
  211: ['Mini Grabber Test Clip', 'Electronics', 'Mini grabber test clip for making temporary connections to small component leads during circuit measurements.'],
  215: ['AAA Battery', 'Power', 'Individual AAA battery. Check chemistry, voltage, polarity, and condition before installing in a holder.'],
  217: ['Arduino USB Cable', 'Electronics', 'USB cable recorded for Arduino boards. Match the board-side connector before checkout.'],
  218: ['Mini-USB Cable', 'Electronics', 'USB cable with a Mini-USB connector for compatible development boards and peripherals.'],
  219: ['USB-C Cable', 'Electronics', 'Cable with a USB-C connector. Verify the other connector and data or power capability for the intended device.'],
  221: ['Liquid Level Sensor', 'Sensor', 'Liquid level sensor for tank monitoring and liquid detection prototypes. Identify the connector and supply requirements before use.'],
  222: ['Adafruit SHTC3 Temperature and Humidity Sensor', 'Sensor', 'Adafruit SHTC3 sensor module for temperature and relative humidity measurement over I2C.'],
  223: ['1584EN DC Voltage Regulator Module', 'Power', 'Voltage regulator module marked 1584EN. Check the board input range, output setting, and polarity before powering a circuit.'],
  224: ['4×AA Battery Holder with DC Barrel Jack', 'Power', 'Holder for four AA batteries with a DC barrel connector. Check the output voltage and center-pin polarity before connecting a device.'],
  225: ['NE555P Timer IC', 'Electronics', 'NE555P timer integrated circuit for oscillator, pulse generation, and timing circuits. Consult the NE555P datasheet for the pinout.'],
  226: ['30 A DC Motor Driver', 'Motor Related', 'DC motor driver labeled 30 A. Identify the board model, voltage range, control inputs, cooling needs, and continuous current rating before use.'],
  227: ['Small Camera Tripod', 'Tool', 'Compact tripod for supporting compatible cameras or project fixtures. Check the mounting thread and load before use.'],
  228: ['Raspberry Pi Camera Ribbon Cable Set', 'Pi-related', 'Ribbon cable set for Raspberry Pi camera connections. Match the cable width, pin count, and board connectors before insertion.'],
  230: ['Raspberry Pi Camera Holder with Cable', 'Pi-related', 'Camera holder with a cable for Raspberry Pi camera projects. Check camera fit and connector compatibility.'],
  233: ['DSSERVO DS3218MG 20 kg Servo', 'Motor', 'DSSERVO DS3218MG servo labeled 20 kg for robotics and mechanism projects. Consult the exact model specifications for voltage and travel.'],
  234: ['Endoscope Inspection Camera', 'Camera', 'Endoscope inspection camera for viewing confined spaces. Check its connector, supported host, and software before use.'],
  235: ['Small Solderable Prototyping Board', 'Electronics', 'Small solderable prototyping board for permanent through-hole circuit assembly. Inspect the copper layout before soldering.'],
  236: ['Sonar Altimeter and Echosounder', 'Sensor', 'Sonar altimeter and echosounder for acoustic ranging projects. Identify the model, interface, supply requirements, and operating medium before use.']
};
// Preserve the explicit physical counts; incomplete kits do not imply factory counts.
const elegooDetails = {
  26: ['5 V Relay', 'Power'], 27: ['UNO R3 Prototype Expansion Shield', 'Electronics'],
  28: ['Breadboard Power Supply Module', 'Power'], 29: ['ULN2003 Stepper Motor Driver', 'Motor Related'],
  30: ['28BYJ-48 Stepper Motor', 'Motor'], 31: ['SG90 Micro Servo', 'Motor'],
  32: ['Infrared Receiver Module', 'Sensor'], 33: ['2-Axis Analog Joystick Module', 'Sensor'],
  34: ['DHT11 Temperature and Humidity Module', 'Sensor'], 35: ['HC-SR04 Ultrasonic Distance Sensor', 'Distance'],
  36: ['3–6 V DC Motor with Fan Blade', 'Motor'], 39: ['UNO R3 Arduino-Compatible Controller Board', 'Microcontroller'],
  37: ['Active Buzzer, 74HC595, L293D and Tilt Switch Pack', 'Electronics'],
  38: ['Passive Buzzer Pack', 'Audio'],
  50: ['Photoresistor, PN2222, Button, Thermistor and Rectifier Diode Pack', 'Electronics'],
  41: ['LCD1602 16×2 Character Display Module', 'Electronics'], 42: ['10 kΩ Potentiometer', 'Electronics'],
  43: ['Single-Digit 7-Segment LED Display', 'Electronics'], 44: ['4-Digit 7-Segment LED Display', 'Electronics'],
  46: ['Infrared Remote Control', 'Electronics'], 47: ['Small Solderless Breadboard', 'Electronics'],
  48: ['UNO R3 USB Cable', 'Electronics'], 49: ['9 V Battery Snap Connector', 'Power'],
  51: ['Power Distribution Hub', 'Power'], 52: ['DC Motor (Red and Black Leads)', 'Motor'],
  53: ['Large Solderless Breadboard', 'Electronics'], 54: ['Arduino Nano-Compatible Controller Board', 'Microcontroller']
};
const wishlistQuantities = {3:10,4:6,5:1,6:1,7:9,8:7,9:9,10:15,11:20,12:1,13:2,14:2,15:30,16:16,17:2,18:1,20:2,21:4,22:4,23:4,24:3,25:8,26:7,27:3,30:1,31:6,32:7};
const wishDefinitions = [...WISHLIST_COMPONENTS, ...WISHLIST_UPDATES];
const downloadManifest = require('../images/checkout/components/download-manifest.json');
const knownImages = new Map(downloadManifest.items.filter(item=>item.status==='downloaded' && item.localImage).map(item=>[item.name,{imageUrl:item.localImage,imageAlt:`Product photo of ${item.name} from the linked supplier page`}]));
const additionalImages = new Map([
  ['TouchTronix SNX0505-SNS-01 Tactile Sensor',{imageUrl:'https://mm.digikey.com/Volume0/opasdata/d220001/derivates/1/008/216/330/MFG_SNX0505-SNS-01_secondary_sml%28200x200%29.jpg',imageAlt:'Supplier photo of the TouchTronix SNX0505-SNS-01 tactile sensor'}]
]);
const cleanUrl = url => {
  const asin = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/.exec(url || '');
  return asin ? `https://www.amazon.com/dp/${asin[1]}` : url;
};

function definitions() {
  const updates = [];
  for (const row of evidence.main.filter(r => r.fill === 6 && !pendingMain.has(r.row))) {
    const details = mainDetails[row.row];
    const name = details?.[0] || row.name;
    const quantity = row.row === 21 ? 50 : row.row === 6 ? 250 : row.quantity;
    updates.push({name, aliases:[row.name, ...(aliases[row.name] || [])], quantity, category:details?.[1], description:details?.[2], sourceSheet:evidence.mainSheet, sourceRow:row.row, productUrl:cleanUrl(row.productUrl), note:row.notes});
  }
  for (const row of evidence.elegoo) {
    const details = elegooDetails[row.row];
    if (!details) continue;
    const name = `ELEGOO ${details[0]}`;
    const pack = [37,38,50].includes(row.row);
    updates.push({name, aliases:[], quantity:row.quantity, unit:pack?'whole packs':'individual components', category:details[1], description:`${details[0]} from the reorganized ELEGOO Super Starter Arduino kit inventory. ${pack?'Issued as one whole pack per checkout unit. Individual contents have not been counted.':'Issued individually.'} ${row.row === 33 ? 'There are 12 joystick modules but only 7 removable thumb caps. ' : ''}Check the ELEGOO UNO R3 Super Starter Kit tutorial for wiring and example projects.`, sourceSheet:evidence.mainSheet, sourceRow:`P${row.row}:R${row.row}`, productUrl:'https://us.elegoo.com/products/elegoo-uno-r3-super-starter-kit', note:row.notes});
  }
  for (const row of evidence.wishlist) {
    if (!row.received || pendingWishlist.has(row.row) || row.row === 32) continue;
    const definition = wishDefinitions.find(d => d.sourceRow === row.row);
    if (!definition) throw new Error(`Missing wishlist definition for row ${row.row}`);
    const template = {...definition,...(knownImages.get(definition.name)||{})};
    if(row.row===4) Object.assign(template,{description:'ESP32-CAM camera development module with Wi-Fi and Bluetooth for embedded camera and wireless vision projects. Verify the camera revision and programming connections on the supplied board.',technicalSpecs:'ESP32-CAM camera module; Wi-Fi and Bluetooth. Six individual modules confirmed by organizer.'});
    for (const key of ['sourceRow','productUrl','existingName','addedQuantity','finalQuantity','note']) delete template[key];
    updates.push({name:row.row===4?'ESP32-CAM Camera Development Module':definition.name, aliases:row.row===4?[definition.name,definition.existingName]:[], quantity:wishlistQuantities[row.row], template, description:row.row===4?template.description:undefined, sourceSheet:evidence.wishlistSheet, sourceRow:row.row === 26 ? '26,32' : row.row, productUrl:cleanUrl(row.productUrl), note:row.notes});
  }
  return updates.map(d=>({...d,name:correctedName(d.name),aliases:[...d.aliases,...(correctedName(d.name)!==d.name?[d.name]:[])]}));
}

function makePlan(components) {
  const updates = [], pending = [];
  for (const definition of definitions()) {
    const matches = components.filter(c => !superseded(c) && [definition.name,...definition.aliases].map(normalize).includes(normalize(c.name)));
    if (matches.length > 1) {
      pending.push({name:definition.name, reason:'Multiple database records match; organizer must select the survivor.', ids:matches.map(c => c.id)});
      continue;
    }
    const current = matches[0];
    const template = definition.template || {};
    const preserveName = current && definition.aliases.some(a=>normalize(a)===normalize(current.name)) && !definition.description && definition.sourceRow!==62;
    const next = {...(current || template), name:preserveName?current.name:definition.name, totalQuantity:definition.quantity};
    if (!current) {
      Object.assign(next, {description:definition.description || template.description, category:definition.category || template.category || 'Electronics', compatibility:template.compatibility || 'Arduino + Raspberry Pi', arduinoGuidance:template.arduinoGuidance || '', raspberryPiGuidance:template.raspberryPiGuidance || '', binLocation:'', technicalSpecs:template.technicalSpecs || '', imageUrl:template.imageUrl || PENDING, imageAlt:template.imageAlt || `Photo pending for ${definition.name}`, mlhQuantity:0, unavailableQuantity:0, protectedStock:0, maxActivePerTeam:template.maxActivePerTeam || 2, active:true, adminNotes:''});
    }
    if (definition.description) next.description = definition.description;
    if(definition.sourceSheet===evidence.wishlistSheet && definition.sourceRow===4) next.technicalSpecs=template.technicalSpecs;
    if (definition.category) next.category = definition.category;
    if (additionalImages.has(definition.name)) Object.assign(next,additionalImages.get(definition.name));
    // The linked listing is a two-module pack, matching the physical receipt note.
    if (definition.sourceSheet === evidence.wishlistSheet && definition.sourceRow === 25) next.technicalSpecs = 'INA219 current and power monitor; I2C interface; two modules per received package.';
    const provenance = `${REASON} Source: ${definition.sourceSheet}, row ${definition.sourceRow}. Physical stock: ${definition.quantity} ${definition.unit||'individual checkout units'}.${definition.note ? ` Inventory note: ${definition.note}` : ''}`;
    if (!(next.adminNotes || '').includes(provenance)) next.adminNotes = `${next.adminNotes || ''}\n${provenance}`.trim();
    if (!Number.isSafeInteger(next.totalQuantity) || next.totalQuantity < 0) throw new Error(`Invalid quantity: ${next.name}`);
    if (current && (next.totalQuantity < (current.reservedQuantity || 0) + (current.checkedOutQuantity || 0) + (current.mlhQuantity || 0) + (current.unavailableQuantity || 0) || (current.protectedStock||0)>next.totalQuantity-(current.mlhQuantity||0)-(current.unavailableQuantity||0))) {
      pending.push({name:next.name, reason:'New total conflicts with allocated, MLH, or unavailable stock.'});
      continue;
    }
    if (!current || ['name','description','category','totalQuantity','technicalSpecs','adminNotes','imageUrl','imageAlt'].some(key => next[key] !== current[key])) updates.push({definition,current,next});
  }
  for(const current of components.filter(superseded)) {
    if(current.active===false && current.totalQuantity===0) continue;
    if((current.reservedQuantity||0)+(current.checkedOutQuantity||0)+(current.mlhQuantity||0)+(current.unavailableQuantity||0)>0){pending.push({name:current.name,reason:'Superseded record still has allocated or unavailable stock; manual reconciliation required.'});continue;}
    updates.push({current,next:{...current,totalQuantity:0,active:false,protectedStock:0,adminNotes:`${current.adminNotes||''}\nOrganizer confirmed this stock is already included in the surviving JST (13) or ELEGOO SG90 (11) inventory; archived to prevent double counting.`.trim()}});
  }
  for(const current of components) {
    const name=correctedName(current.name);
    if(name===current.name || updates.some(update=>update.current===current)) continue;
    if(components.some(c=>c!==current && normalize(c.name)===normalize(name))){pending.push({name,reason:'Corrected name already exists; review before merging.'});continue;}
    updates.push({current,next:{...current,name}});
  }
  return {updates,pending};
}

function superseded(component){
  return component.name==='SG90 Servo' || component.name==='JST Headers 8 pin male' || (Number(component.id)===50 && component.name==='JST Headers 4 pin male');
}

function applyCatalog(catalog, imageByName = new Map()) {
  const plan = makePlan(catalog.components);
  // These wishlist-only records were proposed in the old snapshot but were never
  // received or inserted in production. Do not seed them into a future database.
  const notReceivedNames = new Set(evidence.wishlist.filter(r=>!r.received).map(r=>wishDefinitions.find(d=>d.sourceRow===r.row)?.name));
  const result = {...catalog, components:catalog.components.filter(c=>!notReceivedNames.has(c.name)).map(c=>({...c})), relationships:catalog.relationships.map(r=>({...r}))};
  for (const {current,next} of plan.updates) {
    if (imageByName.has(next.name)) Object.assign(next, imageByName.get(next.name));
    if (current) result.components[result.components.findIndex(c=>c.name===current.name)] = next;
    else result.components.push(next);
    if (current && current.name !== next.name) result.relationships = result.relationships.map(r=>({...r, sourceName:r.sourceName===current.name?next.name:r.sourceName, targetName:r.targetName===current.name?next.name:r.targetName}));
  }
  result.source = 'MakeCU November 6 physical inventory and received wishlist; pending deletions require organizer confirmation';
  const retained = new Set(result.components.map(c=>c.name));
  result.relationships=result.relationships.filter(r=>retained.has(r.sourceName)&&retained.has(r.targetName));
  result.components.sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name));
  return result;
}

async function applyDatabase(database, {apply = false, imageByName = new Map()} = {}) {
  return database.transaction(async tx => {
    const actor = (await tx.query("SELECT id,username,role,display_name FROM checkout_users WHERE role='admin' AND active=TRUE ORDER BY id LIMIT 1")).rows[0];
    if (!actor) throw new Error('An active inventory admin is required.');
    const components = await service.catalog(tx, actor, true);
    const plan = makePlan(components);
    const result = {applied:apply, updated:[],created:[],pending:plan.pending};
    for (const {current,next} of plan.updates) {
      if (imageByName.has(next.name)) Object.assign(next,imageByName.get(next.name));
      const {relationships,...input} = next;
      if (apply) await service.saveComponent(tx, {...input, ...(current?{id:current.id,expectedVersion:current.version}:{}), changeReason:REASON}, actor);
      (current?result.updated:result.created).push({name:next.name,previousQuantity:current?.totalQuantity,quantity:next.totalQuantity});
    }
    return result;
  });
}

function reviewReport(catalog) {
  const lines = ['# Inventory reconciliation — November 7, 2026', '', 'No red or uncolored item has been deleted. MLH inventory is preserved as confirmed by the organizer. Superseded JST and SG90 records are archived with zero stock after confirmation that their units are already included in the surviving totals.', '', '## Confirmed corrections', '', '- Switches: 250 individual switches; JST male headers: 13 total.', '- Sunfounder 55 g and SF3218MG are separate servo types, 2 of each.', '- ELEGOO SG90: 11 total, including the former separate 2 servos.', '- ESP32-CAM: 6 individual modules; ADS1115: 3 packages × 3 = 9 boards.', '- NeoPixel: 9 individual rings; FainWan pulse sensors: 2 packages × 3 = 6 sensors.', '- ELEGOO rows 37, 38, 50 are issued as whole packs: 3, 4, and 10 packs respectively. Contents are not individually counted.', '', '## Pending quantity and identity decisions', ''];
  for (const [row,reason] of pendingMain) lines.push(`- Main row ${row}: ${reason}`);
  for (const [row,reason] of pendingWishlist) lines.push(`- Wishlist row ${row}: ${reason}`);
  lines.push('- BME680 confirmed: 4 individual modules. No quantity or identity decisions remain pending.');
  lines.push('', '## Keep in inventory — organizer confirmed', '', '- DMM: retain, including the uncolored CURC workbook row. The existing MLH DMM remains unchanged.', '- Small Solderable Prototyping Board: retain 6.', '- Sonar Altimeter and Echosounder (PING): retain 1.', '', 'Names receive only small spelling/spacing corrections. Uncertain model identifiers are retained.');
  lines.push('', '## Proposed removals — confirmation required', '', '| Main row | Color | Workbook item | Quantity | Note |', '| --- | --- | --- | ---: | --- |');
  for (const row of evidence.main.filter(r=>(r.fill===8||r.fill===0)&&!protectedFromRemoval(r.name))) lines.push(`| ${row.row} | ${row.fill===8?'Red':'Uncolored'} | ${correctedName(row.name).replaceAll('|','/')} | ${row.quantity??'Unspecified'} | ${row.notes.replaceAll('|','/')} |`);
  lines.push('', 'Merged records need partial stock reconciliation, not whole-record deletion: tactile switches, ceramic capacitors (retain MLH stock), JST male headers, moisture sensors (retain MLH stock), and MAX30102 sensors (received wishlist stock).', '', '## Not received — excluded from additions', '');
  for (const row of evidence.wishlist.filter(r=>!r.received)) lines.push(`- Wishlist row ${row.row}: ${row.name}.`);
  lines.push('', 'These four rows existed in the older local snapshot but were absent from production at review time. They are excluded from the new seed snapshot. No production record was deleted.', '', '## Photos needed', '');
  for (const component of catalog.components.filter(c=>c.imageUrl===PENDING)) lines.push(`- ${component.name}`);
  return lines.join('\n')+'\n';
}

function updateSources(manifest) {
  const result = {...manifest,items:manifest.items.map(item=>({...item,name:correctedName(item.name)}))};
  for (const d of definitions().filter(d=>d.productUrl)) {
    const index = result.items.findIndex(item=>[d.name,...d.aliases].map(normalize).includes(normalize(item.name)));
    const item={name:d.name,sourceSheet:d.sourceSheet,sourceRow:d.sourceRow,productUrl:d.productUrl};
    if(index<0) result.items.push(item); else result.items[index]=item;
  }
  return result;
}

async function main() {
  const catalogPath = path.join(__dirname,'../db/checkout-catalog.json');
  if (process.argv.includes('--catalog')) {
    const next=applyCatalog(JSON.parse(fs.readFileSync(catalogPath,'utf8')));
    fs.writeFileSync(catalogPath,JSON.stringify(next,null,2)+'\n');
    const sourcesPath=path.join(__dirname,'checkout-component-sources.json');
    fs.writeFileSync(sourcesPath,JSON.stringify(updateSources(JSON.parse(fs.readFileSync(sourcesPath,'utf8'))),null,2)+'\n');
    fs.writeFileSync(path.join(__dirname,'../INVENTORY_REVIEW_2026-11-07.md'),reviewReport(next));
    console.log(`Reconciled local catalog: ${next.components.length} records. No deletions.`);
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; refusing to change an unintended local database.');
  const {getDatabase,resetDatabaseForTests}=require('../api/_lib/checkout-db');
  try { console.log(JSON.stringify(await applyDatabase(await getDatabase(),{apply:process.argv.includes('--apply')}),null,2)); }
  finally { await resetDatabaseForTests(); }
}
if(require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={definitions,makePlan,applyCatalog,applyDatabase,reviewReport,pendingMain,pendingWishlist,updateSources,superseded};
