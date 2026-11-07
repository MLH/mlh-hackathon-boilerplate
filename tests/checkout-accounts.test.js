const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.CHECKOUT_PGLITE_PATH = "memory://";
process.env.CHECKOUT_FORCE_LIVE = "true";
const handler = require("../api/checkout");
const { getDatabase, resetDatabaseForTests } = require("../api/_lib/checkout-db");
const { provisionAdminAccounts } = require("../api/_lib/checkout-admin-provision");
const { provisionTeamAccounts } = require("../api/_lib/checkout-team-provision");
const { verifyPassword } = require("../api/_lib/checkout-security");
const service = require("../api/_lib/checkout-service");
let database, directory, admins, teams, adminCookie, teamCookie, teamId, requestCount = 0;

function request(action, payload = {}, cookie) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const response = { statusCode: 200, setHeader(name, value) { headers[name.toLowerCase()] = value; }, end(raw) {
      resolve({ status: this.statusCode, body: JSON.parse(raw), headers });
    } };
    handler({ method: "POST", headers: { host: "localhost", origin: "http://localhost", cookie }, query: {},
      body: { action, idempotencyKey: `account-test-${++requestCount}`, ...payload } }, response).catch(reject);
  });
}
async function login(account) {
  const result = await request("login", { username: account.username, password: account.password });
  assert.equal(result.status, 200);
  assert.equal(result.body.user.canChangeName, true);
  return result.headers["set-cookie"].split(";")[0];
}
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "makecu-account-test-"));
  database = await getDatabase();
  await provisionAdminAccounts(database, { credentialsPath: path.join(directory, "admins.json") });
  await provisionTeamAccounts(database, { credentialsPath: path.join(directory, "teams.json") });
  admins = JSON.parse(fs.readFileSync(path.join(directory, "admins.json"))).accounts;
  teams = JSON.parse(fs.readFileSync(path.join(directory, "teams.json"))).accounts;
  adminCookie = await login(admins[0]);
  teamCookie = await login(teams[0]);
  teamId = Number((await database.query("SELECT team_id FROM checkout_users WHERE username = 'team-1'")).rows[0].team_id);
});
after(async () => {
  await resetDatabaseForTests();
  // The test owns this exact temporary directory.
  fs.rmSync(directory, { recursive: true, force: true });
});

test("40 numbered teams have unique funny passwords, salted hashes, and four blank member slots", async () => {
  assert.equal(teams.length, 40);
  assert.equal(new Set(teams.map(account => account.password)).size, 40);
  for (const account of teams) {
    for (const word of ["makecu", "6767", "robot", "Columbia"]) assert.ok(account.password.includes(word));
    assert.match(account.password, /[!@#]/);
    const user = (await database.query("SELECT * FROM checkout_users WHERE username = $1", [account.username])).rows[0];
    assert.equal(await verifyPassword(account.password, user.password_hash), true);
  }
  const detail = (await request("team-detail", { teamId }, adminCookie)).body;
  assert.deepEqual(detail.team.memberNames, ["", "", "", ""]);
  assert.equal(detail.team.contactEmail, "");
  assert.equal(detail.team.profileVersion, 0);
  const list = (await request("teams", {}, adminCookie)).body.teams;
  assert.deepEqual(list.map(team => team.username), teams.map(team => team.username));
});

test("only admins edit roster/contact; fewer than four names are padded and updates are audited", async () => {
  const payload = { teamId, version: 0, memberNames: ["  Ada Lovelace  ", "Grace Hopper"], contactEmail: "team@example.edu" };
  assert.equal((await request("save-team-profile", payload)).status, 401);
  assert.equal((await request("save-team-profile", payload, teamCookie)).status, 403);
  assert.equal((await request("team-detail", { teamId }, teamCookie)).status, 403);
  assert.equal((await request("save-team-profile", payload, adminCookie)).status, 200);
  const detail = (await request("team-detail", { teamId }, adminCookie)).body;
  assert.deepEqual(detail.team.memberNames, ["Ada Lovelace", "Grace Hopper", "", ""]);
  assert.equal(detail.team.contactEmail, payload.contactEmail);
  assert.equal(detail.team.profileVersion, 1);
  assert.equal((await request("save-team-profile", payload, adminCookie)).status, 409);
  const activity = (await request("activity", {}, adminCookie)).body.activity;
  assert.ok(activity.some(item => item.message.includes("Ada Lovelace") && item.message.includes("team@example.edu")));
  assert.equal((await request("teams", { search: "Hopper" }, adminCookie)).body.teams.length, 1);
});

test("invalid roster or contact edits do not change data", async () => {
  for (const changes of [{ memberNames: ["a", "b", "c", "d", "e"] }, { memberNames: "a" }, { memberNames: [12] }, { memberNames: ["x".repeat(121)] }, { contactEmail: "bad email" }]) {
    const result = await request("save-team-profile", { teamId, version: 1, memberNames: [], contactEmail: "", ...changes }, adminCookie);
    assert.equal(result.status, 400);
  }
  const detail = (await request("team-detail", { teamId }, adminCookie)).body;
  assert.equal(detail.team.profileVersion, 1);
});

test("one-time team rename is idempotent, keeps the login and roster, and records old/new names", async () => {
  assert.equal((await request("change-account-name", { name: "   " }, teamCookie)).status, 400);
  assert.equal((await request("change-account-name", { name: "Team 1" }, teamCookie)).status, 400);
  const payload = { name: "Disco Robots", idempotencyKey: "one-name-change" };
  const result = await request("change-account-name", payload, teamCookie);
  assert.equal(result.status, 200);
  assert.equal(result.body.user.username, "team-1");
  assert.equal(result.body.user.teamName, "Disco Robots");
  assert.equal(result.body.user.canChangeName, false);
  assert.equal((await request("change-account-name", payload, teamCookie)).status, 200);
  assert.equal((await request("change-account-name", { name: "Another name" }, teamCookie)).status, 409);
  const me = (await request("me", {}, teamCookie)).body.user;
  assert.equal(me.canChangeName, false);
  assert.equal(me.teamName, "Disco Robots");
  const detail = (await request("team-detail", { teamId }, adminCookie)).body;
  assert.equal(detail.team.memberNames[0], "Ada Lovelace");
  const changes = (await request("activity", {}, adminCookie)).body.activity.filter(item => item.message.includes("Account @team-1 changed name"));
  assert.equal(changes.length, 1);
  assert.match(changes[0].message, /Team 1.*Disco Robots/);
});

test("racing name changes only succeed once and admins can rename themselves", async () => {
  const user = (await database.query("SELECT * FROM checkout_users WHERE username = 'admin-3'")).rows[0];
  const results = await Promise.allSettled([
    service.changeAccountName(database, { name: "First name" }, user),
    service.changeAccountName(database, { name: "Second name" }, user)
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.status, 409);
  const renamed = await request("change-account-name", { name: "Otavio Paz Test" }, adminCookie);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.user.canChangeName, false);
  assert.equal((await request("change-account-name", { name: "Third name" }, adminCookie)).status, 409);
});

test("re-provisioning keeps passwords, roster, chosen names, and the used rename allowance", async () => {
  const before = teams.map(account => account.password);
  await provisionTeamAccounts(database, { credentialsPath: path.join(directory, "teams.json") });
  const after = JSON.parse(fs.readFileSync(path.join(directory, "teams.json"))).accounts;
  assert.deepEqual(after.map(account => account.password), before);
  assert.equal(after[0].name, "Disco Robots");
  await assert.rejects(provisionTeamAccounts(database, { credentialsPath: path.join(directory, "missing.json") }), /Cannot reuse team-1/);
  const me = (await request("me", {}, teamCookie)).body.user;
  assert.equal(me.canChangeName, false);
});
