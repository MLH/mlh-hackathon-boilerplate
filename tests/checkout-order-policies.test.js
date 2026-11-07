const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

process.env.CHECKOUT_PGLITE_PATH = "memory://";

const { getDatabase, resetDatabaseForTests } = require("../api/_lib/checkout-db");
const service = require("../api/_lib/checkout-service");

let database;
let admin;
let policyTeam;
let policyActor;
let simultaneousTeam;
let simultaneousActor;
let components;
let simultaneousWinningOrder;

async function createTeam(name, identifier) {
  const teamResult = await database.query(
    "INSERT INTO checkout_teams (name, identifier) VALUES ($1, $2) RETURNING *",
    [name, identifier]
  );
  const team = teamResult.rows[0];
  const userResult = await database.query(
    `INSERT INTO checkout_users (username, password_hash, role, team_id, display_name)
     VALUES ($1, 'unused', 'team', $2, $3) RETURNING *`,
    [`${identifier}-user`, team.id, name]
  );
  return {
    team,
    actor: Object.assign({}, userResult.rows[0], { team_name: name })
  };
}

async function expirationSeconds(orderId) {
  const result = await database.query(
    `SELECT EXTRACT(EPOCH FROM (reservation_expires_at - NOW())) AS seconds
       FROM checkout_orders WHERE id = $1`,
    [orderId]
  );
  return Number(result.rows[0].seconds);
}

before(async function () {
  database = await getDatabase();
  const adminResult = await database.query(
    `INSERT INTO checkout_users (username, password_hash, role, display_name)
     VALUES ('policy-admin', 'unused', 'admin', 'Policy Admin') RETURNING *`
  );
  admin = adminResult.rows[0];

  const first = await createTeam("Policy Team", "policy-team");
  policyTeam = first.team;
  policyActor = first.actor;
  const second = await createTeam("Two Browser Team", "two-browser-team");
  simultaneousTeam = second.team;
  simultaneousActor = second.actor;

  const componentResult = await database.query(
    `INSERT INTO checkout_components
      (name, description, image_url, image_alt, category, compatibility,
       total_quantity, max_active_per_team, active)
     SELECT 'Policy Component ' || number, 'Policy test item', '/test.svg', 'Test item',
            CASE WHEN number = 1 THEN 'Motor' WHEN number = 2 THEN 'Motor Related' ELSE 'Electronics' END,
            'N/A', 100, 100, TRUE
       FROM generate_series(1, 11) AS series(number)
     RETURNING *`
  );
  components = componentResult.rows;
  await database.query(
    `INSERT INTO checkout_component_relationships
      (source_component_id, target_component_id, relation_type, quantity_ratio, message)
     VALUES ($1, $2, 'compatible_driver', 1, 'Use a driver with this motor.')`,
    [components[0].id, components[1].id]
  );
});

after(async function () {
  await resetDatabaseForTests();
});

test("orders reject more than 10 distinct items before reserving inventory", async function () {
  await assert.rejects(
    service.submitOrder(database, {
      items: components.map(function (component) {
        return { componentId: Number(component.id), quantity: 1 };
      })
    }, policyActor),
    function (error) {
      return error.status === 400 && /at most 10 different items/i.test(error.message);
    }
  );
  const orders = await database.query("SELECT COUNT(*) AS count FROM checkout_orders WHERE team_id = $1", [policyTeam.id]);
  assert.equal(Number(orders.rows[0].count), 0);
});

test("a missing motor driver warns but does not block and submitted orders expire in one hour", async function () {
  const advice = await service.cartAdvice(database, policyActor, [
    { componentId: Number(components[0].id), quantity: 1 }
  ]);
  assert.equal(advice.length, 1);
  assert.equal(advice[0].severity, "warning");

  const order = await service.submitOrder(database, {
    items: [{ componentId: Number(components[0].id), quantity: 1 }]
  }, policyActor);
  assert.equal(order.status, "submitted");
  assert.ok(await expirationSeconds(order.id) > 3590);
});

test("an admin can grant one audited timeout exception and it is consumed by the next order", async function () {
  const blocked = await service.teamDashboard(database, policyActor);
  assert.ok(blocked.cooldownSeconds > 2600);

  const exception = await service.grantOrderCooldownOverride(database, {
    teamId: Number(policyTeam.id),
    reason: "Team needs a replacement part for a failed prototype."
  }, admin);
  assert.equal(exception.cooldown.overrideAvailable, true);

  const dashboard = await service.teamDashboard(database, policyActor);
  assert.equal(dashboard.cooldownSeconds, 0);
  const order = await service.submitOrder(database, {
    items: [{ componentId: Number(components[1].id), quantity: 1 }]
  }, policyActor);
  assert.equal(order.status, "submitted");

  const override = await database.query(
    "SELECT consumed_at, order_id FROM checkout_order_cooldown_overrides WHERE id = $1",
    [exception.overrideId]
  );
  assert.ok(override.rows[0].consumed_at);
  assert.equal(Number(override.rows[0].order_id), order.id);
  await assert.rejects(
    service.submitOrder(database, {
      items: [{ componentId: Number(components[2].id), quantity: 1 }]
    }, policyActor),
    function (error) { return error.status === 429; }
  );
});

test("two simultaneous submissions from the same team serialize so only one succeeds", async function () {
  const results = await Promise.allSettled([
    service.submitOrder(database, {
      items: [{ componentId: Number(components[2].id), quantity: 1 }]
    }, simultaneousActor),
    service.submitOrder(database, {
      items: [{ componentId: Number(components[3].id), quantity: 1 }]
    }, simultaneousActor)
  ]);
  assert.equal(results.filter(function (result) { return result.status === "fulfilled"; }).length, 1);
  assert.equal(results.filter(function (result) {
    return result.status === "rejected" && result.reason.status === 429;
  }).length, 1);
  simultaneousWinningOrder = results.find(function (result) { return result.status === "fulfilled"; }).value;
});

test("reviewing, accepted, and ready stages each receive a one-hour expiration", async function () {
  await service.claimOrder(database, { orderId: simultaneousWinningOrder.id }, admin);
  assert.ok(await expirationSeconds(simultaneousWinningOrder.id) > 3590);
  await service.transitionOrder(database, { orderId: simultaneousWinningOrder.id }, admin, "accept");
  assert.ok(await expirationSeconds(simultaneousWinningOrder.id) > 3590);
  await service.transitionOrder(database, { orderId: simultaneousWinningOrder.id }, admin, "ready");
  assert.ok(await expirationSeconds(simultaneousWinningOrder.id) > 3590);
});

test("40 teams can submit simultaneously without losing reservations", async function () {
  const loadComponent = await database.query(
    `INSERT INTO checkout_components
      (name, description, image_url, image_alt, category, compatibility,
       total_quantity, max_active_per_team, active)
     VALUES ('Forty Team Load Item', 'Load test item', '/test.svg', 'Load test item',
             'Electronics', 'N/A', 40, 1, TRUE)
     RETURNING id`
  );
  const actors = [];

  for (let index = 1; index <= 40; index += 1) {
    const created = await createTeam(`Load Team ${index}`, `load-team-${index}`);
    actors.push(created.actor);
  }

  const results = await Promise.allSettled(actors.map(function (actor) {
    return service.submitOrder(database, {
      items: [{ componentId: Number(loadComponent.rows[0].id), quantity: 1 }]
    }, actor);
  }));
  const failures = results.filter(function (result) { return result.status === "rejected"; });
  assert.deepEqual(failures, []);

  const inventory = await database.query(
    "SELECT reserved_quantity FROM checkout_components WHERE id = $1",
    [loadComponent.rows[0].id]
  );
  assert.equal(Number(inventory.rows[0].reserved_quantity), 40);
});
