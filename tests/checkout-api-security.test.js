const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

process.env.CHECKOUT_FORCE_LIVE = "true";
process.env.CHECKOUT_ADMIN_PASSWORD = "security-test-admin-2026";
process.env.CHECKOUT_PGLITE_PATH = "memory://";

const checkoutHandler = require("../api/checkout");
const { getDatabase, resetDatabaseForTests } = require("../api/_lib/checkout-db");
const { seedCheckout } = require("../api/_lib/checkout-seed");

function request(body, headerOverrides) {
  return new Promise(function (resolve, reject) {
    const incoming = {
      method: "POST",
      headers: Object.assign({
        host: "127.0.0.1:4173",
        origin: "http://127.0.0.1:4173",
        "x-forwarded-for": "192.0.2.10"
      }, headerOverrides || {}),
      body,
      query: {}
    };
    const headers = {};
    const outgoing = {
      statusCode: 200,
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      end(value) {
        try {
          resolve({
            status: this.statusCode,
            headers,
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

before(async function () {
  const database = await getDatabase();
  await seedCheckout(database, { samples: false });
});

after(async function () {
  await resetDatabaseForTests();
});

test("cross-site POSTs are rejected before reaching checkout actions", async function () {
  const response = await request({ action: "status" }, {
    origin: "https://attacker.example",
    "sec-fetch-site": "cross-site"
  });
  assert.equal(response.status, 403);
  assert.match(response.body.error, /cross-site/i);
});

test("oversized request bodies are rejected and API responses carry defensive headers", async function () {
  const response = await request({ action: "login", padding: "x".repeat(70 * 1024) });
  assert.equal(response.status, 413);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["cache-control"], "no-store");
});

test("repeated failed logins are throttled even when the next password is correct", async function () {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const failed = await request({
      action: "login",
      username: "admin",
      password: `incorrect-${attempt}`
    });
    assert.equal(failed.status, 401);
  }

  const throttled = await request({
    action: "login",
    username: "admin",
    password: process.env.CHECKOUT_ADMIN_PASSWORD
  });
  assert.equal(throttled.status, 429);
  assert.match(throttled.body.error, /too many sign-in attempts/i);
});
