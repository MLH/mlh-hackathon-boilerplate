const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {applyCatalog,applyDatabase,makePlan,definitions}=require('../scripts/reconcile-inventory-2026-11-07');
const {componentInput}=require('../api/_lib/checkout-validation');
const {getDatabase,resetDatabaseForTests}=require('../api/_lib/checkout-db');
const service=require('../api/_lib/checkout-service');
process.env.CHECKOUT_PGLITE_PATH='memory://';

test('final physical counts, partial receipts, and missing shipments are reconciled',()=>{
  const catalog=JSON.parse(fs.readFileSync('db/checkout-catalog.json','utf8'));
  assert.deepEqual(applyCatalog(catalog),catalog);
  const byName=new Map(catalog.components.map(c=>[c.name,c]));
  for(const [name,qty] of [['MG90S',18],['Raspberry Pi 5 (2GB)',2],['Raspberry Pi 5 (4GB)',7],['SD Cards (16GB)',6],['MLX90640 Thermal Camera (32×24)',1],['WS2812B Addressable RGB LED Strip (5 m)',7],['INA219 Current and Power Monitor',8],['MAX30102 Pulse Oximeter (Heart Rate + SpO₂)',7],['ELEGOO SG90 Micro Servo',11]]) assert.equal(byName.get(name).totalQuantity,qty,name);
  for(const name of ['Raspberry Pi 5 USB-C Power Supply (27 W)','LTR390 UV and Ambient Light Sensor','TMC2209 V1.3 Stepper Motor Driver','Flex Sensor (2.2-inch)']) assert.equal(byName.has(name),false,name);
  for(const [name,qty] of [['Tactile Push Buttons (Assorted)',250],['JST Headers 4 pin male',13],['Sunfounder 55 g Servo',2],['Sunfounder SF3218MG Servo',2],['ESP32-CAM Camera Development Module',6],['ADS1115 16-bit ADC Breakout',9],['WS2812B NeoPixel Ring (24 pixels)',9],['Analog Pulse Sensor',6],['ELEGOO Passive Buzzer Pack',4]]) assert.equal(byName.get(name).totalQuantity,qty,name);
  assert.equal(byName.get('SG90 Servo').active,false);
  for(const item of catalog.components.filter(c=>/^ELEGOO .*Pack$/.test(c.name))) assert.match(item.description,/whole pack per checkout unit/);
  for(const item of catalog.components) componentInput(item);
});

test('ambiguous duplicate records and allocated reductions stay pending',()=>{
  const rows=[{name:'Arducam 5MP Camera',totalQuantity:5,reservedQuantity:3},{id:1,name:'MG90S',totalQuantity:11},{id:2,name:'MG90S',totalQuantity:11}];
  const plan=makePlan(rows);
  assert.ok(plan.pending.some(p=>p.name==='Arducam 5MP Camera'));
  assert.ok(plan.pending.some(p=>p.name==='MG90S'));
  assert.equal(plan.updates.some(p=>p.current?.name==='MG90S'),false);
});

test('database reconciliation is audited, idempotent, and preserves relationships and pending removals',async()=>{
  const db=await getDatabase();
  try {
    const actor=(await db.query("INSERT INTO checkout_users(username,password_hash,role,display_name) VALUES ('final-review','unused','admin','Inventory reviewer') RETURNING *")).rows[0];
    const base={description:'Existing physical component',imageUrl:'/images/checkout-image-pending.svg',imageAlt:'Photo pending',category:'Motor',compatibility:'Arduino',totalQuantity:11,mlhQuantity:0,unavailableQuantity:0,protectedStock:0,active:true};
    const mg=await service.saveComponent(db,{...base,name:'MG90S'},actor);
    const red=await service.saveComponent(db,{...base,name:'Type 130',totalQuantity:19},actor);
    const sg=await service.saveComponent(db,{...base,name:'SG90 Servo',totalQuantity:2},actor);
    await db.query("INSERT INTO checkout_component_relationships(source_component_id,target_component_id,relation_type,quantity_ratio,minimum_source_quantity,message) VALUES ($1,$2,'recommends',1,1,'Existing guidance')",[mg.id,red.id]);
    const before=await db.query('SELECT COUNT(*) AS count FROM checkout_components');
    await applyDatabase(db);
    assert.equal(Number((await db.query('SELECT COUNT(*) AS count FROM checkout_components')).rows[0].count),Number(before.rows[0].count));
    const first=await applyDatabase(db,{apply:true});
    assert.ok(first.created.length>50);
    assert.equal(Number((await db.query('SELECT total_quantity FROM checkout_components WHERE id=$1',[mg.id])).rows[0].total_quantity),18);
    assert.equal(Number((await db.query('SELECT COUNT(*) AS count FROM checkout_component_relationships')).rows[0].count),1);
    assert.equal(Number((await db.query('SELECT total_quantity FROM checkout_components WHERE id=$1',[red.id])).rows[0].total_quantity),19);
    const retired=(await db.query('SELECT total_quantity,active FROM checkout_components WHERE id=$1',[sg.id])).rows[0];
    assert.equal(Number(retired.total_quantity),0);
    assert.equal(retired.active,false);
    const second=await applyDatabase(db,{apply:true});
    assert.deepEqual(second.updated,[]);
    assert.deepEqual(second.created,[]);
    assert.ok(Number((await db.query("SELECT COUNT(*) AS count FROM checkout_inventory_transactions WHERE note LIKE 'Reconciled with November 6%'")).rows[0].count)>50);
  } finally {await resetDatabaseForTests();}
});
