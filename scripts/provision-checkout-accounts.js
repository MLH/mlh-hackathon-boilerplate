const fs = require("node:fs");
const path = require("node:path");
const { getDatabase } = require("../api/_lib/checkout-db");
const { provisionAdminAccounts } = require("../api/_lib/checkout-admin-provision");
const { provisionTeamAccounts } = require("../api/_lib/checkout-team-provision");

async function main() {
  if (!process.env.DATABASE_URL && !process.env.CHECKOUT_PGLITE_PATH) throw new Error("Set DATABASE_URL or a persistent CHECKOUT_PGLITE_PATH before creating accounts.");
  const scope = process.env.DATABASE_URL ? ".production" : "";
  const privateDirectory = path.resolve(".checkout-secrets");
  fs.mkdirSync(privateDirectory, { recursive: true });
  const adminPath = path.resolve(process.env.CHECKOUT_ADMIN_CREDENTIALS_FILE || `checkout-admin-credentials${scope}.local.json`);
  const teamPath = path.resolve(process.env.CHECKOUT_TEAM_CREDENTIALS_FILE || path.join(privateDirectory, `checkout-team-credentials${scope}.local.json`));
  const handoffPath = path.join(privateDirectory, `checkout-account-credentials${scope}.local.md`);
  const database = await getDatabase();
  try {
    await provisionAdminAccounts(database, { credentialsPath: adminPath });
    await provisionTeamAccounts(database, { credentialsPath: teamPath });
    const admins = JSON.parse(fs.readFileSync(adminPath, "utf8")).accounts;
    const teams = JSON.parse(fs.readFileSync(teamPath, "utf8")).accounts;
    const lines = ["# MakeCU account credentials", "", `Created for the ${scope ? "production PostgreSQL" : "local development"} database. Keep this file private.`, "", "Login usernames stay fixed. Each account may change its display name once, recorded in Activity. Member names and contact emails are edited only by admins in Teams / Returns.", "", "## Teams", "", "| Team | Username | Password |", "| --- | --- | --- |"];
    teams.forEach(account => lines.push(`| ${account.name.replace(/\|/g, "\\|")} | ${account.username} | \`${account.password}\` |`));
    lines.push("", "## Administrators", "", "| Name | Username | Password |", "| --- | --- | --- |");
    admins.forEach(account => lines.push(`| ${account.displayName.replace(/\|/g, "\\|")} | ${account.username} | \`${account.password}\` |`));
    fs.writeFileSync(handoffPath, lines.join("\n") + "\n", { mode: 0o600 });
    const counts = await database.query("SELECT role, COUNT(*)::INTEGER AS count FROM checkout_users WHERE active = TRUE GROUP BY role");
    process.stdout.write(JSON.stringify({ accounts: counts.rows, credentialsPath: handoffPath }) + "\n");
  } finally { await database.close(); }
}

main().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
