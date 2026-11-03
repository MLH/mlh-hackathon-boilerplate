const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");

process.env.CHECKOUT_FORCE_LIVE = "true";
process.env.CHECKOUT_ADMIN_PASSWORD = "makecu-test-admin-2026";
process.env.CHECKOUT_PGLITE_PATH = "memory://";

const checkoutHandler = require("../api/checkout");
const { getDatabase, resetDatabaseForTests } = require("../api/_lib/checkout-db");
const { liveStatus } = require("../api/_lib/checkout-live");
const { hashPassword, verifyPassword } = require("../api/_lib/checkout-security");
const { seedCheckout } = require("../api/_lib/checkout-seed");

let requestNumber = 0;

function request(action, payload, cookie) {
  return new Promise(function (resolve, reject) {
    const headers = { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" };

    if (cookie) {
      headers.cookie = cookie;
    }

    const incoming = {
      method: "POST",
      headers,
      body: Object.assign({ action, idempotencyKey: `test-${++requestNumber}` }, payload || {}),
      query: {}
    };
    const responseHeaders = {};
    const outgoing = {
      statusCode: 200,
      setHeader(name, value) {
        responseHeaders[name.toLowerCase()] = value;
      },
      end(value) {
        try {
          resolve({
            status: this.statusCode,
            headers: responseHeaders,
            body: value ? JSON.parse(value) : null
          });
        } catch (error) {
          reject(error);
        }
      }
    };

    checkoutHandler(incoming, outgoing).catch(reject);
  });
}

async function login(username, password) {
  const response = await request("login", { username, password });
  assert.equal(response.status, 200);
  return response.headers["set-cookie"].split(";")[0];
}

let database;
let adminCookie;

before(async function () {
  database = await getDatabase();
  await seedCheckout(database, { samples: false });
  adminCookie = await login("admin", process.env.CHECKOUT_ADMIN_PASSWORD);
});

after(async function () {
  await resetDatabaseForTests();
});

test("live window is enforced by server configuration", function () {
  assert.equal(liveStatus(new Date("2025-01-01T00:00:00Z")).live, true);
  process.env.CHECKOUT_FORCE_LIVE = "false";
  assert.equal(liveStatus(new Date("2025-01-01T00:00:00Z")).live, false);
  process.env.CHECKOUT_LIVE_START = "2026-11-07T09:00:00-05:00";
  process.env.CHECKOUT_ORDERING_END = "2026-11-08T10:00:00-05:00";
  process.env.CHECKOUT_RETURN_END = "2026-11-08T12:00:00-05:00";
  const returnPeriod = liveStatus(new Date("2026-11-08T11:00:00-05:00"));
  assert.equal(returnPeriod.phase, "return_period");
  assert.equal(returnPeriod.orderingOpen, false);
  assert.equal(returnPeriod.returnsOpen, true);
  process.env.CHECKOUT_FORCE_LIVE = "true";
});

test("password hashes are salted and verifiable", async function () {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("correct horse battery staple", first), true);
  assert.equal(await verifyPassword("incorrect", first), false);
});

test("transactional order, pickup, damaged return, audit, and team isolation flow", async function () {
  const firstTeam = await request("create-team", {
    name: "Byte Builders",
    identifier: "byte-builders",
    username: "byte-builders",
    password: "byte-test-2026"
  }, adminCookie);
  const secondTeam = await request("create-team", {
    name: "Robo Cats",
    identifier: "robo-cats",
    username: "robo-cats",
    password: "robo-test-2026"
  }, adminCookie);
  assert.equal(firstTeam.status, 201);
  assert.equal(secondTeam.status, 201);

  const component = await request("save-component", {
    name: "Last Camera",
    description: "Concurrency test camera",
    imageUrl: "/images/hardware/last-camera.png",
    imageAlt: "Small camera module on a white background",
    binLocation: "Camera bin",
    technicalSpecs: "Requires a Raspberry Pi camera connector.",
    category: "Camera",
    compatibility: "Raspberry Pi",
    totalQuantity: 1,
    unavailableQuantity: 0,
    protectedStock: 0,
    maxActivePerTeam: 1,
    active: true,
    adminNotes: ""
  }, adminCookie);
  assert.equal(component.status, 201);

  const firstCookie = await login("byte-builders", "byte-test-2026");
  const secondCookie = await login("robo-cats", "robo-test-2026");
  const forbiddenAdminAccess = await request("admin-overview", {}, firstCookie);
  assert.equal(forbiddenAdminAccess.status, 403);
  assert.match(forbiddenAdminAccess.body.error, /permission/i);
  const componentId = component.body.component.id;
  const submissions = await Promise.all([
    request("submit-order", { items: [{ componentId, quantity: 1 }] }, firstCookie),
    request("submit-order", { items: [{ componentId, quantity: 1 }] }, secondCookie)
  ]);
  const success = submissions.find(function (response) { return response.status === 201; });
  const conflict = submissions.find(function (response) { return response.status === 409; });
  assert.ok(success);
  assert.ok(conflict);
  assert.match(conflict.body.error, /could not be reserved/i);

  const winnerCookie = success === submissions[0] ? firstCookie : secondCookie;
  const loserCookie = success === submissions[0] ? secondCookie : firstCookie;
  const winnerTeamId = success === submissions[0] ? firstTeam.body.team.id : secondTeam.body.team.id;
  const orderId = success.body.order.id;

  const cooldown = await request("submit-order", { items: [{ componentId, quantity: 1 }] }, winnerCookie);
  assert.equal(cooldown.status, 429);

  const forbiddenOrder = await request("order", { orderId }, loserCookie);
  assert.equal(forbiddenOrder.status, 404);

  assert.equal((await request("claim-order", { orderId }, adminCookie)).status, 200);
  assert.equal((await request("accept-order", { orderId }, adminCookie)).body.order.status, "accepted");
  assert.equal((await request("mark-ready", { orderId }, adminCookie)).body.order.status, "ready");
  assert.equal((await request("confirm-pickup", { orderId }, adminCookie)).body.order.status, "picked_up");
  assert.equal((await request("confirm-pickup", { orderId }, adminCookie)).body.order.status, "picked_up");

  const detailBefore = await request("team-detail", { teamId: winnerTeamId }, adminCookie);
  assert.equal(detailBefore.body.inventory[0].checkedOutQuantity, 1);
  const teamDashboard = await request("team-dashboard", {}, winnerCookie);
  assert.equal(teamDashboard.body.inventory[0].imageUrl, "/images/hardware/last-camera.png");
  assert.equal(teamDashboard.body.inventory[0].imageAlt, "Small camera module on a white background");
  const returned = await request("process-return", {
    teamId: winnerTeamId,
    items: [{ componentId, quantity: 1, condition: "damaged", note: "Lens cracked during demo." }]
  }, adminCookie);
  assert.equal(returned.status, 201);
  assert.equal(returned.body.inventory.length, 0);
  assert.equal(returned.body.returns[0].items[0].condition, "damaged");

  const catalog = await request("catalog", {}, adminCookie);
  const finalComponent = catalog.body.components.find(function (item) { return item.id === componentId; });
  assert.equal(finalComponent.availableQuantity, 0);
  assert.equal(finalComponent.checkedOutQuantity, 0);
  assert.equal(finalComponent.unavailableQuantity, 1);

  const activity = await request("activity", {}, adminCookie);
  assert.ok(activity.body.activity.some(function (item) { return item.message.indexOf("confirmed pickup") >= 0; }));
  const orderActivity = activity.body.activity.find(function (item) {
    return item.receiptType === "order" && item.orderId === orderId;
  });
  assert.ok(orderActivity);
  assert.equal(orderActivity.teamName, success === submissions[0] ? "Byte Builders" : "Robo Cats");
  assert.match(orderActivity.receiptCode, /^O-\d{5}$/);
  const openedOrder = await request("activity-receipt", { activityId: orderActivity.id }, adminCookie);
  assert.equal(openedOrder.status, 200);
  assert.equal(openedOrder.body.receiptType, "order");
  assert.equal(openedOrder.body.order.id, orderId);

  const inventoryActivity = activity.body.activity.find(function (item) {
    return item.receiptType == null && item.message.indexOf("Last Camera") >= 0;
  });
  assert.ok(inventoryActivity);
  assert.equal((await request("activity-receipt", { activityId: inventoryActivity.id }, adminCookie)).status, 404);
  assert.equal((await request("activity-receipt", { activityId: 2147483647 }, adminCookie)).status, 404);

  const returnActivity = activity.body.activity.find(function (item) { return /processed R-\d+/.test(item.message); });
  assert.ok(returnActivity);
  assert.equal(returnActivity.actorName, "MakeCU Admin");
  assert.equal(returnActivity.actorRole, "admin");
  assert.equal(returnActivity.teamName, success === submissions[0] ? "Byte Builders" : "Robo Cats");
  assert.equal(returnActivity.receiptType, "return");
  assert.match(returnActivity.receiptCode, /^R-\d{5}$/);

  const openedReceipt = await request("activity-receipt", { activityId: returnActivity.id }, adminCookie);
  assert.equal(openedReceipt.status, 200);
  assert.equal(openedReceipt.body.receiptType, "return");
  assert.equal(openedReceipt.body.team.id, winnerTeamId);
  assert.equal(openedReceipt.body.receipt.processedBy, "MakeCU Admin");
  assert.equal(openedReceipt.body.receipt.items[0].condition, "damaged");

  await database.query("UPDATE checkout_activity SET return_receipt_id = NULL WHERE id = $1", [returnActivity.id]);
  await database.exec(fs.readFileSync(path.join(process.cwd(), "db", "checkout-schema.sql"), "utf8"));
  const migratedActivity = (await request("activity", {}, adminCookie)).body.activity.find(function (item) {
    return item.id === returnActivity.id;
  });
  assert.equal(migratedActivity.receiptType, "return");
  assert.equal(migratedActivity.receiptCode, returnActivity.receiptCode);
  assert.equal((await request("activity-receipt", { activityId: migratedActivity.id }, adminCookie)).status, 200);

  const deniedReceipt = await request("activity-receipt", { activityId: returnActivity.id }, winnerCookie);
  assert.equal(deniedReceipt.status, 403);
});

test("same-team simultaneous submissions are serialized", async function () {
  const team = await request("create-team", {
    name: "Parallel Penguins",
    identifier: "parallel-penguins",
    username: "parallel-penguins",
    password: "parallel-test-2026"
  }, adminCookie);
  const firstComponent = await request("save-component", {
    name: "Parallel Sensor A",
    description: "Team locking test",
    imageUrl: "/images/hardware/sensor-a.png",
    imageAlt: "Sensor A board",
    category: "Sensor",
    compatibility: "Arduino",
    binLocation: "Test bin A",
    technicalSpecs: "3.3 V logic",
    totalQuantity: 5,
    unavailableQuantity: 0,
    protectedStock: 0,
    maxActivePerTeam: 5,
    active: true,
    adminNotes: ""
  }, adminCookie);
  const secondComponent = await request("save-component", {
    name: "Parallel Sensor B",
    description: "Team locking test",
    imageUrl: "/images/hardware/sensor-b.png",
    imageAlt: "Sensor B board",
    category: "Sensor",
    compatibility: "Arduino",
    binLocation: "Test bin B",
    technicalSpecs: "5 V logic",
    totalQuantity: 5,
    unavailableQuantity: 0,
    protectedStock: 0,
    maxActivePerTeam: 5,
    active: true,
    adminNotes: ""
  }, adminCookie);
  const cookie = await login("parallel-penguins", "parallel-test-2026");
  const submissions = await Promise.all([
    request("submit-order", {
      idempotencyKey: "parallel-order-a",
      items: [{ componentId: firstComponent.body.component.id, quantity: 1 }]
    }, cookie),
    request("submit-order", {
      idempotencyKey: "parallel-order-b",
      items: [{ componentId: secondComponent.body.component.id, quantity: 1 }]
    }, cookie)
  ]);

  assert.equal(submissions.filter(function (response) { return response.status === 201; }).length, 1);
  assert.equal(submissions.filter(function (response) { return response.status === 429; }).length, 1);
});

test("an idempotency key replays the original order result", async function () {
  const team = await request("create-team", {
    name: "Retry Robots",
    identifier: "retry-robots",
    username: "retry-robots",
    password: "retry-test-2026"
  }, adminCookie);
  const component = await request("save-component", {
    name: "Retry Board",
    description: "Idempotency test",
    imageUrl: "/images/hardware/retry-board.png",
    imageAlt: "Small controller board",
    category: "Microcontroller",
    compatibility: "Arduino",
    binLocation: "Test bin C",
    technicalSpecs: "USB powered",
    totalQuantity: 3,
    unavailableQuantity: 0,
    protectedStock: 0,
    maxActivePerTeam: 3,
    active: true,
    adminNotes: ""
  }, adminCookie);
  const cookie = await login("retry-robots", "retry-test-2026");
  const payload = {
    idempotencyKey: "same-order-request",
    items: [{ componentId: component.body.component.id, quantity: 1 }]
  };
  const first = await request("submit-order", payload, cookie);
  const replay = await request("submit-order", payload, cookie);
  const mismatchedReplay = await request("submit-order", {
    idempotencyKey: "same-order-request",
    items: [{ componentId: component.body.component.id, quantity: 2 }]
  }, cookie);

  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.equal(replay.body.order.id, first.body.order.id);
  assert.equal(mismatchedReplay.status, 409);
  assert.match(mismatchedReplay.body.error, /different request/i);

  const catalog = await request("catalog", {}, adminCookie);
  const stored = catalog.body.components.find(function (item) { return item.id === component.body.component.id; });
  assert.equal(stored.reservedQuantity, 1);
});

test("stale component edits are rejected", async function () {
  const created = await request("save-component", {
    name: "Versioned Driver",
    description: "Version conflict test",
    imageUrl: "/images/hardware/versioned-driver.png",
    imageAlt: "Dual motor driver board",
    category: "Motor Related",
    compatibility: "Arduino + Raspberry Pi",
    binLocation: "Driver bin",
    technicalSpecs: "External motor power required.",
    totalQuantity: 8,
    unavailableQuantity: 0,
    protectedStock: 1,
    maxActivePerTeam: 2,
    active: true,
    adminNotes: ""
  }, adminCookie);
  const original = created.body.component;
  const base = {
    id: original.id,
    expectedVersion: original.version,
    name: original.name,
    description: original.description,
    imageUrl: original.imageUrl,
    imageAlt: original.imageAlt,
    category: original.category,
    compatibility: original.compatibility,
    binLocation: original.binLocation,
    technicalSpecs: original.technicalSpecs,
    totalQuantity: original.totalQuantity,
    unavailableQuantity: original.unavailableQuantity,
    protectedStock: original.protectedStock,
    maxActivePerTeam: original.maxActivePerTeam,
    active: true,
    adminNotes: "",
    changeReason: "Physical count verified"
  };
  const first = await request("save-component", Object.assign({}, base, { totalQuantity: 9 }), adminCookie);
  const stale = await request("save-component", Object.assign({}, base, { totalQuantity: 10 }), adminCookie);

  assert.equal(first.status, 200);
  assert.equal(first.body.component.version, original.version + 1);
  assert.equal(stale.status, 409);
  assert.match(stale.body.error, /changed since you opened/i);
});

test("only one of three admins can claim an order and an expired claim can be taken over", async function () {
  const password = "volunteer-test-2026";
  const passwordHash = await hashPassword(password);

  for (const username of ["volunteer-two", "volunteer-three"]) {
    await database.query(
      `INSERT INTO checkout_users (username, password_hash, role, display_name)
       VALUES ($1, $2, 'admin', $3)`,
      [username, passwordHash, username]
    );
  }

  const secondAdminCookie = await login("volunteer-two", password);
  const thirdAdminCookie = await login("volunteer-three", password);
  await request("create-team", {
    name: "Claim Testers",
    identifier: "claim-testers",
    username: "claim-testers",
    password: "claim-test-2026"
  }, adminCookie);
  const component = await request("save-component", {
    name: "Claim Test Relay",
    description: "Admin claim test",
    imageUrl: "/images/hardware/claim-relay.png",
    imageAlt: "Blue relay module",
    category: "Electronics",
    compatibility: "Arduino + Raspberry Pi",
    binLocation: "Relay bin",
    technicalSpecs: "Use a logic-safe control input.",
    totalQuantity: 4,
    unavailableQuantity: 0,
    protectedStock: 0,
    maxActivePerTeam: 2,
    active: true,
    adminNotes: ""
  }, adminCookie);
  const teamCookie = await login("claim-testers", "claim-test-2026");
  const order = await request("submit-order", {
    items: [{ componentId: component.body.component.id, quantity: 1 }]
  }, teamCookie);
  const cookies = [adminCookie, secondAdminCookie, thirdAdminCookie];
  const claims = await Promise.all(cookies.map(function (cookie, index) {
    return request("claim-order", {
      idempotencyKey: `claim-race-${index}`,
      orderId: order.body.order.id
    }, cookie);
  }));

  assert.equal(claims.filter(function (response) { return response.status === 200; }).length, 1);
  assert.equal(claims.filter(function (response) { return response.status === 409; }).length, 2);

  const winnerIndex = claims.findIndex(function (response) { return response.status === 200; });
  const takeoverCookie = cookies[(winnerIndex + 1) % cookies.length];
  await database.query(
    "UPDATE checkout_orders SET claim_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1",
    [order.body.order.id]
  );
  const takeover = await request("claim-order", {
    orderId: order.body.order.id
  }, takeoverCookie);

  assert.equal(takeover.status, 200);
  assert.equal(takeover.body.order.status, "reviewing");
  assert.notEqual(takeover.body.order.reviewedBy, claims[winnerIndex].body.order.reviewedBy);
});

test("pickup and cancellation cannot both win", async function () {
  await request("create-team", {
    name: "Transition Racers",
    identifier: "transition-racers",
    username: "transition-racers",
    password: "transition-test-2026"
  }, adminCookie);
  const component = await request("save-component", {
    name: "Transition Test Motor",
    description: "Pickup versus cancellation test",
    imageUrl: "/images/hardware/transition-motor.png",
    imageAlt: "Small DC motor",
    category: "Motor",
    compatibility: "Arduino + Raspberry Pi",
    binLocation: "Motor test bin",
    technicalSpecs: "Requires a motor driver and external power.",
    totalQuantity: 2,
    unavailableQuantity: 0,
    protectedStock: 0,
    maxActivePerTeam: 2,
    active: true,
    adminNotes: ""
  }, adminCookie);
  const teamCookie = await login("transition-racers", "transition-test-2026");
  const submitted = await request("submit-order", {
    items: [{ componentId: component.body.component.id, quantity: 1 }]
  }, teamCookie);
  const orderId = submitted.body.order.id;

  await request("claim-order", { orderId }, adminCookie);
  await request("accept-order", { orderId }, adminCookie);
  await request("mark-ready", { orderId }, adminCookie);

  const transitions = await Promise.all([
    request("confirm-pickup", { idempotencyKey: "pickup-race", orderId }, adminCookie),
    request("cancel-order", { idempotencyKey: "cancel-race", orderId }, adminCookie)
  ]);

  assert.equal(transitions.filter(function (response) { return response.status === 200; }).length, 1);
  assert.equal(transitions.filter(function (response) { return response.status === 409; }).length, 1);

  const detail = await request("order", { orderId }, adminCookie);
  assert.ok(["picked_up", "cancelled"].includes(detail.body.order.status));
});

test("expired orders release their reservation and keep a receipt", async function () {
  await request("create-team", {
    name: "Expiry Explorers",
    identifier: "expiry-explorers",
    username: "expiry-explorers",
    password: "expiry-test-2026"
  }, adminCookie);
  const component = await request("save-component", {
    name: "Expiry Test Cable",
    description: "Reservation expiry test",
    imageUrl: "/images/hardware/expiry-cable.png",
    imageAlt: "Short USB cable",
    category: "Electronics",
    compatibility: "N/A",
    binLocation: "Cable test bin",
    technicalSpecs: "USB data cable.",
    totalQuantity: 2,
    unavailableQuantity: 0,
    protectedStock: 0,
    maxActivePerTeam: 2,
    active: true,
    adminNotes: ""
  }, adminCookie);
  const teamCookie = await login("expiry-explorers", "expiry-test-2026");
  const submitted = await request("submit-order", {
    items: [{ componentId: component.body.component.id, quantity: 1 }]
  }, teamCookie);

  await database.query(
    "UPDATE checkout_orders SET reservation_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1",
    [submitted.body.order.id]
  );
  const dashboard = await request("team-dashboard", {}, teamCookie);
  const expired = dashboard.body.orders.find(function (order) { return order.id === submitted.body.order.id; });
  const catalog = await request("catalog", {}, adminCookie);
  const stored = catalog.body.components.find(function (item) { return item.id === component.body.component.id; });

  assert.equal(expired.status, "expired");
  assert.match(expired.receiptCode, /^O-\d{5}$/);
  assert.equal(stored.reservedQuantity, 0);
  assert.equal(stored.availableQuantity, 2);
});

test("structured relationships drive cart advice and block missing required hardware", async function () {
  const team = await request("create-team", {
    name: "Relationship Test Team",
    identifier: "relationship-test-team",
    username: "relationship-test-team",
    password: "relationship-test-2026"
  }, adminCookie);
  const driver = await request("save-component", {
    name: "Relationship Test Driver",
    description: "Dual motor driver used by the relationship test.",
    imageUrl: "/images/checkout-image-pending.svg",
    imageAlt: "Placeholder for the relationship test driver",
    category: "Motor Related",
    compatibility: "Arduino + Raspberry Pi",
    arduinoGuidance: "Connect logic inputs to Arduino GPIO and use separate motor power.",
    raspberryPiGuidance: "Use 3.3 V-compatible logic and a common ground.",
    technicalSpecs: "Controls two motors.",
    totalQuantity: 10,
    unavailableQuantity: 0,
    protectedStock: 0,
    maxActivePerTeam: 4,
    active: true
  }, adminCookie);
  const motor = await request("save-component", {
    name: "Relationship Test Motor",
    description: "DC motor used by the relationship test.",
    imageUrl: "/images/checkout-image-pending.svg",
    imageAlt: "Placeholder for the relationship test motor",
    category: "Motor",
    compatibility: "Arduino + Raspberry Pi",
    arduinoGuidance: "Requires a motor driver; never connect directly to a GPIO pin.",
    raspberryPiGuidance: "Requires a motor driver and external motor power.",
    technicalSpecs: "Brushed DC motor.",
    totalQuantity: 10,
    unavailableQuantity: 0,
    protectedStock: 0,
    maxActivePerTeam: 6,
    active: true,
    relationships: [{
      targetComponentId: driver.body.component.id,
      relationType: "compatible_driver",
      quantityRatio: 2,
      minimumSourceQuantity: 1,
      message: "Use one test driver for every two test motors."
    }]
  }, adminCookie);
  assert.equal(team.status, 201);
  assert.equal(driver.status, 201);
  assert.equal(motor.status, 201);
  assert.equal(motor.body.component.relationships[0].quantityRatio, 2);

  const metadataOnlyUpdate = await request("save-component", {
    id: motor.body.component.id,
    expectedVersion: motor.body.component.version,
    name: motor.body.component.name,
    description: `${motor.body.component.description} Updated without a relationships field.`,
    imageUrl: motor.body.component.imageUrl,
    imageAlt: motor.body.component.imageAlt,
    category: motor.body.component.category,
    compatibility: motor.body.component.compatibility,
    arduinoGuidance: motor.body.component.arduinoGuidance,
    raspberryPiGuidance: motor.body.component.raspberryPiGuidance,
    binLocation: motor.body.component.binLocation,
    technicalSpecs: motor.body.component.technicalSpecs,
    totalQuantity: motor.body.component.totalQuantity,
    unavailableQuantity: motor.body.component.unavailableQuantity,
    protectedStock: motor.body.component.protectedStock,
    maxActivePerTeam: motor.body.component.maxActivePerTeam,
    active: motor.body.component.active,
    adminNotes: motor.body.component.adminNotes,
    changeReason: "Verify metadata-only updates preserve relationships."
  }, adminCookie);
  assert.equal(metadataOnlyUpdate.status, 200);
  assert.equal(metadataOnlyUpdate.body.component.relationships.length, 1);
  assert.equal(metadataOnlyUpdate.body.component.relationships[0].targetComponentId, driver.body.component.id);

  const teamCookie = await login("relationship-test-team", "relationship-test-2026");
  const advice = await request("cart-advice", {
    items: [{ componentId: motor.body.component.id, quantity: 3 }]
  }, teamCookie);
  assert.equal(advice.status, 200);
  assert.equal(advice.body.advice[0].severity, "required");
  assert.equal(advice.body.advice[0].missingQuantity, 2);

  const blocked = await request("submit-order", {
    items: [{ componentId: motor.body.component.id, quantity: 3 }]
  }, teamCookie);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /missing required supporting hardware/i);

  const submitted = await request("submit-order", {
    items: [
      { componentId: motor.body.component.id, quantity: 3 },
      { componentId: driver.body.component.id, quantity: 2 }
    ]
  }, teamCookie);
  assert.equal(submitted.status, 201);
});

test("admins can create a reason-required protected-stock exception order", async function () {
  const team = await request("create-team", {
    name: "Protected Stock Team",
    identifier: "protected-stock-team",
    username: "protected-stock-team",
    password: "protected-test-2026"
  }, adminCookie);
  const component = await request("save-component", {
    name: "Protected Test Board",
    description: "Scarce board reserved for exceptions.",
    imageUrl: "/images/checkout-image-pending.svg",
    imageAlt: "Placeholder for a scarce test board",
    category: "Microcontroller",
    compatibility: "Arduino",
    totalQuantity: 3,
    unavailableQuantity: 0,
    protectedStock: 2,
    maxActivePerTeam: 3,
    active: true
  }, adminCookie);
  const teamCookie = await login("protected-stock-team", "protected-test-2026");
  const blocked = await request("submit-order", {
    items: [{ componentId: component.body.component.id, quantity: 2 }]
  }, teamCookie);
  assert.equal(blocked.status, 409);

  const missingReason = await request("create-protected-stock-order", {
    teamId: team.body.team.id,
    reason: "",
    items: [{ componentId: component.body.component.id, quantity: 2 }]
  }, adminCookie);
  assert.equal(missingReason.status, 400);

  const override = await request("create-protected-stock-order", {
    teamId: team.body.team.id,
    reason: "Approved replacement board for the final demo.",
    items: [{ componentId: component.body.component.id, quantity: 2 }]
  }, adminCookie);
  assert.equal(override.status, 201);
  assert.equal(override.body.order.status, "reviewing");
  assert.equal(override.body.order.protectedStockOverrideReason, "Approved replacement board for the final demo.");
  assert.equal(override.body.order.reviewedBy > 0, true);

  const activity = await request("activity", {}, adminCookie);
  assert.ok(activity.body.activity.some(function (item) {
    return item.message.indexOf("using protected stock") >= 0;
  }));
});

test("return mistakes are corrected with append-only correction receipts", async function () {
  const team = await request("create-team", {
    name: "Return Correction Team",
    identifier: "return-correction-team",
    username: "return-correction-team",
    password: "correction-test-2026"
  }, adminCookie);
  const component = await request("save-component", {
    name: "Correction Test Sensor",
    description: "Sensor used to verify append-only return corrections.",
    imageUrl: "/images/checkout-image-pending.svg",
    imageAlt: "Placeholder for the correction test sensor",
    category: "Sensor",
    compatibility: "Arduino",
    totalQuantity: 2,
    unavailableQuantity: 0,
    protectedStock: 0,
    maxActivePerTeam: 2,
    active: true
  }, adminCookie);
  const teamCookie = await login("return-correction-team", "correction-test-2026");
  const submitted = await request("submit-order", {
    items: [{ componentId: component.body.component.id, quantity: 1 }]
  }, teamCookie);
  const orderId = submitted.body.order.id;
  await request("claim-order", { orderId }, adminCookie);
  await request("accept-order", { orderId }, adminCookie);
  await request("mark-ready", { orderId }, adminCookie);
  await request("confirm-pickup", { orderId }, adminCookie);

  const returned = await request("process-return", {
    teamId: team.body.team.id,
    items: [{ componentId: component.body.component.id, quantity: 1, condition: "good", note: "" }]
  }, adminCookie);
  assert.equal(returned.body.inventory.length, 0);
  const returnReceipt = returned.body.returns[0];

  const corrected = await request("correct-return", {
    returnReceiptId: returnReceipt.id,
    reason: "Volunteer selected returned instead of still with team.",
    items: [{
      originalReturnItemId: returnReceipt.items[0].id,
      quantity: 1,
      correctedCondition: "still_held",
      note: "Team confirmed the sensor is still installed in its project."
    }]
  }, adminCookie);
  assert.equal(corrected.status, 201);
  assert.equal(corrected.body.inventory[0].checkedOutQuantity, 1);
  assert.equal(corrected.body.returns[0].items[0].correctableQuantity, 0);
  assert.equal(corrected.body.returnCorrections[0].items[0].correctedCondition, "still_held");
  assert.match(corrected.body.returnCorrections[0].receiptCode, /^C-/);

  const activity = await request("activity", {}, adminCookie);
  const correctionActivity = activity.body.activity.find(function (item) {
    return item.receiptType === "correction" && item.teamName === "Return Correction Team";
  });
  assert.ok(correctionActivity);
  const openedCorrection = await request("activity-receipt", { activityId: correctionActivity.id }, adminCookie);
  assert.equal(openedCorrection.status, 200);
  assert.equal(openedCorrection.body.receiptType, "correction");
  assert.equal(openedCorrection.body.team.name, "Return Correction Team");
  assert.equal(openedCorrection.body.receipt.reason, "Volunteer selected returned instead of still with team.");

  const catalog = await request("catalog", {}, adminCookie);
  const correctedComponent = catalog.body.components.find(function (item) {
    return item.id === component.body.component.id;
  });
  assert.equal(correctedComponent.checkedOutQuantity, 1);
  assert.equal(correctedComponent.availableQuantity, 1);
});

test("end-of-event report reconciles counters and flags discrepancies", async function () {
  const balanced = await request("discrepancy-report", {}, adminCookie);
  assert.equal(balanced.status, 200);
  assert.equal(balanced.body.summary.componentsWithMismatches, 0);
  assert.ok(balanced.body.summary.teamsHoldingHardware > 0);

  const componentResult = await database.query(
    "SELECT id FROM checkout_components WHERE name = 'Correction Test Sensor'"
  );
  const componentId = componentResult.rows[0].id;
  await database.query(
    "UPDATE checkout_components SET checked_out_quantity = checked_out_quantity + 1 WHERE id = $1",
    [componentId]
  );
  const mismatched = await request("discrepancy-report", {}, adminCookie);
  assert.equal(mismatched.body.summary.componentsWithMismatches, 1);
  assert.equal(mismatched.body.components.find(function (item) {
    return item.componentId === Number(componentId);
  }).holdingDifference, 1);
  await database.query(
    "UPDATE checkout_components SET checked_out_quantity = checked_out_quantity - 1 WHERE id = $1",
    [componentId]
  );
});

test("MLH-tagged quantities are informational and cannot be reserved through CURC", async function () {
  await request("create-team", {
    name: "MLH Desk Testers",
    identifier: "mlh-desk-testers",
    username: "mlh-desk-testers",
    password: "mlh-desk-test-2026"
  }, adminCookie);
  const mlhOnly = await request("save-component", {
    name: "MLH Test Sensor",
    description: "Test item managed entirely by the MLH desk.",
    imageUrl: "/images/checkout-image-pending.svg",
    imageAlt: "Placeholder for the MLH test sensor",
    category: "Sensor",
    compatibility: "Arduino + Raspberry Pi",
    totalQuantity: 7,
    mlhQuantity: 7,
    unavailableQuantity: 0,
    protectedStock: 0,
    maxActivePerTeam: 2,
    active: true,
    adminNotes: "Source: MLH."
  }, adminCookie);
  const mixed = await request("save-component", {
    name: "Mixed Desk Test Sensor",
    description: "Three CURC units and two informational MLH units.",
    imageUrl: "/images/checkout-image-pending.svg",
    imageAlt: "Placeholder for the mixed desk test sensor",
    category: "Sensor",
    compatibility: "Arduino + Raspberry Pi",
    totalQuantity: 5,
    mlhQuantity: 2,
    unavailableQuantity: 0,
    protectedStock: 0,
    maxActivePerTeam: 3,
    active: true,
    adminNotes: "Source: CURC, MLH."
  }, adminCookie);
  const teamCookie = await login("mlh-desk-testers", "mlh-desk-test-2026");
  const catalog = await request("catalog", {}, teamCookie);
  const mlhCatalogItem = catalog.body.components.find(function (item) {
    return item.id === mlhOnly.body.component.id;
  });
  const mixedCatalogItem = catalog.body.components.find(function (item) {
    return item.id === mixed.body.component.id;
  });

  assert.equal(mlhCatalogItem.mlhOnly, true);
  assert.equal(mlhCatalogItem.mlhQuantity, 7);
  assert.equal(mlhCatalogItem.availableQuantity, 0);
  assert.equal(mlhCatalogItem.teamAvailableQuantity, 0);
  assert.equal(mixedCatalogItem.mlhOnly, false);
  assert.equal(mixedCatalogItem.mlhQuantity, 2);
  assert.equal(mixedCatalogItem.availableQuantity, 3);

  const blocked = await request("submit-order", {
    items: [{ componentId: mlhOnly.body.component.id, quantity: 1 }]
  }, teamCookie);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.details.items[0].message, /MLH desk/i);

  const reserved = await request("submit-order", {
    items: [{ componentId: mixed.body.component.id, quantity: 3 }]
  }, teamCookie);
  assert.equal(reserved.status, 201);
});
