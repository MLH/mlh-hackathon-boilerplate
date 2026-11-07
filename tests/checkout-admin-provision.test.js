const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

process.env.CHECKOUT_PGLITE_PATH = "memory://";

const { getDatabase, resetDatabaseForTests } = require("../api/_lib/checkout-db");
const { ADMIN_ACCOUNTS, provisionAdminAccounts } = require("../api/_lib/checkout-admin-provision");
const { verifyPassword } = require("../api/_lib/checkout-security");

let database;
let directory;
let credentialsPath;

before(async function () {
  database = await getDatabase();
  await database.query(
    "INSERT INTO checkout_users (username, password_hash, role, display_name) VALUES ('admin', 'legacy-hash', 'admin', 'Legacy Admin')"
  );
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "makecu-admin-provision-"));
  credentialsPath = path.join(directory, "credentials.json");
});

after(async function () {
  await resetDatabaseForTests();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("provisions 15 distinct admin accounts without storing plaintext passwords in the database", async function () {
  const result = await provisionAdminAccounts(database, { credentialsPath });
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  const rows = await database.query(
    "SELECT username, password_hash, role, display_name, team_id FROM checkout_users WHERE username = ANY($1) ORDER BY username",
    [ADMIN_ACCOUNTS.map(function (account) { return account.username; })]
  );

  assert.deepEqual(result.usernames, Array.from({ length: 15 }, (_, index) => `admin-${index + 1}`));
  assert.equal(credentials.accounts.length, 15);
  assert.equal(new Set(credentials.accounts.map(function (account) { return account.password; })).size, 15);
  assert.ok(credentials.accounts.every(function (account) { return account.password.length >= 30; }));
  assert.equal(rows.rows.length, 15);
  assert.equal(rows.rows.find(row => row.username === "admin-1").display_name, "Otavio Paz");
  const legacy = await database.query("SELECT active FROM checkout_users WHERE username = 'admin'");
  assert.equal(legacy.rows[0].active, false);

  for (const row of rows.rows) {
    const credential = credentials.accounts.find(function (account) { return account.username === row.username; });
    assert.equal(row.role, "admin");
    assert.equal(row.team_id, null);
    assert.notEqual(row.password_hash, credential.password);
    assert.equal(await verifyPassword(credential.password, row.password_hash), true);
  }
});

test("re-running provisioning preserves existing passwords unless rotation is explicit", async function () {
  const before = fs.readFileSync(credentialsPath, "utf8");
  await database.query("UPDATE checkout_users SET display_name = 'Old label' WHERE username = 'admin-1'");
  await provisionAdminAccounts(database, { credentialsPath });
  const after = fs.readFileSync(credentialsPath, "utf8");
  assert.equal(after, before);
  const refreshed = await database.query("SELECT display_name FROM checkout_users WHERE username = 'admin-1'");
  assert.equal(refreshed.rows[0].display_name, "Otavio Paz");
});

test("provisioning preserves a name after its one-time change, including during password rotation", async function () {
  await database.query("UPDATE checkout_users SET display_name = 'New volunteer name', name_change_count = 1 WHERE username = 'admin-2'");
  await provisionAdminAccounts(database, { credentialsPath });
  let credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  assert.equal(credentials.accounts.find(account => account.username === "admin-2").displayName, "New volunteer name");
  const passwordBefore = credentials.accounts[0].password;
  await provisionAdminAccounts(database, { credentialsPath, rotate: true });
  credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  assert.notEqual(credentials.accounts[0].password, passwordBefore);
  assert.equal(credentials.accounts.find(account => account.username === "admin-2").displayName, "New volunteer name");
  const user = await database.query("SELECT name_change_count FROM checkout_users WHERE username = 'admin-2'");
  assert.equal(user.rows[0].name_change_count, 1);
});
