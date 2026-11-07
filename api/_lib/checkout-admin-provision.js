const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { hashPassword, verifyPassword } = require("./checkout-security");

const ADMIN_ACCOUNTS = [
  { username: "admin-1", displayName: "Otavio Paz" },
  { username: "admin-2", displayName: "Alice" },
  { username: "admin-3", displayName: "Nehal" },
  { username: "admin-4", displayName: "Sarrah" },
  ...Array.from({ length: 11 }, (_, index) => ({ username: `admin-${index + 5}`, displayName: `Admin ${index + 5}` }))
];

function randomPassword() {
  return crypto.randomBytes(24).toString("base64url");
}

function readCredentialFile(credentialsPath) {
  if (!fs.existsSync(credentialsPath)) {
    return null;
  }

  const value = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  if (!value || !Array.isArray(value.accounts)) {
    throw new Error("The local admin credential file is not valid JSON in the expected format.");
  }
  return value;
}

async function provisionAdminAccounts(database, options) {
  return database.transaction(function (transaction) {
    return provisionAdminAccountsInTransaction(transaction, options);
  });
}

async function provisionAdminAccountsInTransaction(database, options) {
  const settings = options || {};
  const credentialsPath = path.resolve(settings.credentialsPath || "checkout-admin-credentials.local.json");
  const rotate = settings.rotate === true;
  const existingFile = readCredentialFile(credentialsPath);
  const existingRows = await database.query(
    "SELECT username, role, display_name, password_hash FROM checkout_users WHERE username = ANY($1)",
    [ADMIN_ACCOUNTS.map(function (account) { return account.username; })]
  );
  const conflictingUsers = existingRows.rows.filter(function (row) { return row.role !== "admin"; });
  if (conflictingUsers.length) {
    throw new Error(`Cannot provision admin accounts because ${conflictingUsers.map(function (row) { return row.username; }).join(", ")} already belongs to a team. Rename that team login first.`);
  }
  const existingUsers = new Set(existingRows.rows.map(function (row) { return row.username; }));
  const savedCredentials = new Map((existingFile ? existingFile.accounts : []).map(function (account) {
    return [account.username, account];
  }));

  if (!rotate) {
    const unrecoverable = ADMIN_ACCOUNTS.filter(function (account) {
      return existingUsers.has(account.username) && !savedCredentials.has(account.username);
    });

    if (unrecoverable.length) {
      throw new Error(`Credentials for ${unrecoverable.map(function (account) { return account.username; }).join(", ")} already exist in the database but are not in the local credential file. Re-run with --rotate to replace all 15 passwords.`);
    }
    for (const user of existingRows.rows) {
      const saved = savedCredentials.get(user.username);
      if (!await verifyPassword(saved.password, user.password_hash)) {
        throw new Error(`The saved password for ${user.username} does not match the database. Existing passwords were preserved.`);
      }
    }
  }

  const credentials = [];
  for (const account of ADMIN_ACCOUNTS) {
    const saved = !rotate && savedCredentials.get(account.username);
    if (saved && existingUsers.has(account.username)) {
      const updated = await database.query(
        `UPDATE checkout_users
            SET role = 'admin', display_name = CASE WHEN name_change_count = 0 THEN $2 ELSE display_name END, team_id = NULL, active = TRUE
          WHERE username = $1 RETURNING display_name`,
        [account.username, account.displayName]
      );
      credentials.push(Object.assign({}, saved, { displayName: updated.rows[0].display_name }));
      const before = existingRows.rows.find(function (row) { return row.username === account.username; });
      if (before.display_name !== updated.rows[0].display_name) {
        await database.query("INSERT INTO checkout_activity (message) VALUES ($1)",
          [`Provisioning updated @${account.username} from "${before.display_name}" to "${updated.rows[0].display_name}".`]);
      }
      continue;
    }

    const password = randomPassword();
    const passwordHash = await hashPassword(password);
    const created = await database.query(
      `INSERT INTO checkout_users (username, password_hash, role, display_name, team_id, active)
       VALUES ($1, $2, 'admin', $3, NULL, TRUE)
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             role = 'admin',
             display_name = CASE WHEN checkout_users.name_change_count = 0 THEN EXCLUDED.display_name ELSE checkout_users.display_name END,
             team_id = NULL,
             active = TRUE RETURNING id, display_name`,
      [account.username, passwordHash, account.displayName]
    );
    credentials.push({
      username: account.username,
      password,
      displayName: created.rows[0].display_name
    });
    if (rotate) await database.query("DELETE FROM checkout_sessions WHERE user_id = $1", [created.rows[0].id]);
    await database.query("INSERT INTO checkout_activity (message) VALUES ($1)",
      [`${existingUsers.has(account.username) ? "Rotated credentials for" : "Provisioned"} admin account @${account.username} (${created.rows[0].display_name}).`]);
  }

  await database.query(
    "UPDATE checkout_users SET active = FALSE WHERE username = 'admin' AND role = 'admin'"
  );

  const output = {
    generatedAt: existingFile && !rotate ? existingFile.generatedAt : new Date().toISOString(),
    warning: "Local secret file. Do not commit, publish, email, or share broadly. Rotate a password if it is exposed.",
    accounts: credentials
  };
  fs.writeFileSync(credentialsPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  return {
    credentialsPath,
    usernames: ADMIN_ACCOUNTS.map(function (account) { return account.username; }),
    rotated: rotate
  };
}

module.exports = { ADMIN_ACCOUNTS, provisionAdminAccounts, randomPassword };
