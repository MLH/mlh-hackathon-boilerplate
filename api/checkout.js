const crypto = require("node:crypto");
const { getDatabase } = require("./_lib/checkout-db");
const { sessionUser, requireUser, createSession, destroySession } = require("./_lib/checkout-auth");
const { liveStatus } = require("./_lib/checkout-live");
const { verifyPassword } = require("./_lib/checkout-security");
const { cleanString, httpError } = require("./_lib/checkout-validation");
const service = require("./_lib/checkout-service");
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_FAILED_LOGINS = 10;
const DUMMY_PASSWORD_HASH = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }

  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce(function (result, key) {
      if (key !== "action" && key !== "idempotencyKey") {
        result[key] = canonicalJson(value[key]);
      }
      return result;
    }, {});
  }

  return value;
}

async function runIdempotent(database, actor, action, body, operation) {
  const key = cleanString(body.idempotencyKey, "Idempotency key", { max: 160 });
  const requestHash = crypto.createHash("sha256").update(JSON.stringify(canonicalJson(body))).digest("hex");

  return database.transaction(async function (transaction) {
    const inserted = await transaction.query(
      `INSERT INTO checkout_idempotency_requests (actor_user_id, action, idempotency_key, request_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (actor_user_id, action, idempotency_key) DO NOTHING
       RETURNING actor_user_id`,
      [actor.id, action, key, requestHash]
    );
    const existing = await transaction.query(
      `SELECT request_hash, response_json FROM checkout_idempotency_requests
        WHERE actor_user_id = $1 AND action = $2 AND idempotency_key = $3
        FOR UPDATE`,
      [actor.id, action, key]
    );
    const existingRow = existing.rows[0];
    const stored = existingRow && existingRow.response_json;

    if (!existingRow) {
      throw new Error("The idempotency record could not be loaded.");
    }

    if (!inserted.rows.length && existingRow.request_hash && existingRow.request_hash !== requestHash) {
      throw httpError(409, "This idempotency key was already used for a different request.");
    }

    if (!inserted.rows.length && stored != null) {
      return typeof stored === "string" ? JSON.parse(stored) : stored;
    }

    const result = await operation(transaction);

    await transaction.query(
      `UPDATE checkout_idempotency_requests SET response_json = $4
        WHERE actor_user_id = $1 AND action = $2 AND idempotency_key = $3`,
      [actor.id, action, key, JSON.stringify(result)]
    );
    return result;
  });
}

function send(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(payload));
}

function publicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: Number(user.id),
    username: user.username,
    role: user.role,
    teamId: user.team_id == null ? null : Number(user.team_id),
    teamName: user.team_name,
    displayName: user.display_name,
    canChangeName: Number(user.name_change_count || 0) === 0
  };
}

function validateRequestOrigin(request) {
  if (request.method === "GET") {
    return;
  }

  const origin = request.headers.origin;
  const host = request.headers.host;
  const fetchSite = request.headers["sec-fetch-site"];

  if (fetchSite === "cross-site") {
    throw httpError(403, "Cross-site requests are not allowed.");
  }

  if (origin && host) {
    let parsed;

    try {
      parsed = new URL(origin);
    } catch (error) {
      throw httpError(403, "Cross-site requests are not allowed.");
    }

    if (!/^https?:$/.test(parsed.protocol) || parsed.host !== host) {
      throw httpError(403, "Cross-site requests are not allowed.");
    }
  }
}

async function bodyOf(request) {
  const declaredLength = Number(request.headers["content-length"] || 0);

  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw httpError(413, "The request is too large.");
  }

  if (request.body && typeof request.body === "object") {
    if (Buffer.byteLength(JSON.stringify(request.body), "utf8") > MAX_REQUEST_BYTES) {
      throw httpError(413, "The request is too large.");
    }
    return request.body;
  }

  if (typeof request.body === "string") {
    if (Buffer.byteLength(request.body, "utf8") > MAX_REQUEST_BYTES) {
      throw httpError(413, "The request is too large.");
    }
    return request.body ? JSON.parse(request.body) : {};
  }

  const chunks = [];
  let bytes = 0;

  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) {
      throw httpError(413, "The request is too large.");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function clientAddress(request) {
  const forwarded = request.headers["x-forwarded-for"];
  const value = request.headers["x-real-ip"] ||
    (Array.isArray(forwarded) ? forwarded[0] : String(forwarded || "").split(",")[0]) ||
    request.socket && request.socket.remoteAddress || "unknown";
  return String(value).trim().slice(0, 120) || "unknown";
}

async function handler(request, response) {
  try {
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (request.method !== "GET" && request.method !== "POST") {
      send(response, 405, { error: "Method not allowed." });
      return;
    }

    validateRequestOrigin(request);
    const body = request.method === "POST" ? await bodyOf(request) : {};
    const action = body.action || request.query && request.query.action || "status";
    const status = liveStatus();

    if (action === "status") {
      send(response, 200, { status });
      return;
    }

    const database = await getDatabase();

    if (action === "login") {
      const username = cleanString(body.username, "Username", { max: 80 }).toLowerCase();
      const password = cleanString(body.password, "Password", { max: 200 });
      const address = clientAddress(request);
      const failedAttempts = await database.query(
        `SELECT COUNT(*) AS address_count,
                COUNT(*) FILTER (WHERE username = $1) AS username_count
           FROM checkout_login_attempts
          WHERE client_address = $2 AND succeeded = FALSE
            AND attempted_at > NOW() - INTERVAL '15 minutes'`,
        [username, address]
      );

      if (Number(failedAttempts.rows[0].username_count) >= MAX_FAILED_LOGINS ||
          Number(failedAttempts.rows[0].address_count) >= 50) {
        throw httpError(429, "Too many sign-in attempts. Try again in 15 minutes.");
      }

      const result = await database.query(
        `SELECT users.*, teams.name AS team_name
           FROM checkout_users users
           LEFT JOIN checkout_teams teams ON teams.id = users.team_id
          WHERE users.username = $1 AND users.active = TRUE`,
        [username]
      );
      const user = result.rows[0];
      const passwordMatches = await verifyPassword(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);

      if (!user || !passwordMatches) {
        await database.query(
          `INSERT INTO checkout_login_attempts (username, client_address, succeeded)
           VALUES ($1, $2, FALSE)`,
          [username, address]
        );
        throw httpError(401, "The username or password is incorrect.");
      }

      if (!status.live && user.role !== "admin") {
        throw httpError(423, "Team checkout is available only while the MakeCU hackathon is live.", { status });
      }

      await database.query(
        `INSERT INTO checkout_login_attempts (username, client_address, succeeded)
         VALUES ($1, $2, TRUE)`,
        [username, address]
      );
      await database.query(
        `DELETE FROM checkout_login_attempts
          WHERE attempted_at < NOW() - INTERVAL '24 hours'
             OR (username = $1 AND client_address = $2 AND succeeded = FALSE)`,
        [username, address]
      );
      await createSession(database, response, user.id);
      send(response, 200, { user: publicUser(user) });
      return;
    }

    if (action === "logout") {
      await destroySession(database, request, response);
      send(response, 200, { loggedOut: true });
      return;
    }

    const user = await sessionUser(database, request);

    if (action === "me") {
      send(response, 200, { user: publicUser(requireUser(user)) });
      return;
    }

    if (action === "change-account-name") {
      const current = requireUser(user);
      const result = await runIdempotent(database, current, action, body, async function (transaction) {
        return { user: publicUser(await service.changeAccountName(transaction, body, current)) };
      });
      send(response, 200, result);
      return;
    }

    if (!status.live && (!user || user.role !== "admin")) {
      throw httpError(423, "Hardware checkout is available only while the MakeCU hackathon is live. Organizers may sign in with an admin account.", { status });
    }

    if (action === "submit-order" && !status.orderingOpen) {
      throw httpError(423, "New hardware orders are closed. Volunteers can still process returns.", { status });
    }

    if ((action === "process-return" || action === "correct-return") && !status.returnsOpen &&
        (!user || user.role !== "admin")) {
      throw httpError(423, "The hardware return period is closed.", { status });
    }

    if (action === "catalog") {
      requireUser(user);
      send(response, 200, { components: await service.catalog(database, user, user.role === "admin") });
      return;
    }

    if (action === "team-dashboard") {
      send(response, 200, await service.teamDashboard(database, requireUser(user, "team")));
      return;
    }

    if (action === "cart-advice") {
      const team = requireUser(user, "team");
      send(response, 200, { advice: await service.cartAdvice(database, team, body.items) });
      return;
    }

    if (action === "submit-order") {
      const team = requireUser(user, "team");
      const result = await runIdempotent(database, team, action, body, async function (transaction) {
        return { order: await service.submitOrder(transaction, body, team) };
      });
      send(response, 201, result);
      return;
    }

    if (action === "order") {
      const current = requireUser(user);
      const teamId = current.role === "team" ? current.team_id : null;
      send(response, 200, { order: await service.orderDetails(database, body.orderId, teamId) });
      return;
    }

    const admin = requireUser(user, "admin");
    const mutate = function (operation) {
      return runIdempotent(database, admin, action, body, operation);
    };

    if (action === "admin-overview") {
      send(response, 200, await service.adminOverview(database));
    } else if (action === "admin-orders") {
      send(response, 200, { orders: await service.adminOrders(database) });
    } else if (action === "claim-order") {
      send(response, 200, await mutate(async function (transaction) {
        return { order: await service.claimOrder(transaction, body, admin) };
      }));
    } else if (action === "release-claim") {
      send(response, 200, await mutate(async function (transaction) {
        return { order: await service.releaseClaim(transaction, body, admin) };
      }));
    } else if (action === "adjust-order") {
      send(response, 200, await mutate(async function (transaction) {
        return { order: await service.adjustOrder(transaction, body, admin) };
      }));
    } else if (action === "accept-order") {
      send(response, 200, await mutate(async function (transaction) {
        return { order: await service.transitionOrder(transaction, body, admin, "accept") };
      }));
    } else if (action === "mark-ready") {
      send(response, 200, await mutate(async function (transaction) {
        return { order: await service.transitionOrder(transaction, body, admin, "ready") };
      }));
    } else if (action === "confirm-pickup") {
      send(response, 200, await mutate(async function (transaction) {
        return { order: await service.transitionOrder(transaction, body, admin, "pickup") };
      }));
    } else if (action === "cancel-order") {
      send(response, 200, await mutate(async function (transaction) {
        return { order: await service.transitionOrder(transaction, body, admin, "cancel") };
      }));
    } else if (action === "teams") {
      send(response, 200, { teams: await service.teamsList(database, body.search) });
    } else if (action === "team-detail") {
      send(response, 200, await service.teamAdminDetail(database, body.teamId));
    } else if (action === "create-team") {
      send(response, 201, await mutate(function (transaction) {
        return service.createTeam(transaction, body, admin);
      }));
    } else if (action === "reset-team-password") {
      send(response, 200, await mutate(function (transaction) {
        return service.resetTeamPassword(transaction, body, admin);
      }));
    } else if (action === "save-team-profile") {
      send(response, 200, await mutate(function (transaction) {
        return service.saveTeamProfile(transaction, body, admin);
      }));
    } else if (action === "grant-order-timeout-exception") {
      send(response, 201, await mutate(function (transaction) {
        return service.grantOrderCooldownOverride(transaction, body, admin);
      }));
    } else if (action === "process-return") {
      send(response, 201, await mutate(function (transaction) {
        return service.processReturn(transaction, body, admin);
      }));
    } else if (action === "correct-return") {
      send(response, 201, await mutate(function (transaction) {
        return service.correctReturn(transaction, body, admin);
      }));
    } else if (action === "create-protected-stock-order") {
      send(response, 201, await mutate(async function (transaction) {
        return { order: await service.createProtectedStockOverrideOrder(transaction, body, admin) };
      }));
    } else if (action === "save-component") {
      send(response, body.id ? 200 : 201, await mutate(async function (transaction) {
        return { component: await service.saveComponent(transaction, body, admin) };
      }));
    } else if (action === "activity") {
      send(response, 200, { activity: await service.activity(database) });
    } else if (action === "activity-receipt") {
      send(response, 200, await service.activityReceipt(database, body.activityId));
    } else if (action === "discrepancy-report") {
      send(response, 200, await service.discrepancyReport(database));
    } else {
      throw httpError(404, "Unknown checkout action.");
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      send(response, 400, { error: "Request body must be valid JSON." });
      return;
    }

    const status = error.status || 500;

    if (status >= 500) {
      console.error(error);
    }

    send(response, status, {
      error: status >= 500 ? "The checkout system could not complete that action." : error.message,
      details: error.details
    });
  }
}

module.exports = handler;
