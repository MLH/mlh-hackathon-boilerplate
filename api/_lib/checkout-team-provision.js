const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createTeam } = require("./checkout-service");
const { verifyPassword } = require("./checkout-security");

const TEAM_ACCOUNTS = Array.from({ length: 40 }, (_, index) => ({
  username: `team-${index + 1}`, name: `Team ${index + 1}`, number: index + 1
}));
const FUNNY_WORDS = ["SpicyToaster", "DiscoPotato", "WobblyWaffle", "TurboNoodle", "SassyServo", "SleepySolder", "BananaBot", "DancingResistor", "GooseOnWheels", "SneakyPancake"];

function funnyPassword() {
  return `makecu!6767-${FUNNY_WORDS[crypto.randomInt(FUNNY_WORDS.length)]}_robot@Columbia#${crypto.randomBytes(12).toString("base64url")}`;
}

async function provisionTeamAccounts(database, options) {
  const credentialsPath = path.resolve(options.credentialsPath);
  const saved = fs.existsSync(credentialsPath) ? JSON.parse(fs.readFileSync(credentialsPath, "utf8")) : { accounts: [] };
  if (!Array.isArray(saved.accounts)) throw new Error("Invalid team credential file.");
  return database.transaction(async function (transaction) {
    const admin = await transaction.query("SELECT * FROM checkout_users WHERE username = 'admin-1' AND role = 'admin' AND active = TRUE");
    if (!admin.rows[0]) throw new Error("Provision admin-1 before provisioning teams.");
    const accounts = [];
    for (const account of TEAM_ACCOUNTS) {
      const existing = await transaction.query("SELECT * FROM checkout_users WHERE username = $1", [account.username]);
      const credential = saved.accounts.find(item => item.username === account.username);
      if (existing.rows.length) {
        const user = existing.rows[0];
        if (user.role !== "team" || !user.active || !credential || !await verifyPassword(credential.password, user.password_hash)) {
          throw new Error(`Cannot reuse ${account.username}: its role, active status, or saved credentials do not match. Existing passwords were preserved.`);
        }
        const team = await transaction.query("SELECT name, identifier FROM checkout_teams WHERE id = $1", [user.team_id]);
        if (team.rows[0].identifier !== account.username) throw new Error(`${account.username} belongs to a different team identifier.`);
        accounts.push(Object.assign({}, credential, { name: team.rows[0].name }));
        continue;
      }
      const password = funnyPassword();
      await createTeam(transaction, { name: account.name, identifier: account.username, username: account.username, password }, admin.rows[0]);
      accounts.push({ number: account.number, name: account.name, username: account.username, password });
    }
    fs.writeFileSync(credentialsPath, JSON.stringify({ generatedAt: saved.generatedAt || new Date().toISOString(), accounts }, null, 2) + "\n", { mode: 0o600 });
    return { credentialsPath, usernames: accounts.map(account => account.username) };
  });
}

module.exports = { TEAM_ACCOUNTS, funnyPassword, provisionTeamAccounts };
