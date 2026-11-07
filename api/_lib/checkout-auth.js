const {
  SESSION_COOKIE,
  hashToken,
  parseCookies,
  sessionCookie
} = require("./checkout-security");
const { httpError } = require("./checkout-validation");

const SESSION_SECONDS = 60 * 60 * 18;

async function sessionUser(database, request) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[SESSION_COOKIE];

  if (!token) {
    return null;
  }

  const result = await database.query(
    `SELECT users.id, users.username, users.role, users.team_id, users.display_name, users.name_change_count,
            teams.name AS team_name
       FROM checkout_sessions sessions
       JOIN checkout_users users ON users.id = sessions.user_id
       LEFT JOIN checkout_teams teams ON teams.id = users.team_id
      WHERE sessions.token_hash = $1
        AND sessions.expires_at > NOW()
        AND users.active = TRUE`,
    [hashToken(token)]
  );

  return result.rows[0] || null;
}

function requireUser(user, role) {
  if (!user) {
    throw httpError(401, "Please sign in to continue.");
  }

  if (role && user.role !== role) {
    throw httpError(403, "You do not have permission to perform this action.");
  }

  return user;
}

async function createSession(database, response, userId) {
  const { newSessionToken } = require("./checkout-security");
  const token = newSessionToken();
  const tokenHash = hashToken(token);

  await database.query(
    `INSERT INTO checkout_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '18 hours')`,
    [tokenHash, userId]
  );
  response.setHeader("Set-Cookie", sessionCookie(token, SESSION_SECONDS));
}

async function destroySession(database, request, response) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[SESSION_COOKIE];

  if (token) {
    await database.query("DELETE FROM checkout_sessions WHERE token_hash = $1", [hashToken(token)]);
  }

  response.setHeader("Set-Cookie", sessionCookie("", 0));
}

module.exports = { sessionUser, requireUser, createSession, destroySession };
