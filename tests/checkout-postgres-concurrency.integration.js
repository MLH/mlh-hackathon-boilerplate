const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { Pool } = require("pg");
const service = require("../api/_lib/checkout-service");

const connectionString = process.env.CHECKOUT_POSTGRES_TEST_URL;
const schemaName = `checkout_test_${crypto.randomBytes(6).toString("hex")}`;
let adminPool;
let pool;
let database;

function normalize(result) {
  return { rows: result.rows || [], rowCount: result.rowCount == null ? 0 : result.rowCount };
}

function transactionAdapter(client) {
  const adapter = {
    query: async function (text, values) { return normalize(await client.query(text, values || [])); }
  };
  adapter.transaction = async function (callback) { return callback(adapter); };
  return adapter;
}

before(async function () {
  if (!connectionString) return;
  adminPool = new Pool({ connectionString, max: 2 });
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  pool = new Pool({ connectionString, max: 10, options: `-c search_path=${schemaName}` });
  await pool.query(fs.readFileSync(path.join(process.cwd(), "db", "checkout-schema.sql"), "utf8"));
  database = {
    query: async function (text, values) { return normalize(await pool.query(text, values || [])); },
    async transaction(callback) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await callback(transactionAdapter(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
});

after(async function () {
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminPool.end();
  }
});

test("real PostgreSQL serializes team submissions, inventory reservations, and admin claims", {
  skip: !connectionString ? "Set CHECKOUT_POSTGRES_TEST_URL to a disposable PostgreSQL database." : false
}, async function () {
  const teamRows = await database.query(
    `INSERT INTO checkout_teams (name, identifier)
     VALUES ('Postgres Team A', 'pg-team-a'), ('Postgres Team B', 'pg-team-b'),
            ('Postgres Team C', 'pg-team-c'), ('Postgres Same Team', 'pg-same-team')
     RETURNING *`
  );
  const admins = await database.query(
    `INSERT INTO checkout_users (username, password_hash, role, display_name)
     VALUES ('pg-admin-1', 'unused', 'admin', 'PG Admin 1'),
            ('pg-admin-2', 'unused', 'admin', 'PG Admin 2'),
            ('pg-admin-3', 'unused', 'admin', 'PG Admin 3')
     RETURNING *`
  );
  const teamUsers = await database.query(
    `INSERT INTO checkout_users (username, password_hash, role, team_id, display_name)
     VALUES ('pg-team-user-a', 'unused', 'team', $1, 'Postgres Team A'),
            ('pg-team-user-b', 'unused', 'team', $2, 'Postgres Team B'),
            ('pg-team-user-c', 'unused', 'team', $3, 'Postgres Team C'),
            ('pg-same-team-user', 'unused', 'team', $4, 'Postgres Same Team')
     RETURNING *`,
    teamRows.rows.map(function (team) { return team.id; })
  );
  const components = await database.query(
    `INSERT INTO checkout_components
      (name, description, image_url, image_alt, category, compatibility, total_quantity,
       reserved_quantity, checked_out_quantity, max_active_per_team, active)
     VALUES ('Postgres Final Item', 'Concurrency item', '/test.svg', 'Test item', 'Electronics', 'N/A', 1, 0, 0, 1, TRUE),
            ('Postgres Same Item A', 'Same-team lock item', '/test.svg', 'Test item A', 'Electronics', 'N/A', 3, 0, 0, 1, TRUE),
            ('Postgres Same Item B', 'Same-team lock item', '/test.svg', 'Test item B', 'Electronics', 'N/A', 3, 0, 0, 1, TRUE),
            ('Postgres Return Item', 'Shared return item', '/test.svg', 'Return item', 'Electronics', 'N/A', 4, 0, 4, 4, TRUE),
            ('Postgres Pickup Item', 'Shared pickup item', '/test.svg', 'Pickup item', 'Electronics', 'N/A', 2, 2, 0, 2, TRUE)
     RETURNING *`
  );
  const teamActors = teamUsers.rows.slice(0, 3).map(function (user, index) {
    return Object.assign({}, user, { team_name: teamRows.rows[index].name });
  });
  const finalItemId = components.rows[0].id;
  const competing = await Promise.allSettled(teamActors.map(function (actor) {
    return service.submitOrder(database, { items: [{ componentId: finalItemId, quantity: 1 }] }, actor);
  }));
  assert.equal(competing.filter(function (result) { return result.status === "fulfilled"; }).length, 1);
  assert.equal(competing.filter(function (result) { return result.status === "rejected" && result.reason.status === 409; }).length, 2);
  const finalInventory = await database.query("SELECT reserved_quantity FROM checkout_components WHERE id = $1", [finalItemId]);
  assert.equal(Number(finalInventory.rows[0].reserved_quantity), 1);

  const sameTeam = teamRows.rows[3];
  const sameActor = { id: 2000, team_id: sameTeam.id, team_name: sameTeam.name, role: "team" };
  const simultaneous = await Promise.allSettled([
    service.submitOrder(database, { items: [{ componentId: components.rows[1].id, quantity: 1 }] }, sameActor),
    service.submitOrder(database, { items: [{ componentId: components.rows[2].id, quantity: 1 }] }, sameActor)
  ]);
  assert.equal(simultaneous.filter(function (result) { return result.status === "fulfilled"; }).length, 1);
  assert.equal(simultaneous.filter(function (result) { return result.status === "rejected" && result.reason.status === 429; }).length, 1);

  const winningOrder = competing.find(function (result) { return result.status === "fulfilled"; }).value;
  const adminActors = admins.rows.map(function (admin) {
    return { id: admin.id, display_name: admin.display_name, role: "admin" };
  });
  const claims = await Promise.allSettled(adminActors.map(function (admin) {
    return service.claimOrder(database, { orderId: winningOrder.id }, admin);
  }));
  assert.equal(claims.filter(function (result) { return result.status === "fulfilled"; }).length, 1);
  assert.equal(claims.filter(function (result) { return result.status === "rejected" && result.reason.status === 409; }).length, 2);

  const returnItemId = components.rows[3].id;
  await database.query(
    `INSERT INTO checkout_team_inventory (team_id, component_id, checked_out_quantity)
     VALUES ($1, $3, 2), ($2, $3, 2)`,
    [teamRows.rows[0].id, teamRows.rows[1].id, returnItemId]
  );
  const returns = await Promise.all([
    service.processReturn(database, {
      teamId: Number(teamRows.rows[0].id),
      items: [{ componentId: Number(returnItemId), quantity: 1, condition: "good", note: "" }]
    }, adminActors[0]),
    service.processReturn(database, {
      teamId: Number(teamRows.rows[1].id),
      items: [{ componentId: Number(returnItemId), quantity: 1, condition: "damaged", note: "Bent pin" }]
    }, adminActors[1])
  ]);
  assert.equal(returns.length, 2);
  const returnInventory = await database.query(
    "SELECT checked_out_quantity, unavailable_quantity FROM checkout_components WHERE id = $1",
    [returnItemId]
  );
  assert.equal(Number(returnInventory.rows[0].checked_out_quantity), 2);
  assert.equal(Number(returnInventory.rows[0].unavailable_quantity), 1);
  const returnHoldings = await database.query(
    `SELECT checked_out_quantity FROM checkout_team_inventory
      WHERE component_id = $1 ORDER BY team_id`,
    [returnItemId]
  );
  assert.deepEqual(returnHoldings.rows.map(function (row) {
    return Number(row.checked_out_quantity);
  }), [1, 1]);

  const pickupItemId = components.rows[4].id;
  const pickupOrders = await database.query(
    `INSERT INTO checkout_orders (team_id, status, accepted_by, ready_by, accepted_at, ready_at)
     VALUES ($1, 'ready', $3, $3, NOW(), NOW()),
            ($2, 'ready', $4, $4, NOW(), NOW())
     RETURNING id`,
    [teamRows.rows[0].id, teamRows.rows[1].id, adminActors[0].id, adminActors[1].id]
  );
  for (const order of pickupOrders.rows) {
    await database.query(
      `INSERT INTO checkout_order_items
        (order_id, component_id, requested_quantity, approved_quantity, component_name_snapshot)
       VALUES ($1, $2, 1, 1, 'Postgres Pickup Item')`,
      [order.id, pickupItemId]
    );
  }
  const pickups = await Promise.all([
    service.transitionOrder(database, { orderId: Number(pickupOrders.rows[0].id) }, adminActors[0], "pickup"),
    service.transitionOrder(database, { orderId: Number(pickupOrders.rows[1].id) }, adminActors[1], "pickup")
  ]);
  assert.ok(pickups.every(function (order) { return order.status === "picked_up"; }));
  const pickupInventory = await database.query(
    "SELECT reserved_quantity, checked_out_quantity FROM checkout_components WHERE id = $1",
    [pickupItemId]
  );
  assert.equal(Number(pickupInventory.rows[0].reserved_quantity), 0);
  assert.equal(Number(pickupInventory.rows[0].checked_out_quantity), 2);
  const pickupHoldings = await database.query(
    `SELECT checked_out_quantity FROM checkout_team_inventory
      WHERE component_id = $1 ORDER BY team_id`,
    [pickupItemId]
  );
  assert.deepEqual(pickupHoldings.rows.map(function (row) {
    return Number(row.checked_out_quantity);
  }), [1, 1]);
});
