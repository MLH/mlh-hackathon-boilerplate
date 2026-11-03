const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

process.env.CHECKOUT_PGLITE_PATH = "memory://";

const { getDatabase, resetDatabaseForTests } = require("../api/_lib/checkout-db");
const service = require("../api/_lib/checkout-service");

let database;
let admins;
let teams;
let teamActors;
let orderComponentId;
let returnComponentId;
let pickupComponentId;
let pickupOrderIds;
let duplicatePickupComponentId;
let duplicatePickupOrderId;

before(async function () {
  database = await getDatabase();

  const teamResult = await database.query(
    `INSERT INTO checkout_teams (name, identifier)
     VALUES ('Concurrent Order A', 'concurrent-order-a'),
            ('Concurrent Order B', 'concurrent-order-b'),
            ('Concurrent Order C', 'concurrent-order-c'),
            ('Concurrent Return A', 'concurrent-return-a'),
            ('Concurrent Return B', 'concurrent-return-b')
     RETURNING *`
  );
  teams = teamResult.rows;

  const adminResult = await database.query(
    `INSERT INTO checkout_users (username, password_hash, role, display_name)
     VALUES ('concurrent-admin-1', 'unused', 'admin', 'Concurrent Admin 1'),
            ('concurrent-admin-2', 'unused', 'admin', 'Concurrent Admin 2'),
            ('concurrent-admin-3', 'unused', 'admin', 'Concurrent Admin 3')
     RETURNING *`
  );
  admins = adminResult.rows;

  teamActors = [];
  for (let index = 0; index < 3; index += 1) {
    const team = teams[index];
    const userResult = await database.query(
      `INSERT INTO checkout_users (username, password_hash, role, team_id, display_name)
       VALUES ($1, 'unused', 'team', $2, $3)
       RETURNING *`,
      [`concurrent-order-user-${index + 1}`, team.id, team.name]
    );
    teamActors.push(Object.assign({}, userResult.rows[0], {
      team_name: team.name
    }));
  }

  const componentResult = await database.query(
    `INSERT INTO checkout_components
      (name, description, image_url, image_alt, category, compatibility,
       total_quantity, reserved_quantity, checked_out_quantity, max_active_per_team, active)
     VALUES ('Concurrent Order Part', 'One unit can be reserved once.', '/test.svg', 'Order part',
             'Electronics', 'N/A', 1, 0, 0, 1, TRUE),
            ('Concurrent Return Part', 'Shared by two teams.', '/test.svg', 'Return part',
             'Electronics', 'N/A', 4, 0, 4, 4, TRUE),
            ('Concurrent Pickup Part', 'Reserved by two different orders.', '/test.svg', 'Pickup part',
             'Electronics', 'N/A', 2, 2, 0, 2, TRUE),
            ('Concurrent Duplicate Pickup Part', 'Reserved by one order confirmed twice.', '/test.svg', 'Duplicate pickup part',
             'Electronics', 'N/A', 1, 1, 0, 1, TRUE)
     RETURNING id`
  );
  orderComponentId = Number(componentResult.rows[0].id);
  returnComponentId = Number(componentResult.rows[1].id);
  pickupComponentId = Number(componentResult.rows[2].id);
  duplicatePickupComponentId = Number(componentResult.rows[3].id);

  await database.query(
    `INSERT INTO checkout_team_inventory (team_id, component_id, checked_out_quantity)
     VALUES ($1, $3, 2), ($2, $3, 2)`,
    [teams[3].id, teams[4].id, returnComponentId]
  );

  const pickupOrders = await database.query(
    `INSERT INTO checkout_orders (team_id, status, accepted_by, ready_by, accepted_at, ready_at)
     VALUES ($1, 'ready', $3, $3, NOW(), NOW()),
            ($2, 'ready', $4, $4, NOW(), NOW())
     RETURNING id, team_id`,
    [teams[3].id, teams[4].id, admins[0].id, admins[1].id]
  );
  pickupOrderIds = pickupOrders.rows.map(function (row) { return Number(row.id); });

  for (const order of pickupOrders.rows) {
    await database.query(
      `INSERT INTO checkout_order_items
        (order_id, component_id, requested_quantity, approved_quantity, component_name_snapshot)
       VALUES ($1, $2, 1, 1, 'Concurrent Pickup Part')`,
      [order.id, pickupComponentId]
    );
  }

  const duplicatePickupOrder = await database.query(
    `INSERT INTO checkout_orders (team_id, status, accepted_by, ready_by, accepted_at, ready_at)
     VALUES ($1, 'ready', $2, $2, NOW(), NOW())
     RETURNING id`,
    [teams[3].id, admins[0].id]
  );
  duplicatePickupOrderId = Number(duplicatePickupOrder.rows[0].id);
  await database.query(
    `INSERT INTO checkout_order_items
      (order_id, component_id, requested_quantity, approved_quantity, component_name_snapshot)
     VALUES ($1, $2, 1, 1, 'Concurrent Duplicate Pickup Part')`,
    [duplicatePickupOrderId, duplicatePickupComponentId]
  );
});

after(async function () {
  await resetDatabaseForTests();
});

test("concurrent checkout and return operations preserve every inventory count", async function () {
  const competingOrders = await Promise.allSettled(teamActors.map(function (actor) {
    return service.submitOrder(database, {
      items: [{ componentId: orderComponentId, quantity: 1 }]
    }, actor);
  }));

  assert.equal(competingOrders.filter(function (result) { return result.status === "fulfilled"; }).length, 1);
  assert.equal(competingOrders.filter(function (result) {
    return result.status === "rejected" && result.reason.status === 409;
  }).length, 2);

  const reserved = await database.query(
    "SELECT reserved_quantity FROM checkout_components WHERE id = $1",
    [orderComponentId]
  );
  assert.equal(Number(reserved.rows[0].reserved_quantity), 1);

  const returns = await Promise.all([
    service.processReturn(database, {
      teamId: Number(teams[3].id),
      items: [{ componentId: returnComponentId, quantity: 1, condition: "good", note: "" }]
    }, admins[0]),
    service.processReturn(database, {
      teamId: Number(teams[4].id),
      items: [{ componentId: returnComponentId, quantity: 1, condition: "damaged", note: "Connector bent" }]
    }, admins[1])
  ]);

  assert.equal(returns.length, 2);
  const returnComponent = await database.query(
    "SELECT checked_out_quantity, unavailable_quantity FROM checkout_components WHERE id = $1",
    [returnComponentId]
  );
  assert.equal(Number(returnComponent.rows[0].checked_out_quantity), 2);
  assert.equal(Number(returnComponent.rows[0].unavailable_quantity), 1);

  const teamHoldings = await database.query(
    `SELECT team_id, checked_out_quantity
       FROM checkout_team_inventory
      WHERE component_id = $1
      ORDER BY team_id`,
    [returnComponentId]
  );
  assert.deepEqual(teamHoldings.rows.map(function (row) {
    return Number(row.checked_out_quantity);
  }), [1, 1]);

  const returnReceipts = await database.query(
    "SELECT COUNT(*) AS count FROM checkout_return_receipts WHERE team_id = ANY($1::bigint[])",
    [[teams[3].id, teams[4].id]]
  );
  assert.equal(Number(returnReceipts.rows[0].count), 2);

  const pickups = await Promise.all([
    service.transitionOrder(database, { orderId: pickupOrderIds[0] }, admins[0], "pickup"),
    service.transitionOrder(database, { orderId: pickupOrderIds[1] }, admins[1], "pickup")
  ]);
  assert.ok(pickups.every(function (order) { return order.status === "picked_up"; }));

  const pickupComponent = await database.query(
    "SELECT reserved_quantity, checked_out_quantity FROM checkout_components WHERE id = $1",
    [pickupComponentId]
  );
  assert.equal(Number(pickupComponent.rows[0].reserved_quantity), 0);
  assert.equal(Number(pickupComponent.rows[0].checked_out_quantity), 2);

  const pickupHoldings = await database.query(
    `SELECT team_id, checked_out_quantity
       FROM checkout_team_inventory
      WHERE component_id = $1
      ORDER BY team_id`,
    [pickupComponentId]
  );
  assert.deepEqual(pickupHoldings.rows.map(function (row) {
    return Number(row.checked_out_quantity);
  }), [1, 1]);

  const pickupTransactions = await database.query(
    `SELECT COUNT(*) AS count
       FROM checkout_inventory_transactions
      WHERE component_id = $1 AND transaction_type = 'PICKUP'`,
    [pickupComponentId]
  );
  assert.equal(Number(pickupTransactions.rows[0].count), 2);

  const duplicateConfirmations = await Promise.all([
    service.transitionOrder(database, { orderId: duplicatePickupOrderId }, admins[0], "pickup"),
    service.transitionOrder(database, { orderId: duplicatePickupOrderId }, admins[1], "pickup")
  ]);
  assert.ok(duplicateConfirmations.every(function (order) { return order.status === "picked_up"; }));

  const duplicatePickupInventory = await database.query(
    "SELECT reserved_quantity, checked_out_quantity FROM checkout_components WHERE id = $1",
    [duplicatePickupComponentId]
  );
  assert.equal(Number(duplicatePickupInventory.rows[0].reserved_quantity), 0);
  assert.equal(Number(duplicatePickupInventory.rows[0].checked_out_quantity), 1);

  const duplicatePickupTransactions = await database.query(
    `SELECT COUNT(*) AS count
       FROM checkout_inventory_transactions
      WHERE component_id = $1 AND transaction_type = 'PICKUP'`,
    [duplicatePickupComponentId]
  );
  assert.equal(Number(duplicatePickupTransactions.rows[0].count), 1);
});
