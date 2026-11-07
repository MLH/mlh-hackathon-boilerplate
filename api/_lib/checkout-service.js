const { hashPassword } = require("./checkout-security");
const { componentInput, cleanString, httpError, positiveInteger, relationshipInput, returnInput } = require("./checkout-validation");
const {
  MAX_DISTINCT_ORDER_ITEMS,
  ORDER_COOLDOWN_MINUTES,
  ORDER_EXPIRATION_MINUTES
} = require("./checkout-constants");

function relationshipView(row) {
  return {
    id: Number(row.id),
    sourceComponentId: Number(row.source_component_id),
    targetComponentId: Number(row.target_component_id),
    targetName: row.target_name,
    relationType: row.relation_type,
    quantityRatio: Number(row.quantity_ratio),
    minimumSourceQuantity: Number(row.minimum_source_quantity),
    message: row.message
  };
}

function componentView(row, relationships) {
  const total = Number(row.total_quantity);
  const mlh = Number(row.mlh_quantity || 0);
  const reserved = Number(row.reserved_quantity);
  const checkedOut = Number(row.checked_out_quantity);
  const unavailable = Number(row.unavailable_quantity);
  const curcTotal = total - mlh;
  const available = curcTotal - reserved - checkedOut - unavailable;

  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    imageAlt: row.image_alt,
    category: row.category,
    compatibility: row.compatibility,
    arduinoGuidance: row.arduino_guidance || "",
    raspberryPiGuidance: row.raspberry_pi_guidance || "",
    binLocation: row.bin_location,
    technicalSpecs: row.technical_specs,
    totalQuantity: total,
    mlhQuantity: mlh,
    curcTotalQuantity: curcTotal,
    mlhManaged: mlh > 0,
    mlhOnly: mlh > 0 && curcTotal === 0,
    reservedQuantity: reserved,
    checkedOutQuantity: checkedOut,
    unavailableQuantity: unavailable,
    availableQuantity: available,
    teamAvailableQuantity: Math.max(0, available - Number(row.protected_stock || 0)),
    protectedStock: Number(row.protected_stock || 0),
    maxActivePerTeam: row.max_active_per_team == null ? null : Number(row.max_active_per_team),
    teamActiveQuantity: Number(row.team_active_quantity || 0),
    active: row.active,
    adminNotes: row.admin_notes,
    version: Number(row.version || 1),
    updatedAt: row.updated_at,
    relationships: relationships || []
  };
}

async function relationshipsFor(database, componentIds) {
  const grouped = new Map();

  if (!componentIds.length) {
    return grouped;
  }

  const result = await database.query(
    `SELECT relationships.*, targets.name AS target_name
       FROM checkout_component_relationships relationships
       JOIN checkout_components targets ON targets.id = relationships.target_component_id
      WHERE relationships.source_component_id = ANY($1::bigint[])
      ORDER BY relationships.source_component_id, relationships.id`,
    [componentIds]
  );

  result.rows.forEach(function (row) {
    const sourceId = Number(row.source_component_id);

    if (!grouped.has(sourceId)) {
      grouped.set(sourceId, []);
    }

    grouped.get(sourceId).push(relationshipView(row));
  });
  return grouped;
}

async function componentsView(database, rows) {
  const grouped = await relationshipsFor(database, rows.map(function (row) { return Number(row.id); }));
  return rows.map(function (row) {
    return componentView(row, grouped.get(Number(row.id)) || []);
  });
}

function orderView(row, items) {
  return {
    id: Number(row.id),
    receiptCode: row.receipt_code || `O-${String(row.id).padStart(5, "0")}`,
    teamId: Number(row.team_id),
    teamName: row.team_name,
    status: row.status,
    reviewedBy: row.reviewed_by == null ? null : Number(row.reviewed_by),
    reviewerName: row.reviewer_name,
    createdAt: row.created_at,
    reviewingAt: row.reviewing_at,
    claimExpiresAt: row.claim_expires_at,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by == null ? null : Number(row.accepted_by),
    acceptedByName: row.accepted_by_name,
    readyAt: row.ready_at,
    readyByName: row.ready_by_name,
    pickedUpAt: row.picked_up_at,
    pickedUpByName: row.picked_up_by_name,
    cancelledAt: row.cancelled_at,
    cancelledByName: row.cancelled_by_name,
    cancellationNote: row.cancellation_note,
    expiredAt: row.expired_at,
    reservationExpiresAt: row.reservation_expires_at,
    protectedStockOverrideBy: row.protected_stock_override_by == null ? null : Number(row.protected_stock_override_by),
    protectedStockOverrideReason: row.protected_stock_override_reason || "",
    protectedStockOverrideAt: row.protected_stock_override_at,
    events: row.events || [],
    items: items || []
  };
}

function itemView(row) {
  return {
    id: Number(row.id),
    componentId: Number(row.component_id),
    name: row.component_name_snapshot || row.name,
    imageUrl: row.component_image_url_snapshot || row.image_url,
    imageAlt: row.component_image_alt_snapshot || row.image_alt,
    category: row.component_category_snapshot || row.category,
    binLocation: row.bin_location || "",
    requestedQuantity: Number(row.requested_quantity),
    approvedQuantity: Number(row.approved_quantity),
    adjustmentReason: row.adjustment_reason,
    note: row.note
  };
}

async function orderItems(database, orderIds) {
  if (!orderIds.length) {
    return new Map();
  }

  const result = await database.query(
    `SELECT items.*, components.name, components.image_url, components.image_alt,
            components.category, components.bin_location
       FROM checkout_order_items items
       JOIN checkout_components components ON components.id = items.component_id
      WHERE items.order_id = ANY($1::bigint[])
      ORDER BY items.id`,
    [orderIds]
  );
  const grouped = new Map();

  result.rows.forEach(function (row) {
    const orderId = Number(row.order_id);

    if (!grouped.has(orderId)) {
      grouped.set(orderId, []);
    }

    grouped.get(orderId).push(itemView(row));
  });

  return grouped;
}

async function recordOrderEvent(database, orderId, actorId, eventType, details) {
  await database.query(
    `INSERT INTO checkout_order_events (order_id, actor_user_id, event_type, details)
     VALUES ($1, $2, $3, $4)`,
    [orderId, actorId || null, eventType, JSON.stringify(details || {})]
  );
}

async function expireOrders(database) {
  return database.transaction(async function (transaction) {
    const result = await transaction.query(
      `SELECT * FROM checkout_orders
        WHERE status IN ('submitted', 'reviewing', 'accepted', 'ready')
          AND reservation_expires_at IS NOT NULL
          AND reservation_expires_at <= NOW()
          AND (status <> 'reviewing' OR claim_expires_at IS NULL OR claim_expires_at <= NOW())
        ORDER BY id
        FOR UPDATE SKIP LOCKED`
    );

    for (const order of result.rows) {
      const items = await transaction.query(
        "SELECT * FROM checkout_order_items WHERE order_id = $1 ORDER BY component_id FOR UPDATE",
        [order.id]
      );

      for (const item of items.rows) {
        const quantity = Number(item.approved_quantity);

        if (!quantity) {
          continue;
        }

        await transaction.query(
          `UPDATE checkout_components
              SET reserved_quantity = reserved_quantity - $2, updated_at = NOW()
            WHERE id = $1`,
          [item.component_id, quantity]
        );
        await transaction.query(
          `INSERT INTO checkout_inventory_transactions
            (component_id, team_id, order_id, transaction_type, quantity, note)
           VALUES ($1, $2, $3, 'ORDER_EXPIRED', $4, 'Reservation expired automatically')`,
          [item.component_id, order.team_id, order.id, -quantity]
        );
      }

      await transaction.query(
        `UPDATE checkout_orders
            SET status = 'expired', expired_at = NOW(), claim_expires_at = NULL
          WHERE id = $1`,
        [order.id]
      );
      await recordOrderEvent(transaction, order.id, null, "ORDER_EXPIRED", {});
      await transaction.query(
        `INSERT INTO checkout_activity (team_id, order_id, message)
         VALUES ($1, $2, $3)`,
        [order.team_id, order.id, `Order ${order.receipt_code || `#${order.id}`} expired and its reservation was released.`]
      );
    }

    return result.rowCount;
  });
}

async function catalog(database, user, includeInactive) {
  await expireOrders(database);
  const teamId = user && user.role === "team" ? user.team_id : null;
  const result = await database.query(
    `SELECT components.*,
            COALESCE(inventory.checked_out_quantity, 0) +
            COALESCE(reservations.quantity, 0) AS team_active_quantity
       FROM checkout_components components
       LEFT JOIN checkout_team_inventory inventory
         ON inventory.component_id = components.id AND inventory.team_id = $1
       LEFT JOIN (
         SELECT items.component_id, SUM(items.approved_quantity) AS quantity
           FROM checkout_order_items items
           JOIN checkout_orders orders ON orders.id = items.order_id
          WHERE orders.team_id = $1
            AND orders.status IN ('submitted', 'reviewing', 'accepted', 'ready')
          GROUP BY items.component_id
       ) reservations ON reservations.component_id = components.id
      WHERE ($2::boolean = TRUE OR components.active = TRUE)
      ORDER BY components.category, components.name`,
    [teamId, Boolean(includeInactive)]
  );

  return componentsView(database, result.rows);
}

function normalizedOrderItems(rawItems) {
  if (!Array.isArray(rawItems)) {
    throw httpError(400, "Order items must be provided as a list.");
  }

  if (rawItems.length > 50) {
    throw httpError(400, `An order may contain at most ${MAX_DISTINCT_ORDER_ITEMS} different items.`);
  }

  const normalized = new Map();

  rawItems.forEach(function (item) {
    const componentId = positiveInteger(item.componentId, "Component ID");
    const quantity = positiveInteger(item.quantity, "Requested quantity");
    normalized.set(componentId, (normalized.get(componentId) || 0) + quantity);
  });

  if (normalized.size > MAX_DISTINCT_ORDER_ITEMS) {
    throw httpError(400, `An order may contain at most ${MAX_DISTINCT_ORDER_ITEMS} different items.`);
  }

  return normalized;
}

async function cartAdvice(database, actor, rawItems) {
  const cart = normalizedOrderItems(rawItems);

  if (!cart.size) {
    return [];
  }

  const sourceIds = Array.from(cart.keys());
  const relationshipsResult = await database.query(
    `SELECT relationships.*, sources.name AS source_name, sources.category AS source_category,
            targets.name AS target_name, targets.category AS target_category,
            targets.active AS target_active, targets.total_quantity, targets.reserved_quantity,
            targets.checked_out_quantity, targets.unavailable_quantity, targets.protected_stock,
            targets.mlh_quantity,
            targets.max_active_per_team
       FROM checkout_component_relationships relationships
       JOIN checkout_components sources ON sources.id = relationships.source_component_id
       JOIN checkout_components targets ON targets.id = relationships.target_component_id
      WHERE relationships.source_component_id = ANY($1::bigint[])
      ORDER BY relationships.source_component_id, relationships.id`,
    [sourceIds]
  );

  if (!relationshipsResult.rows.length) {
    return [];
  }

  const relatedIds = new Set(sourceIds);
  relationshipsResult.rows.forEach(function (row) { relatedIds.add(Number(row.target_component_id)); });
  const activeResult = await database.query(
    `SELECT components.id,
            COALESCE(inventory.checked_out_quantity, 0) + COALESCE(reservations.quantity, 0) AS active_quantity
       FROM checkout_components components
       LEFT JOIN checkout_team_inventory inventory
         ON inventory.component_id = components.id AND inventory.team_id = $1
       LEFT JOIN (
         SELECT items.component_id, SUM(items.approved_quantity) AS quantity
           FROM checkout_order_items items
           JOIN checkout_orders orders ON orders.id = items.order_id
          WHERE orders.team_id = $1 AND orders.status IN ('submitted', 'reviewing', 'accepted', 'ready')
          GROUP BY items.component_id
       ) reservations ON reservations.component_id = components.id
      WHERE components.id = ANY($2::bigint[])`,
    [actor.team_id, Array.from(relatedIds)]
  );
  const active = new Map(activeResult.rows.map(function (row) {
    return [Number(row.id), Number(row.active_quantity)];
  }));

  return relationshipsResult.rows.map(function (row) {
    const sourceId = Number(row.source_component_id);
    const targetId = Number(row.target_component_id);
    const sourceQuantity = (active.get(sourceId) || 0) + (cart.get(sourceId) || 0);
    const targetQuantity = (active.get(targetId) || 0) + (cart.get(targetId) || 0);
    const threshold = Number(row.minimum_source_quantity);

    if (sourceQuantity < threshold) {
      return null;
    }

    const requiredQuantity = Math.ceil(sourceQuantity / Number(row.quantity_ratio));
    const missingQuantity = Math.max(0, requiredQuantity - targetQuantity);

    if (!missingQuantity) {
      return null;
    }

    const teamAvailable = Math.max(0, Number(row.total_quantity) - Number(row.mlh_quantity || 0) -
      Number(row.reserved_quantity) - Number(row.checked_out_quantity) -
      Number(row.unavailable_quantity) - Number(row.protected_stock));
    const teamLimitRemaining = row.max_active_per_team == null
      ? teamAvailable
      : Math.max(0, Number(row.max_active_per_team) - targetQuantity);
    const mlhManaged = Number(row.mlh_quantity || 0) > 0;
    const motorDriverWarning = row.relation_type === "compatible_driver" ||
      (row.source_category === "Motor" && /driver/i.test(row.target_name));
    const severity = mlhManaged
      ? "warning"
      : row.relation_type === "requires" && !motorDriverWarning
      ? "required"
      : motorDriverWarning
      ? "warning"
      : row.relation_type === "compatible_power_supply" ? "warning" : "recommendation";
    const fallback = severity === "required"
      ? `${row.source_name} requires ${row.target_name}.`
      : `${row.target_name} is recommended with ${row.source_name}.`;

    return {
      sourceComponentId: sourceId,
      sourceName: row.source_name,
      targetComponentId: targetId,
      targetName: row.target_name,
      relationType: row.relation_type,
      severity,
      requiredQuantity,
      currentQuantity: targetQuantity,
      missingQuantity,
      canAddQuantity: mlhManaged || !row.target_active ? 0 : Math.min(missingQuantity, teamAvailable, teamLimitRemaining),
      mlhQuantity: Number(row.mlh_quantity || 0),
      message: mlhManaged
        ? `${row.message || fallback} Pick it up at the MLH desk; its quantity is not updated by CURC.`
        : row.message || fallback
    };
  }).filter(Boolean);
}

async function createTeam(database, body, actor) {
  const name = cleanString(body.name, "Team name", { max: 120 });
  const identifier = cleanString(body.identifier, "Team identifier", { max: 80 }).toLowerCase();
  const username = cleanString(body.username || identifier, "Username", { max: 80 }).toLowerCase();
  const password = cleanString(body.password, "Password", { max: 200 });

  if (password.length < 8) {
    throw httpError(400, "Team passwords must be at least 8 characters.");
  }

  try {
    return await database.transaction(async function (transaction) {
      const teamResult = await transaction.query(
        "INSERT INTO checkout_teams (name, identifier) VALUES ($1, $2) RETURNING *",
        [name, identifier]
      );
      const team = teamResult.rows[0];
      const passwordHash = await hashPassword(password);
      const userResult = await transaction.query(
        `INSERT INTO checkout_users (username, password_hash, role, team_id, display_name)
         VALUES ($1, $2, 'team', $3, $4)
         RETURNING id, username, role, team_id, display_name`,
        [username, passwordHash, team.id, name]
      );
      await transaction.query(
        `INSERT INTO checkout_activity (actor_user_id, team_id, message)
         VALUES ($1, $2, $3)`,
        [actor.id, team.id, `Created credentials for Team ${name}.`]
      );
      return { team, user: userResult.rows[0] };
    });
  } catch (error) {
    if (error.code === "23505") {
      throw httpError(409, "That team identifier or username is already in use.");
    }

    throw error;
  }
}

async function changeAccountName(database, body, actor) {
  const name = cleanString(body.name, "Account name", { max: 120 });
  return database.transaction(async function (transaction) {
    const locked = await transaction.query("SELECT * FROM checkout_users WHERE id = $1 FOR UPDATE", [actor.id]);
    const user = locked.rows[0];
    if (!user || !user.active) throw httpError(401, "Please sign in to continue.");
    if (user.name_change_count >= 1) throw httpError(409, "You have already used your one account name change.");
    if (name === user.display_name) throw httpError(400, "Choose a different account name.");
    await transaction.query(
      "UPDATE checkout_users SET display_name = $2, name_change_count = name_change_count + 1 WHERE id = $1",
      [user.id, name]
    );
    // The account label changes; team roster names remain administrator-managed.
    if (user.role === "team") {
      await transaction.query("UPDATE checkout_teams SET name = $2 WHERE id = $1", [user.team_id, name]);
    }
    await transaction.query(
      "INSERT INTO checkout_activity (actor_user_id, team_id, message) VALUES ($1, $2, $3)",
      [user.id, user.team_id, `Account @${user.username} changed name from "${user.display_name}" to "${name}" (one-time change used).`]
    );
    return Object.assign({}, user, { display_name: name, team_name: user.role === "team" ? name : undefined, name_change_count: 1 });
  });
}

async function saveTeamProfile(database, body, actor) {
  if (actor.role !== "admin") throw httpError(403, "Only admins may edit team members and contact details.");
  const teamId = positiveInteger(body.teamId, "Team ID");
  const version = positiveInteger(body.version, "Profile version", true);
  if (!Array.isArray(body.memberNames) || body.memberNames.length > 4) {
    throw httpError(400, "Provide up to four member names.");
  }
  const memberNames = Array.from({ length: 4 }, function (_, index) {
    if (body.memberNames[index] != null && typeof body.memberNames[index] !== "string") {
      throw httpError(400, "Member names must be text.");
    }
    return cleanString(body.memberNames[index], `Member ${index + 1}`, { optional: true, max: 120 });
  });
  const contactEmail = cleanString(body.contactEmail, "Contact email", { optional: true, max: 254 });
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw httpError(400, "Enter a valid contact email.");
  }
  return database.transaction(async function (transaction) {
    const locked = await transaction.query("SELECT * FROM checkout_teams WHERE id = $1 FOR UPDATE", [teamId]);
    const before = locked.rows[0];
    if (!before) throw httpError(404, "Team not found.");
    if (before.profile_version !== version) throw httpError(409, "Another admin updated this team. Reload the team before saving.");
    const result = await transaction.query(
      `UPDATE checkout_teams SET member_names = $2, contact_email = $3, profile_version = profile_version + 1
        WHERE id = $1 RETURNING *`, [teamId, memberNames, contactEmail]
    );
    await transaction.query(
      "INSERT INTO checkout_activity (actor_user_id, team_id, message) VALUES ($1, $2, $3)",
      [actor.id, teamId, `Updated team members/contact: ${JSON.stringify({ memberNames: before.member_names, contactEmail: before.contact_email })} → ${JSON.stringify({ memberNames, contactEmail })}.`]
    );
    return { team: result.rows[0] };
  });
}

async function resetTeamPassword(database, body, actor) {
  const teamId = positiveInteger(body.teamId, "Team ID");
  const password = cleanString(body.password, "Password", { max: 200 });

  if (password.length < 8) {
    throw httpError(400, "Team passwords must be at least 8 characters.");
  }

  const passwordHash = await hashPassword(password);
  const result = await database.query(
    `UPDATE checkout_users SET password_hash = $1
      WHERE team_id = $2 AND role = 'team'
      RETURNING id`,
    [passwordHash, teamId]
  );

  if (!result.rows.length) {
    throw httpError(404, "Team account not found.");
  }

  await database.query("DELETE FROM checkout_sessions WHERE user_id = $1", [result.rows[0].id]);
  await database.query(
    `INSERT INTO checkout_activity (actor_user_id, team_id, message)
     VALUES ($1, $2, 'Reset the team password.')`,
    [actor.id, teamId]
  );
  return { reset: true };
}

async function saveComponent(database, body, actor) {
  const input = componentInput(body);
  const shouldReplaceRelationships = Object.prototype.hasOwnProperty.call(body, "relationships");
  const relationships = shouldReplaceRelationships
    ? (Array.isArray(body.relationships) ? body.relationships : []).map(relationshipInput)
    : null;
  const componentId = body.id == null ? null : positiveInteger(body.id, "Component ID");
  const changeReason = cleanString(body.changeReason, "Inventory change reason", { optional: !componentId, max: 500 });

  return database.transaction(async function (transaction) {
    async function replaceRelationships(sourceComponentId) {
      if (!shouldReplaceRelationships) return;

      const seen = new Set();
      const targetIds = [];

      relationships.forEach(function (relationship) {
        if (relationship.targetComponentId === Number(sourceComponentId)) {
          throw httpError(400, "A component cannot require or recommend itself.");
        }

        const key = `${relationship.targetComponentId}:${relationship.relationType}`;

        if (seen.has(key)) {
          throw httpError(400, "Each related component and relationship type may be listed only once.");
        }

        seen.add(key);
        targetIds.push(relationship.targetComponentId);
      });

      if (targetIds.length) {
        const targets = await transaction.query(
          "SELECT id FROM checkout_components WHERE id = ANY($1::bigint[])",
          [Array.from(new Set(targetIds))]
        );

        if (targets.rows.length !== new Set(targetIds).size) {
          throw httpError(400, "One or more related components no longer exist.");
        }
      }

      await transaction.query("DELETE FROM checkout_component_relationships WHERE source_component_id = $1", [sourceComponentId]);

      for (const relationship of relationships) {
        await transaction.query(
          `INSERT INTO checkout_component_relationships
            (source_component_id, target_component_id, relation_type, quantity_ratio, minimum_source_quantity, message)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sourceComponentId, relationship.targetComponentId, relationship.relationType,
            relationship.quantityRatio, relationship.minimumSourceQuantity, relationship.message]
        );
      }
    }

    if (!componentId) {
      const created = await transaction.query(
        `INSERT INTO checkout_components
          (name, description, image_url, image_alt, category, compatibility,
           arduino_guidance, raspberry_pi_guidance, bin_location,
           technical_specs, total_quantity, mlh_quantity, unavailable_quantity,
           protected_stock, max_active_per_team, active, admin_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [input.name, input.description, input.imageUrl, input.imageAlt, input.category,
          input.compatibility, input.arduinoGuidance, input.raspberryPiGuidance,
          input.binLocation, input.technicalSpecs, input.totalQuantity, input.mlhQuantity,
          input.unavailableQuantity, input.protectedStock, input.maxActivePerTeam,
          input.active, input.adminNotes]
      );
      const component = created.rows[0];
      await replaceRelationships(component.id);

      await transaction.query(
        `INSERT INTO checkout_inventory_transactions
          (component_id, admin_id, actor_user_id, transaction_type, quantity, new_state, note)
         VALUES ($1, $2, $2, 'INVENTORY_ADJUSTMENT', $3, $4, $5)`,
        [component.id, actor.id, input.totalQuantity, JSON.stringify(componentView(component)), changeReason || "Component created"]
      );
      await transaction.query(
        `INSERT INTO checkout_activity (actor_user_id, message)
         VALUES ($1, $2)`,
        [actor.id, `Added ${input.name} to inventory.`]
      );
      return (await componentsView(transaction, [component]))[0];
    }

    const currentResult = await transaction.query(
      "SELECT * FROM checkout_components WHERE id = $1 FOR UPDATE",
      [componentId]
    );
    const current = currentResult.rows[0];

    if (!current) {
      throw httpError(404, "Component not found.");
    }

    const expectedVersion = positiveInteger(body.expectedVersion, "Expected component version");

    if (Number(current.version) !== expectedVersion) {
      throw httpError(409, "This component changed since you opened it. Review the latest values before saving.", {
        current: componentView(current)
      });
    }

    const allocated = Number(current.reserved_quantity) + Number(current.checked_out_quantity);

    if (input.totalQuantity < allocated + input.mlhQuantity + input.unavailableQuantity) {
      throw httpError(409, `Total inventory cannot be lower than the ${allocated} reserved/checked-out, ${input.mlhQuantity} MLH-managed, and ${input.unavailableQuantity} unavailable units.`);
    }

    if (input.protectedStock > input.totalQuantity - input.mlhQuantity - input.unavailableQuantity) {
      throw httpError(409, "Protected stock cannot exceed CURC-managed usable inventory.");
    }

    const updatedResult = await transaction.query(
      `UPDATE checkout_components
          SET name = $2, description = $3, image_url = $4, image_alt = $5, category = $6,
               compatibility = $7, arduino_guidance = $8, raspberry_pi_guidance = $9,
               bin_location = $10, technical_specs = $11,
               total_quantity = $12, mlh_quantity = $13, unavailable_quantity = $14,
               protected_stock = $15, max_active_per_team = $16, active = $17, admin_notes = $18,
              version = version + 1, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [componentId, input.name, input.description, input.imageUrl, input.imageAlt, input.category,
        input.compatibility, input.arduinoGuidance, input.raspberryPiGuidance,
        input.binLocation, input.technicalSpecs, input.totalQuantity, input.mlhQuantity,
        input.unavailableQuantity, input.protectedStock, input.maxActivePerTeam,
        input.active, input.adminNotes]
    );
    const updated = updatedResult.rows[0];
    await replaceRelationships(componentId);

    await transaction.query(
      `INSERT INTO checkout_inventory_transactions
        (component_id, admin_id, actor_user_id, transaction_type, quantity, previous_state, new_state, note)
       VALUES ($1, $2, $2, 'INVENTORY_ADJUSTMENT', $3, $4, $5, $6)`,
      [componentId, actor.id, input.totalQuantity - Number(current.total_quantity),
        JSON.stringify(componentView(current)), JSON.stringify(componentView(updated)), changeReason]
    );
    await transaction.query(
      `INSERT INTO checkout_activity (actor_user_id, message)
       VALUES ($1, $2)`,
      [actor.id, `Updated inventory settings for ${input.name}.`]
    );
    return (await componentsView(transaction, [updated]))[0];
  });
}

async function submitOrder(database, body, actor) {
  const normalized = normalizedOrderItems(body.items);

  if (!normalized.size) {
    throw httpError(400, "Add at least one component before submitting your order.");
  }

  return database.transaction(async function (transaction) {
    const teamLock = await transaction.query(
      "SELECT id FROM checkout_teams WHERE id = $1 FOR UPDATE",
      [actor.team_id]
    );

    if (!teamLock.rows[0]) {
      throw httpError(404, "Team not found.");
    }

    const cooldown = await orderCooldownStatus(transaction, actor.team_id);
    const cooldownOverrideId = cooldown.overrideAvailable ? cooldown.overrideId : null;

    if (cooldown.policySecondsLeft > 0 && !cooldownOverrideId) {
      throw httpError(429, `You can place another order in ${Math.ceil(cooldown.policySecondsLeft / 60)} minute(s).`, {
        cooldownSeconds: cooldown.policySecondsLeft
      });
    }

    const componentIds = Array.from(normalized.keys()).sort(function (a, b) { return a - b; });
    const componentsResult = await transaction.query(
      "SELECT * FROM checkout_components WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
      [componentIds]
    );
    const components = new Map(componentsResult.rows.map(function (component) {
      return [Number(component.id), component];
    }));
    const activeResult = await transaction.query(
      `SELECT components.id,
              COALESCE(inventory.checked_out_quantity, 0) +
              COALESCE(SUM(items.approved_quantity) FILTER (
                WHERE orders.status IN ('submitted', 'reviewing', 'accepted', 'ready')
              ), 0) AS active_quantity
         FROM checkout_components components
         LEFT JOIN checkout_team_inventory inventory
           ON inventory.component_id = components.id AND inventory.team_id = $1
         LEFT JOIN checkout_order_items items ON items.component_id = components.id
         LEFT JOIN checkout_orders orders ON orders.id = items.order_id AND orders.team_id = $1
        WHERE components.id = ANY($2::bigint[])
        GROUP BY components.id, inventory.checked_out_quantity`,
      [actor.team_id, componentIds]
    );
    const activeQuantities = new Map(activeResult.rows.map(function (row) {
      return [Number(row.id), Number(row.active_quantity)];
    }));
    const errors = [];

    componentIds.forEach(function (componentId) {
      const component = components.get(componentId);
      const requested = normalized.get(componentId);

      if (!component) {
        errors.push({ componentId, message: "This component no longer exists." });
        return;
      }

      if (!component.active) {
        errors.push({ componentId, message: `${component.name} is currently disabled.` });
        return;
      }

      const available = Math.max(0, Number(component.total_quantity) - Number(component.mlh_quantity || 0) -
        Number(component.reserved_quantity) - Number(component.checked_out_quantity) -
        Number(component.unavailable_quantity) - Number(component.protected_stock || 0));

      if (Number(component.mlh_quantity || 0) > 0) {
        errors.push({ componentId, message: `${component.name}: pick this item up at the MLH desk; CURC does not track its quantity.` });
        return;
      }

      if (requested > available) {
        errors.push({ componentId, message: `${component.name}: only ${available} currently available for team orders.` });
      }

      const limit = component.max_active_per_team == null ? null : Number(component.max_active_per_team);
      const active = activeQuantities.get(componentId) || 0;

      if (limit != null && active + requested > limit) {
        errors.push({ componentId, message: `${component.name}: you may request only ${Math.max(0, limit - active)} more (maximum ${limit} active).` });
      }
    });

    if (errors.length) {
      throw httpError(409, "Your order could not be reserved. Adjust the highlighted items and try again.", { items: errors });
    }

    const advice = await cartAdvice(transaction, actor, Array.from(normalized, function (entry) {
      return { componentId: entry[0], quantity: entry[1] };
    }));
    const blockers = advice.filter(function (item) { return item.severity === "required"; });

    if (blockers.length) {
      throw httpError(409, "Your order is missing required supporting hardware.", { advice: blockers });
    }

    const orderResult = await transaction.query(
      `INSERT INTO checkout_orders (team_id, reservation_expires_at)
       VALUES ($1, NOW() + INTERVAL '${ORDER_EXPIRATION_MINUTES} minutes') RETURNING *`,
      [actor.team_id]
    );
    const order = orderResult.rows[0];
    const receiptCode = `O-${String(order.id).padStart(5, "0")}`;

    await transaction.query(
      "UPDATE checkout_orders SET receipt_code = $2 WHERE id = $1",
      [order.id, receiptCode]
    );

    if (cooldownOverrideId) {
      await transaction.query(
        `UPDATE checkout_order_cooldown_overrides
            SET consumed_at = NOW(), order_id = $2
          WHERE id = $1 AND consumed_at IS NULL`,
        [cooldownOverrideId, order.id]
      );
      await recordOrderEvent(transaction, order.id, actor.id, "ORDER_COOLDOWN_OVERRIDE_USED", {
        overrideId: cooldownOverrideId
      });
    }

    for (const componentId of componentIds) {
      const quantity = normalized.get(componentId);
      const component = components.get(componentId);

      await transaction.query(
        `INSERT INTO checkout_order_items
          (order_id, component_id, requested_quantity, approved_quantity,
           component_name_snapshot, component_image_url_snapshot,
           component_image_alt_snapshot, component_category_snapshot)
         VALUES ($1, $2, $3, $3, $4, $5, $6, $7)`,
        [order.id, componentId, quantity, component.name, component.image_url,
          component.image_alt, component.category]
      );
      await transaction.query(
        `UPDATE checkout_components
            SET reserved_quantity = reserved_quantity + $2, updated_at = NOW()
          WHERE id = $1`,
        [componentId, quantity]
      );
      await transaction.query(
        `INSERT INTO checkout_inventory_transactions
          (component_id, team_id, order_id, actor_user_id, transaction_type, quantity, note)
         VALUES ($1, $2, $3, $4, 'ORDER_RESERVED', $5, 'Reserved at order submission')`,
        [componentId, actor.team_id, order.id, actor.id, quantity]
      );
    }

    await transaction.query(
      `INSERT INTO checkout_activity (actor_user_id, team_id, order_id, message)
       VALUES ($1, $2, $3, $4)`,
      [actor.id, actor.team_id, order.id,
        `Team ${actor.team_name} submitted ${receiptCode}${cooldownOverrideId ? " using an organizer timeout exception" : ""}.`]
    );
    await recordOrderEvent(transaction, order.id, actor.id, "ORDER_SUBMITTED", {
      reservationExpiresAt: order.reservation_expires_at
    });

    return orderDetails(transaction, order.id);
  });
}

async function orderCooldownStatus(database, teamId) {
  const latestOrder = await database.query(
    `SELECT id, created_at,
            GREATEST(0, CEIL(EXTRACT(EPOCH FROM
              (created_at + INTERVAL '${ORDER_COOLDOWN_MINUTES} minutes' - NOW())
            ))) AS seconds_left
       FROM checkout_orders
      WHERE team_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [teamId]
  );
  const override = await database.query(
    `SELECT id, reason, expires_at
       FROM checkout_order_cooldown_overrides
      WHERE team_id = $1 AND consumed_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1`,
    [teamId]
  );
  const policySecondsLeft = latestOrder.rows[0] ? Number(latestOrder.rows[0].seconds_left) : 0;
  const activeOverride = override.rows[0] || null;

  return {
    secondsLeft: activeOverride ? 0 : policySecondsLeft,
    policySecondsLeft,
    overrideAvailable: Boolean(activeOverride),
    overrideId: activeOverride ? Number(activeOverride.id) : null,
    overrideReason: activeOverride ? activeOverride.reason : "",
    overrideExpiresAt: activeOverride ? activeOverride.expires_at : null,
    latestOrderId: latestOrder.rows[0] ? Number(latestOrder.rows[0].id) : null
  };
}

async function grantOrderCooldownOverride(database, body, actor) {
  const teamId = positiveInteger(body.teamId, "Team ID");
  const reason = cleanString(body.reason, "Timeout exception reason", { max: 500 });

  return database.transaction(async function (transaction) {
    const team = await transaction.query(
      "SELECT id, name FROM checkout_teams WHERE id = $1 FOR UPDATE",
      [teamId]
    );

    if (!team.rows[0]) {
      throw httpError(404, "Team not found.");
    }

    const cooldown = await orderCooldownStatus(transaction, teamId);

    if (cooldown.overrideAvailable) {
      throw httpError(409, "This team already has an unused timeout exception.");
    }

    if (cooldown.policySecondsLeft <= 0 || !cooldown.latestOrderId) {
      throw httpError(409, "This team does not currently have an order timeout to remove.");
    }

    const inserted = await transaction.query(
      `INSERT INTO checkout_order_cooldown_overrides
        (team_id, granted_by, reason, expires_at)
       SELECT $1, $2, $3, created_at + INTERVAL '${ORDER_COOLDOWN_MINUTES} minutes'
         FROM checkout_orders WHERE id = $4
       RETURNING id, expires_at`,
      [teamId, actor.id, reason, cooldown.latestOrderId]
    );
    await transaction.query(
      `INSERT INTO checkout_activity (actor_user_id, team_id, message)
       VALUES ($1, $2, $3)`,
      [actor.id, teamId, `${actor.display_name} granted ${team.rows[0].name} a one-order timeout exception: ${reason}`]
    );

    return {
      overrideId: Number(inserted.rows[0].id),
      expiresAt: inserted.rows[0].expires_at,
      cooldown: await orderCooldownStatus(transaction, teamId)
    };
  });
}

async function createProtectedStockOverrideOrder(database, body, actor) {
  const teamId = positiveInteger(body.teamId, "Team ID");
  const reason = cleanString(body.reason, "Override reason", { max: 500 });
  const normalized = normalizedOrderItems(body.items);

  if (!normalized.size) {
    throw httpError(400, "Add at least one component to the override order.");
  }

  return database.transaction(async function (transaction) {
    const teamResult = await transaction.query(
      "SELECT * FROM checkout_teams WHERE id = $1 FOR UPDATE",
      [teamId]
    );
    const team = teamResult.rows[0];

    if (!team) {
      throw httpError(404, "Team not found.");
    }

    const componentIds = Array.from(normalized.keys()).sort(function (a, b) { return a - b; });
    const componentsResult = await transaction.query(
      "SELECT * FROM checkout_components WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
      [componentIds]
    );
    const components = new Map(componentsResult.rows.map(function (component) {
      return [Number(component.id), component];
    }));
    const activeResult = await transaction.query(
      `SELECT components.id,
              COALESCE(inventory.checked_out_quantity, 0) + COALESCE(reservations.quantity, 0) AS active_quantity
         FROM checkout_components components
         LEFT JOIN checkout_team_inventory inventory
           ON inventory.component_id = components.id AND inventory.team_id = $1
         LEFT JOIN (
           SELECT items.component_id, SUM(items.approved_quantity) AS quantity
             FROM checkout_order_items items
             JOIN checkout_orders orders ON orders.id = items.order_id
            WHERE orders.team_id = $1 AND orders.status IN ('submitted', 'reviewing', 'accepted', 'ready')
            GROUP BY items.component_id
         ) reservations ON reservations.component_id = components.id
        WHERE components.id = ANY($2::bigint[])`,
      [teamId, componentIds]
    );
    const active = new Map(activeResult.rows.map(function (row) {
      return [Number(row.id), Number(row.active_quantity)];
    }));
    let usesProtectedStock = false;
    const errors = [];

    componentIds.forEach(function (componentId) {
      const component = components.get(componentId);
      const quantity = normalized.get(componentId);

      if (!component || !component.active) {
        errors.push({ componentId, message: "This component is missing or disabled." });
        return;
      }

      if (Number(component.mlh_quantity || 0) > 0) {
        errors.push({ componentId, message: `${component.name}: pick this item up at the MLH desk; CURC does not track its quantity.` });
        return;
      }

      const physicalAvailable = Number(component.total_quantity) - Number(component.mlh_quantity || 0) -
        Number(component.reserved_quantity) - Number(component.checked_out_quantity) -
        Number(component.unavailable_quantity);
      const normalAvailable = Math.max(0, physicalAvailable - Number(component.protected_stock));

      if (quantity > physicalAvailable) {
        errors.push({
          componentId,
          message: `${component.name}: only ${physicalAvailable} physically available through CURC.`
        });
      }

      if (quantity > normalAvailable) {
        usesProtectedStock = true;
      }

      const limit = component.max_active_per_team == null ? null : Number(component.max_active_per_team);
      if (limit != null && (active.get(componentId) || 0) + quantity > limit) {
        errors.push({ componentId, message: `${component.name}: this would exceed the per-team maximum of ${limit}.` });
      }
    });

    if (errors.length) {
      throw httpError(409, "The protected-stock order could not be created.", { items: errors });
    }

    if (!usesProtectedStock) {
      throw httpError(400, "This order does not need a protected-stock override; the requested quantities are normally available.");
    }

    const adviceActor = { team_id: teamId };
    const advice = await cartAdvice(transaction, adviceActor, Array.from(normalized, function (entry) {
      return { componentId: entry[0], quantity: entry[1] };
    }));
    const blockers = advice.filter(function (item) { return item.severity === "required"; });

    if (blockers.length) {
      throw httpError(409, "The override order is missing required supporting hardware.", { advice: blockers });
    }

    const orderResult = await transaction.query(
      `INSERT INTO checkout_orders
        (team_id, status, reviewed_by, reviewing_at, claim_expires_at, reservation_expires_at,
         protected_stock_override_by, protected_stock_override_reason, protected_stock_override_at)
        VALUES ($1, 'reviewing', $2, NOW(), NOW() + INTERVAL '7 minutes',
                NOW() + INTERVAL '${ORDER_EXPIRATION_MINUTES} minutes',
               $2, $3, NOW())
       RETURNING *`,
      [teamId, actor.id, reason]
    );
    const order = orderResult.rows[0];
    const receiptCode = `O-${String(order.id).padStart(5, "0")}`;
    await transaction.query("UPDATE checkout_orders SET receipt_code = $2 WHERE id = $1", [order.id, receiptCode]);

    for (const componentId of componentIds) {
      const quantity = normalized.get(componentId);
      const component = components.get(componentId);
      await transaction.query(
        `INSERT INTO checkout_order_items
          (order_id, component_id, requested_quantity, approved_quantity,
           component_name_snapshot, component_image_url_snapshot, component_image_alt_snapshot, component_category_snapshot)
         VALUES ($1, $2, $3, $3, $4, $5, $6, $7)`,
        [order.id, componentId, quantity, component.name, component.image_url, component.image_alt, component.category]
      );
      await transaction.query(
        "UPDATE checkout_components SET reserved_quantity = reserved_quantity + $2, updated_at = NOW() WHERE id = $1",
        [componentId, quantity]
      );
      await transaction.query(
        `INSERT INTO checkout_inventory_transactions
          (component_id, team_id, order_id, admin_id, actor_user_id, transaction_type, quantity, note)
         VALUES ($1, $2, $3, $4, $4, 'PROTECTED_STOCK_OVERRIDE', $5, $6)`,
        [componentId, teamId, order.id, actor.id, quantity, reason]
      );
    }

    await recordOrderEvent(transaction, order.id, actor.id, "PROTECTED_STOCK_OVERRIDE", { reason });
    await transaction.query(
      `INSERT INTO checkout_activity (actor_user_id, team_id, order_id, message)
       VALUES ($1, $2, $3, $4)`,
      [actor.id, teamId, order.id, `${actor.display_name} created ${receiptCode} using protected stock: ${reason}`]
    );
    return orderDetails(transaction, order.id);
  });
}

async function orderDetails(database, orderId, teamId) {
  const values = [orderId];
  let teamClause = "";

  if (teamId != null) {
    values.push(teamId);
    teamClause = " AND orders.team_id = $2";
  }

  const result = await database.query(
    `SELECT orders.*, teams.name AS team_name, reviewer.display_name AS reviewer_name,
            accepted.display_name AS accepted_by_name, ready.display_name AS ready_by_name,
            picked_up.display_name AS picked_up_by_name, cancelled.display_name AS cancelled_by_name
       FROM checkout_orders orders
       JOIN checkout_teams teams ON teams.id = orders.team_id
       LEFT JOIN checkout_users reviewer ON reviewer.id = orders.reviewed_by
       LEFT JOIN checkout_users accepted ON accepted.id = orders.accepted_by
       LEFT JOIN checkout_users ready ON ready.id = orders.ready_by
       LEFT JOIN checkout_users picked_up ON picked_up.id = orders.picked_up_by
       LEFT JOIN checkout_users cancelled ON cancelled.id = orders.cancelled_by
      WHERE orders.id = $1${teamClause}`,
    values
  );

  if (!result.rows[0]) {
    throw httpError(404, "Order not found.");
  }

  const items = await orderItems(database, [Number(orderId)]);
  const eventsResult = await database.query(
    `SELECT events.event_type, events.details, events.created_at, users.display_name AS actor_name
       FROM checkout_order_events events
       LEFT JOIN checkout_users users ON users.id = events.actor_user_id
      WHERE events.order_id = $1 ORDER BY events.created_at, events.id`,
    [orderId]
  );
  const row = result.rows[0];
  row.events = eventsResult.rows.map(function (event) {
    return {
      type: event.event_type,
      details: event.details || {},
      createdAt: event.created_at,
      actorName: event.actor_name
    };
  });
  return orderView(row, items.get(Number(orderId)) || []);
}

async function teamDashboard(database, actor) {
  await expireOrders(database);
  const ordersResult = await database.query(
    `SELECT orders.*, teams.name AS team_name, reviewer.display_name AS reviewer_name,
            accepted.display_name AS accepted_by_name, ready.display_name AS ready_by_name,
            picked_up.display_name AS picked_up_by_name, cancelled.display_name AS cancelled_by_name
       FROM checkout_orders orders
       JOIN checkout_teams teams ON teams.id = orders.team_id
       LEFT JOIN checkout_users reviewer ON reviewer.id = orders.reviewed_by
       LEFT JOIN checkout_users accepted ON accepted.id = orders.accepted_by
       LEFT JOIN checkout_users ready ON ready.id = orders.ready_by
       LEFT JOIN checkout_users picked_up ON picked_up.id = orders.picked_up_by
       LEFT JOIN checkout_users cancelled ON cancelled.id = orders.cancelled_by
      WHERE orders.team_id = $1
      ORDER BY orders.created_at DESC`,
    [actor.team_id]
  );
  const ids = ordersResult.rows.map(function (order) { return Number(order.id); });
  const items = await orderItems(database, ids);
  const inventoryResult = await database.query(
    `SELECT inventory.checked_out_quantity, components.id, components.name,
            components.image_url, components.image_alt, components.category
       FROM checkout_team_inventory inventory
       JOIN checkout_components components ON components.id = inventory.component_id
      WHERE inventory.team_id = $1 AND inventory.checked_out_quantity > 0
      ORDER BY components.name`,
    [actor.team_id]
  );
  const cooldown = await orderCooldownStatus(database, actor.team_id);

  return {
    orders: ordersResult.rows.map(function (order) {
      return orderView(order, items.get(Number(order.id)) || []);
    }),
    inventory: inventoryResult.rows.map(function (row) {
      return {
        componentId: Number(row.id),
        name: row.name,
        imageUrl: row.image_url,
        imageAlt: row.image_alt,
        category: row.category,
        checkedOutQuantity: Number(row.checked_out_quantity)
      };
    }),
    cooldownSeconds: cooldown.secondsLeft,
    cooldownOverrideAvailable: cooldown.overrideAvailable
  };
}

async function adminOrders(database) {
  await expireOrders(database);
  const result = await database.query(
    `SELECT orders.*, teams.name AS team_name, reviewer.display_name AS reviewer_name,
            accepted.display_name AS accepted_by_name, ready.display_name AS ready_by_name,
            picked_up.display_name AS picked_up_by_name, cancelled.display_name AS cancelled_by_name
       FROM checkout_orders orders
       JOIN checkout_teams teams ON teams.id = orders.team_id
       LEFT JOIN checkout_users reviewer ON reviewer.id = orders.reviewed_by
       LEFT JOIN checkout_users accepted ON accepted.id = orders.accepted_by
       LEFT JOIN checkout_users ready ON ready.id = orders.ready_by
       LEFT JOIN checkout_users picked_up ON picked_up.id = orders.picked_up_by
       LEFT JOIN checkout_users cancelled ON cancelled.id = orders.cancelled_by
      ORDER BY orders.created_at DESC`
  );
  const ids = result.rows.map(function (order) { return Number(order.id); });
  const items = await orderItems(database, ids);
  return result.rows.map(function (order) {
    return orderView(order, items.get(Number(order.id)) || []);
  });
}

async function adminOverview(database) {
  await expireOrders(database);
  const orders = await database.query(
    "SELECT status, COUNT(*) AS count FROM checkout_orders GROUP BY status"
  );
  const inventory = await database.query(
    `SELECT COALESCE(SUM(total_quantity - mlh_quantity - reserved_quantity - checked_out_quantity - unavailable_quantity), 0) AS available,
            COALESCE(SUM(reserved_quantity), 0) AS reserved,
            COALESCE(SUM(checked_out_quantity), 0) AS checked_out,
            COALESCE(SUM(unavailable_quantity), 0) AS unavailable
       FROM checkout_components`
  );
  const teams = await database.query(
    "SELECT COUNT(DISTINCT team_id) AS count FROM checkout_team_inventory WHERE checked_out_quantity > 0"
  );

  return {
    orders: orders.rows.reduce(function (counts, row) {
      counts[row.status] = Number(row.count);
      return counts;
    }, {}),
    inventory: Object.fromEntries(Object.entries(inventory.rows[0]).map(function (entry) {
      return [entry[0], Number(entry[1])];
    })),
    teamsHoldingHardware: Number(teams.rows[0].count)
  };
}

async function claimOrder(database, body, actor) {
  const orderId = positiveInteger(body.orderId, "Order ID");

  return database.transaction(async function (transaction) {
    const result = await transaction.query(
      `SELECT orders.*, users.display_name AS reviewer_name,
              (orders.claim_expires_at IS NOT NULL AND orders.claim_expires_at <= NOW()) AS claim_expired
         FROM checkout_orders orders
         LEFT JOIN checkout_users users ON users.id = orders.reviewed_by
        WHERE orders.id = $1 FOR UPDATE OF orders`,
      [orderId]
    );
    const order = result.rows[0];

    if (!order) {
      throw httpError(404, "Order not found.");
    }

    if (order.status === "reviewing" && Number(order.reviewed_by) === Number(actor.id) && !order.claim_expired) {
      await transaction.query(
        `UPDATE checkout_orders
            SET claim_expires_at = NOW() + INTERVAL '7 minutes',
                reservation_expires_at = NOW() + INTERVAL '${ORDER_EXPIRATION_MINUTES} minutes'
          WHERE id = $1`,
        [orderId]
      );
      return orderDetails(transaction, orderId);
    }

    const canTakeExpiredClaim = order.status === "reviewing" && order.claim_expired;

    if (order.status !== "submitted" && !canTakeExpiredClaim) {
      const reviewer = order.reviewer_name ? ` by ${order.reviewer_name}` : "";
      throw httpError(409, `This order is already ${order.status.replace("_", " ")}${reviewer}.`);
    }

    await transaction.query(
      `UPDATE checkout_orders
          SET status = 'reviewing', reviewed_by = $2, reviewing_at = NOW(),
              claim_expires_at = NOW() + INTERVAL '7 minutes',
              reservation_expires_at = NOW() + INTERVAL '${ORDER_EXPIRATION_MINUTES} minutes'
        WHERE id = $1`,
      [orderId, actor.id]
    );
    await transaction.query(
      `INSERT INTO checkout_activity (actor_user_id, team_id, order_id, message)
       SELECT $2, team_id, id, $3 FROM checkout_orders WHERE id = $1`,
      [orderId, actor.id, `${actor.display_name} ${canTakeExpiredClaim ? "took over the expired claim on" : "claimed"} Order #${orderId} for review.`]
    );
    await recordOrderEvent(transaction, orderId, actor.id, canTakeExpiredClaim ? "ORDER_CLAIM_TAKEN_OVER" : "ORDER_CLAIMED", {});
    return orderDetails(transaction, orderId);
  });
}

async function releaseClaim(database, body, actor) {
  const orderId = positiveInteger(body.orderId, "Order ID");

  return database.transaction(async function (transaction) {
    const result = await transaction.query(
      "SELECT * FROM checkout_orders WHERE id = $1 FOR UPDATE",
      [orderId]
    );
    const order = result.rows[0];

    if (!order) {
      throw httpError(404, "Order not found.");
    }

    if (order.status !== "reviewing" || Number(order.reviewed_by) !== Number(actor.id)) {
      throw httpError(409, "Only the volunteer holding this claim can release it.");
    }

    await transaction.query(
      `UPDATE checkout_orders
          SET status = 'submitted', reviewed_by = NULL, reviewing_at = NULL,
              claim_expires_at = NULL,
              reservation_expires_at = NOW() + INTERVAL '${ORDER_EXPIRATION_MINUTES} minutes'
        WHERE id = $1`,
      [orderId]
    );
    await recordOrderEvent(transaction, orderId, actor.id, "ORDER_CLAIM_RELEASED", {});
    await transaction.query(
      `INSERT INTO checkout_activity (actor_user_id, team_id, order_id, message)
       VALUES ($1, $2, $3, $4)`,
      [actor.id, order.team_id, orderId, `${actor.display_name} released the claim on Order #${orderId}.`]
    );
    return orderDetails(transaction, orderId);
  });
}

async function adjustOrder(database, body, actor) {
  const orderId = positiveInteger(body.orderId, "Order ID");
  const adjustments = Array.isArray(body.items) ? body.items : [];

  return database.transaction(async function (transaction) {
    const orderResult = await transaction.query(
      "SELECT * FROM checkout_orders WHERE id = $1 FOR UPDATE",
      [orderId]
    );
    const order = orderResult.rows[0];

    if (!order) {
      throw httpError(404, "Order not found.");
    }

    if (order.status !== "reviewing" || Number(order.reviewed_by) !== Number(actor.id) ||
        !order.claim_expires_at || new Date(order.claim_expires_at) <= new Date()) {
      throw httpError(409, "Claim this reviewing order before changing approved quantities.");
    }

    for (const adjustment of adjustments) {
      const itemId = positiveInteger(adjustment.itemId, "Order item ID");
      const approved = positiveInteger(adjustment.approvedQuantity, "Approved quantity", true);
      const itemResult = await transaction.query(
        `SELECT items.*, components.name
           FROM checkout_order_items items
           JOIN checkout_components components ON components.id = items.component_id
          WHERE items.id = $1 AND items.order_id = $2
          FOR UPDATE OF items`,
        [itemId, orderId]
      );
      const item = itemResult.rows[0];

      if (!item) {
        throw httpError(404, "Order item not found.");
      }

      if (approved > Number(item.requested_quantity)) {
        throw httpError(409, `${item.name}: approved quantity cannot exceed the requested quantity.`);
      }

      const previous = Number(item.approved_quantity);

      if (approved > previous) {
        throw httpError(409, `${item.name}: approved quantity can only be lowered after reservation. Ask the team to place a later order for additional units.`);
      }

      const released = previous - approved;
      const reason = cleanString(adjustment.reason, "Adjustment reason", { optional: approved === previous, max: 120 });
      const note = cleanString(adjustment.note, "Adjustment note", { optional: true, max: 1000 });

      await transaction.query(
        `UPDATE checkout_order_items
            SET approved_quantity = $2, adjustment_reason = $3, note = $4
          WHERE id = $1`,
        [itemId, approved, reason || null, note]
      );

      if (released !== 0) {
        await transaction.query(
          `UPDATE checkout_components
              SET reserved_quantity = reserved_quantity - $2, updated_at = NOW()
            WHERE id = $1`,
          [item.component_id, released]
        );
        await transaction.query(
          `INSERT INTO checkout_inventory_transactions
            (component_id, team_id, order_id, admin_id, actor_user_id, transaction_type, quantity, note)
           VALUES ($1, $2, $3, $4, $4, 'ORDER_ADJUSTED', $5, $6)`,
          [item.component_id, order.team_id, orderId, actor.id, -released, [reason, note].filter(Boolean).join(": ")]
        );
      }
    }

    await transaction.query(
      `INSERT INTO checkout_activity (actor_user_id, team_id, order_id, message)
       VALUES ($1, $2, $3, $4)`,
      [actor.id, order.team_id, orderId, `${actor.display_name} updated approved quantities for Order #${orderId}.`]
    );
    await transaction.query(
      "UPDATE checkout_orders SET claim_expires_at = NOW() + INTERVAL '7 minutes' WHERE id = $1",
      [orderId]
    );
    await recordOrderEvent(transaction, orderId, actor.id, "ORDER_ADJUSTED", {});
    return orderDetails(transaction, orderId);
  });
}

async function transitionOrder(database, body, actor, transition) {
  const orderId = positiveInteger(body.orderId, "Order ID");

  return database.transaction(async function (transaction) {
    const orderResult = await transaction.query(
      "SELECT * FROM checkout_orders WHERE id = $1 FOR UPDATE",
      [orderId]
    );
    const order = orderResult.rows[0];

    if (!order) {
      throw httpError(404, "Order not found.");
    }

    if (transition === "accept") {
      if (order.status === "accepted") {
        return orderDetails(transaction, orderId);
      }

      if (order.status !== "reviewing" || Number(order.reviewed_by) !== Number(actor.id) ||
          !order.claim_expires_at || new Date(order.claim_expires_at) <= new Date()) {
        throw httpError(409, "Only the volunteer with the active claim can accept this order.");
      }

      await transaction.query(
        `UPDATE checkout_orders
            SET status = 'accepted', accepted_by = $2, accepted_at = NOW(),
                claim_expires_at = NULL,
                reservation_expires_at = NOW() + INTERVAL '${ORDER_EXPIRATION_MINUTES} minutes'
          WHERE id = $1`,
        [orderId, actor.id]
      );
      await recordOrderEvent(transaction, orderId, actor.id, "ORDER_ACCEPTED", {});
      await transaction.query(
        `INSERT INTO checkout_activity (actor_user_id, team_id, order_id, message)
         VALUES ($1, $2, $3, $4)`,
        [actor.id, order.team_id, orderId, `${actor.display_name} accepted Order #${orderId}.`]
      );
      return orderDetails(transaction, orderId);
    }

    if (transition === "ready") {
      if (order.status === "ready") {
        return orderDetails(transaction, orderId);
      }

      if (order.status !== "accepted" || Number(order.accepted_by) !== Number(actor.id)) {
        throw httpError(409, "Only the volunteer who accepted this order can mark it ready.");
      }

      await transaction.query(
        `UPDATE checkout_orders
            SET status = 'ready', ready_by = $2, ready_at = NOW(),
                reservation_expires_at = NOW() + INTERVAL '${ORDER_EXPIRATION_MINUTES} minutes'
          WHERE id = $1`,
        [orderId, actor.id]
      );
      await recordOrderEvent(transaction, orderId, actor.id, "ORDER_READY", {});
      await transaction.query(
        `INSERT INTO checkout_activity (actor_user_id, team_id, order_id, message)
         VALUES ($1, $2, $3, $4)`,
        [actor.id, order.team_id, orderId, `${actor.display_name} marked Order #${orderId} ready for pickup.`]
      );
      return orderDetails(transaction, orderId);
    }

    if (transition === "pickup") {
      if (order.status === "picked_up") {
        return orderDetails(transaction, orderId);
      }

      if (order.status !== "ready") {
        throw httpError(409, "Only an order that is ready for pickup can be handed out.");
      }

      const items = await transaction.query(
        "SELECT * FROM checkout_order_items WHERE order_id = $1 ORDER BY component_id FOR UPDATE",
        [orderId]
      );

      for (const item of items.rows) {
        const quantity = Number(item.approved_quantity);

        if (!quantity) {
          continue;
        }

        const componentResult = await transaction.query(
          "SELECT * FROM checkout_components WHERE id = $1 FOR UPDATE",
          [item.component_id]
        );
        const component = componentResult.rows[0];

        if (Number(component.mlh_quantity || 0) > 0) {
          throw httpError(409, `${component.name} is managed by MLH and cannot be handed out through CURC.`);
        }

        if (Number(component.reserved_quantity) < quantity) {
          throw httpError(409, `Inventory state changed for ${component.name}; pickup was not processed.`);
        }

        await transaction.query(
          `UPDATE checkout_components
              SET reserved_quantity = reserved_quantity - $2,
                  checked_out_quantity = checked_out_quantity + $2,
                  updated_at = NOW()
            WHERE id = $1`,
          [item.component_id, quantity]
        );
        await transaction.query(
          `INSERT INTO checkout_team_inventory (team_id, component_id, checked_out_quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT (team_id, component_id) DO UPDATE
             SET checked_out_quantity = checkout_team_inventory.checked_out_quantity + EXCLUDED.checked_out_quantity`,
          [order.team_id, item.component_id, quantity]
        );
        await transaction.query(
          `INSERT INTO checkout_inventory_transactions
            (component_id, team_id, order_id, admin_id, actor_user_id, transaction_type, quantity, idempotency_key, note)
           VALUES ($1, $2, $3, $4, $4, 'PICKUP', $5, $6, 'Physical pickup confirmed')`,
          [item.component_id, order.team_id, orderId, actor.id, quantity, `pickup:${orderId}:${item.component_id}`]
        );
      }

      await transaction.query(
        `UPDATE checkout_orders
            SET status = 'picked_up', picked_up_by = $2, picked_up_at = NOW(),
                reservation_expires_at = NULL
          WHERE id = $1`,
        [orderId, actor.id]
      );
      await recordOrderEvent(transaction, orderId, actor.id, "ORDER_PICKED_UP", {});
      await transaction.query(
        `INSERT INTO checkout_activity (actor_user_id, team_id, order_id, message)
         VALUES ($1, $2, $3, $4)`,
        [actor.id, order.team_id, orderId, `${actor.display_name} confirmed pickup for Order #${orderId}.`]
      );
      return orderDetails(transaction, orderId);
    }

    if (transition === "cancel") {
      if (order.status === "cancelled") {
        return orderDetails(transaction, orderId);
      }

      if (order.status === "picked_up") {
        throw httpError(409, "Picked-up hardware must be processed as a return.");
      }

      const items = await transaction.query(
        "SELECT * FROM checkout_order_items WHERE order_id = $1 ORDER BY component_id FOR UPDATE",
        [orderId]
      );

      for (const item of items.rows) {
        const quantity = Number(item.approved_quantity);

        if (!quantity) {
          continue;
        }

        await transaction.query(
          `UPDATE checkout_components
              SET reserved_quantity = reserved_quantity - $2, updated_at = NOW()
            WHERE id = $1`,
          [item.component_id, quantity]
        );
        await transaction.query(
          `INSERT INTO checkout_inventory_transactions
            (component_id, team_id, order_id, admin_id, actor_user_id, transaction_type, quantity, idempotency_key, note)
           VALUES ($1, $2, $3, $4, $4, 'ORDER_CANCELLED', $5, $6, $7)`,
          [item.component_id, order.team_id, orderId, actor.id, -quantity,
            `cancel:${orderId}:${item.component_id}`, cleanString(body.note, "Cancellation note", { optional: true, max: 1000 })]
        );
      }

      await transaction.query(
        `UPDATE checkout_orders
            SET status = 'cancelled', cancelled_by = $2, cancelled_at = NOW(),
                claim_expires_at = NULL, reservation_expires_at = NULL, cancellation_note = $3
          WHERE id = $1`,
        [orderId, actor.id, cleanString(body.note, "Cancellation note", { optional: true, max: 1000 })]
      );
      await recordOrderEvent(transaction, orderId, actor.id, "ORDER_CANCELLED", {
        note: cleanString(body.note, "Cancellation note", { optional: true, max: 1000 })
      });
      await transaction.query(
        `INSERT INTO checkout_activity (actor_user_id, team_id, order_id, message)
         VALUES ($1, $2, $3, $4)`,
        [actor.id, order.team_id, orderId, `${actor.display_name} cancelled Order #${orderId}.`]
      );
      return orderDetails(transaction, orderId);
    }

    throw httpError(400, "Unknown order transition.");
  });
}

async function teamsList(database, search) {
  const query = cleanString(search, "Search", { optional: true, max: 120 });
  const result = await database.query(
    `SELECT teams.id, teams.name, teams.identifier, users.username,
            COALESCE(SUM(inventory.checked_out_quantity), 0) AS checked_out_quantity
       FROM checkout_teams teams
       JOIN checkout_users users ON users.team_id = teams.id AND users.role = 'team'
       LEFT JOIN checkout_team_inventory inventory ON inventory.team_id = teams.id
      WHERE $1 = '' OR teams.name ILIKE '%' || $1 || '%' OR teams.identifier ILIKE '%' || $1 || '%'
         OR array_to_string(teams.member_names, ' ') ILIKE '%' || $1 || '%'
         OR teams.contact_email ILIKE '%' || $1 || '%'
      GROUP BY teams.id, users.username
      ORDER BY CASE WHEN teams.identifier ~ '^team-[0-9]+$' THEN substring(teams.identifier FROM 6)::INTEGER END NULLS LAST, teams.name`,
    [query]
  );

  return result.rows.map(function (row) {
    return {
      id: Number(row.id),
      name: row.name,
      identifier: row.identifier,
      username: row.username,
      checkedOutQuantity: Number(row.checked_out_quantity)
    };
  });
}

async function teamAdminDetail(database, teamIdInput) {
  await expireOrders(database);
  const teamId = positiveInteger(teamIdInput, "Team ID");
  const teamResult = await database.query(
    "SELECT * FROM checkout_teams WHERE id = $1",
    [teamId]
  );
  const protectedInventory = await database.query(
    `SELECT id, name, category, protected_stock,
            GREATEST(0, total_quantity - mlh_quantity - reserved_quantity - checked_out_quantity - unavailable_quantity) AS physical_available,
            GREATEST(0, total_quantity - mlh_quantity - reserved_quantity - checked_out_quantity - unavailable_quantity - protected_stock) AS normal_available
       FROM checkout_components
      WHERE active = TRUE AND protected_stock > 0 AND mlh_quantity = 0
        AND total_quantity - mlh_quantity - reserved_quantity - checked_out_quantity - unavailable_quantity > 0
      ORDER BY category, name`
  );

  if (!teamResult.rows[0]) {
    throw httpError(404, "Team not found.");
  }

  const inventory = await database.query(
    `SELECT inventory.checked_out_quantity, components.id, components.name,
            components.image_url, components.category
       FROM checkout_team_inventory inventory
       JOIN checkout_components components ON components.id = inventory.component_id
      WHERE inventory.team_id = $1 AND inventory.checked_out_quantity > 0
      ORDER BY components.name`,
    [teamId]
  );
  const ordersResult = await database.query(
    `SELECT orders.*, teams.name AS team_name, reviewer.display_name AS reviewer_name,
            accepted.display_name AS accepted_by_name, ready.display_name AS ready_by_name,
            picked_up.display_name AS picked_up_by_name, cancelled.display_name AS cancelled_by_name
       FROM checkout_orders orders
       JOIN checkout_teams teams ON teams.id = orders.team_id
       LEFT JOIN checkout_users reviewer ON reviewer.id = orders.reviewed_by
       LEFT JOIN checkout_users accepted ON accepted.id = orders.accepted_by
       LEFT JOIN checkout_users ready ON ready.id = orders.ready_by
       LEFT JOIN checkout_users picked_up ON picked_up.id = orders.picked_up_by
       LEFT JOIN checkout_users cancelled ON cancelled.id = orders.cancelled_by
      WHERE orders.team_id = $1 ORDER BY orders.created_at DESC`,
    [teamId]
  );
  const orderIds = ordersResult.rows.map(function (row) { return Number(row.id); });
  const items = await orderItems(database, orderIds);
  const returns = await database.query(
    `SELECT receipts.id, receipts.receipt_code, receipts.created_at, users.display_name AS processed_by,
            items.id AS return_item_id, items.component_id, items.quantity, items.condition, items.note,
            items.quantity - COALESCE((
              SELECT SUM(correction_items.quantity)
                FROM checkout_return_correction_items correction_items
               WHERE correction_items.original_return_item_id = items.id
            ), 0) AS correctable_quantity,
            COALESCE(NULLIF(items.component_name_snapshot, ''), components.name) AS name
       FROM checkout_return_receipts receipts
       JOIN checkout_users users ON users.id = receipts.processed_by
       JOIN checkout_return_items items ON items.return_receipt_id = receipts.id
       JOIN checkout_components components ON components.id = items.component_id
      WHERE receipts.team_id = $1 ORDER BY receipts.created_at DESC, items.id`,
    [teamId]
  );
  const receiptMap = new Map();

  returns.rows.forEach(function (row) {
    const id = Number(row.id);

    if (!receiptMap.has(id)) {
      receiptMap.set(id, {
        id,
        receiptCode: row.receipt_code || `R-${String(id).padStart(5, "0")}`,
        createdAt: row.created_at,
        processedBy: row.processed_by,
        items: []
      });
    }

    receiptMap.get(id).items.push({
      id: Number(row.return_item_id),
      componentId: Number(row.component_id),
      name: row.name,
      quantity: Number(row.quantity),
      condition: row.condition,
      note: row.note,
      correctableQuantity: Number(row.correctable_quantity)
    });
  });
  const corrections = await database.query(
    `SELECT corrections.id, corrections.receipt_code, corrections.original_return_receipt_id,
            original_receipts.receipt_code AS original_return_receipt_code,
            corrections.reason, corrections.created_at, users.display_name AS processed_by,
            items.quantity, items.original_condition, items.corrected_condition, items.note,
            COALESCE(NULLIF(items.component_name_snapshot, ''), components.name) AS name
       FROM checkout_return_corrections corrections
       JOIN checkout_return_receipts original_receipts ON original_receipts.id = corrections.original_return_receipt_id
       JOIN checkout_users users ON users.id = corrections.processed_by
       JOIN checkout_return_correction_items items ON items.correction_receipt_id = corrections.id
       JOIN checkout_components components ON components.id = items.component_id
      WHERE corrections.team_id = $1
      ORDER BY corrections.created_at DESC, items.id`,
    [teamId]
  );
  const cooldown = await orderCooldownStatus(database, teamId);
  const correctionMap = new Map();

  corrections.rows.forEach(function (row) {
    const id = Number(row.id);
    if (!correctionMap.has(id)) {
      correctionMap.set(id, {
        id,
        receiptCode: row.receipt_code || `C-${String(id).padStart(5, "0")}`,
        originalReturnReceiptId: Number(row.original_return_receipt_id),
        originalReturnReceiptCode: row.original_return_receipt_code || `R-${String(row.original_return_receipt_id).padStart(5, "0")}`,
        reason: row.reason,
        createdAt: row.created_at,
        processedBy: row.processed_by,
        items: []
      });
    }
    correctionMap.get(id).items.push({
      name: row.name,
      quantity: Number(row.quantity),
      originalCondition: row.original_condition,
      correctedCondition: row.corrected_condition,
      note: row.note
    });
  });

  return {
    team: {
      id: Number(teamResult.rows[0].id),
      name: teamResult.rows[0].name,
      identifier: teamResult.rows[0].identifier,
      memberNames: teamResult.rows[0].member_names,
      contactEmail: teamResult.rows[0].contact_email,
      profileVersion: teamResult.rows[0].profile_version
    },
    cooldown,
    inventory: inventory.rows.map(function (row) {
      return {
        componentId: Number(row.id),
        name: row.name,
        imageUrl: row.image_url,
        category: row.category,
        checkedOutQuantity: Number(row.checked_out_quantity)
      };
    }),
    protectedInventory: protectedInventory.rows.map(function (row) {
      return {
        componentId: Number(row.id),
        name: row.name,
        category: row.category,
        protectedStock: Number(row.protected_stock),
        physicalAvailable: Number(row.physical_available),
        normalAvailable: Number(row.normal_available)
      };
    }),
    orders: ordersResult.rows.map(function (order) {
      return orderView(order, items.get(Number(order.id)) || []);
    }),
    returns: Array.from(receiptMap.values()),
    returnCorrections: Array.from(correctionMap.values())
  };
}

async function processReturn(database, body, actor) {
  const teamId = positiveInteger(body.teamId, "Team ID");
  const items = (Array.isArray(body.items) ? body.items : []).map(returnInput);

  if (!items.length) {
    throw httpError(400, "Enter at least one returned item.");
  }

  return database.transaction(async function (transaction) {
    const receiptResult = await transaction.query(
      `INSERT INTO checkout_return_receipts (team_id, processed_by)
       VALUES ($1, $2) RETURNING *`,
      [teamId, actor.id]
    );
    const receipt = receiptResult.rows[0];
    const receiptCode = `R-${String(receipt.id).padStart(5, "0")}`;

    await transaction.query(
      "UPDATE checkout_return_receipts SET receipt_code = $2 WHERE id = $1",
      [receipt.id, receiptCode]
    );

    for (const item of items.sort(function (a, b) { return a.componentId - b.componentId; })) {
      const inventoryResult = await transaction.query(
        `SELECT inventory.checked_out_quantity AS team_checked_out_quantity, components.*
           FROM checkout_team_inventory inventory
           JOIN checkout_components components ON components.id = inventory.component_id
          WHERE inventory.team_id = $1 AND inventory.component_id = $2
          FOR UPDATE OF inventory, components`,
        [teamId, item.componentId]
      );
      const current = inventoryResult.rows[0];

      if (!current || Number(current.team_checked_out_quantity) < item.quantity) {
        const held = current ? Number(current.team_checked_out_quantity) : 0;
        const name = current ? current.name : `Component #${item.componentId}`;
        throw httpError(409, `${name}: this team holds ${held}, so returning ${item.quantity} is not possible.`);
      }

      await transaction.query(
        `UPDATE checkout_team_inventory
            SET checked_out_quantity = checked_out_quantity - $3
          WHERE team_id = $1 AND component_id = $2`,
        [teamId, item.componentId, item.quantity]
      );
      await transaction.query(
        `UPDATE checkout_components
            SET checked_out_quantity = checked_out_quantity - $2,
                unavailable_quantity = unavailable_quantity + $3,
                updated_at = NOW()
          WHERE id = $1`,
        [item.componentId, item.quantity, item.condition === "good" ? 0 : item.quantity]
      );
      await transaction.query(
        `INSERT INTO checkout_return_items
          (return_receipt_id, component_id, quantity, condition, note, component_name_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [receipt.id, item.componentId, item.quantity, item.condition, item.note, current.name]
      );
      const transactionType = item.condition === "good" ? "RETURN" : item.condition.toUpperCase();
      await transaction.query(
        `INSERT INTO checkout_inventory_transactions
          (component_id, team_id, admin_id, actor_user_id, transaction_type, quantity, idempotency_key, note)
         VALUES ($1, $2, $3, $3, $4, $5, $6, $7)`,
        [item.componentId, teamId, actor.id, transactionType, item.quantity,
          `return:${receipt.id}:${item.componentId}`, item.note]
      );
    }

    await transaction.query(
      `INSERT INTO checkout_activity (actor_user_id, team_id, return_receipt_id, message)
       VALUES ($1, $2, $3, $4)`,
      [actor.id, teamId, receipt.id, `${actor.display_name} processed ${receiptCode}.`]
    );
    return teamAdminDetail(transaction, teamId);
  });
}

async function correctReturn(database, body, actor) {
  const returnReceiptId = positiveInteger(body.returnReceiptId, "Return receipt ID");
  const reason = cleanString(body.reason, "Correction reason", { max: 500 });
  const items = (Array.isArray(body.items) ? body.items : []).map(function (item) {
    const correctedCondition = String(item.correctedCondition || "");
    const note = cleanString(item.note, "Correction note", { optional: true, max: 1000 });

    if (!["still_held", "good", "damaged", "missing"].includes(correctedCondition)) {
      throw httpError(400, "Corrected return condition is invalid.");
    }
    if ((correctedCondition === "damaged" || correctedCondition === "missing") && !note) {
      throw httpError(400, `A note is required when corrected hardware is ${correctedCondition}.`);
    }

    return {
      originalReturnItemId: positiveInteger(item.originalReturnItemId, "Original return item ID"),
      quantity: positiveInteger(item.quantity, "Correction quantity"),
      correctedCondition,
      note
    };
  });

  if (!items.length) {
    throw httpError(400, "Choose at least one return item to correct.");
  }

  return database.transaction(async function (transaction) {
    const receiptResult = await transaction.query(
      "SELECT * FROM checkout_return_receipts WHERE id = $1 FOR UPDATE",
      [returnReceiptId]
    );
    const originalReceipt = receiptResult.rows[0];

    if (!originalReceipt) {
      throw httpError(404, "Original return receipt not found.");
    }

    const correctionResult = await transaction.query(
      `INSERT INTO checkout_return_corrections
        (original_return_receipt_id, team_id, processed_by, reason)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [returnReceiptId, originalReceipt.team_id, actor.id, reason]
    );
    const correction = correctionResult.rows[0];
    const correctionCode = `C-${String(correction.id).padStart(5, "0")}`;
    await transaction.query("UPDATE checkout_return_corrections SET receipt_code = $2 WHERE id = $1", [correction.id, correctionCode]);

    for (const item of items.sort(function (a, b) { return a.originalReturnItemId - b.originalReturnItemId; })) {
      const originalResult = await transaction.query(
        `SELECT return_items.*, components.*,
                return_items.id AS original_return_item_id,
                return_items.quantity AS original_quantity,
                return_items.condition AS original_condition,
                COALESCE(NULLIF(return_items.component_name_snapshot, ''), components.name) AS snapshot_name
           FROM checkout_return_items return_items
           JOIN checkout_components components ON components.id = return_items.component_id
          WHERE return_items.id = $1 AND return_items.return_receipt_id = $2
          FOR UPDATE OF return_items, components`,
        [item.originalReturnItemId, returnReceiptId]
      );
      const original = originalResult.rows[0];

      if (!original) {
        throw httpError(404, "An original return item was not found on this receipt.");
      }
      if (original.original_condition === item.correctedCondition) {
        throw httpError(400, `${original.snapshot_name}: choose a condition different from the original return.`);
      }

      const correctedResult = await transaction.query(
        `SELECT COALESCE(SUM(quantity), 0) AS quantity
           FROM checkout_return_correction_items
          WHERE original_return_item_id = $1`,
        [item.originalReturnItemId]
      );
      const correctable = Number(original.original_quantity) - Number(correctedResult.rows[0].quantity);

      if (item.quantity > correctable) {
        throw httpError(409, `${original.snapshot_name}: only ${correctable} item(s) remain correctable on the original receipt.`);
      }

      const originalUnavailable = original.original_condition === "good" ? 0 : item.quantity;
      const correctedUnavailable = item.correctedCondition === "damaged" || item.correctedCondition === "missing" ? item.quantity : 0;
      const unavailableDelta = correctedUnavailable - originalUnavailable;
      const checkedOutDelta = item.correctedCondition === "still_held" ? item.quantity : 0;
      const physicalAvailable = Number(original.total_quantity) - Number(original.reserved_quantity) -
        Number(original.checked_out_quantity) - Number(original.unavailable_quantity);

      if (unavailableDelta + checkedOutDelta > physicalAvailable) {
        throw httpError(409, `${original.snapshot_name}: inventory has since been allocated, so this correction cannot be applied safely.`);
      }

      await transaction.query(
        `UPDATE checkout_components
            SET checked_out_quantity = checked_out_quantity + $2,
                unavailable_quantity = unavailable_quantity + $3,
                updated_at = NOW()
          WHERE id = $1`,
        [original.component_id, checkedOutDelta, unavailableDelta]
      );

      if (checkedOutDelta) {
        await transaction.query(
          `INSERT INTO checkout_team_inventory (team_id, component_id, checked_out_quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT (team_id, component_id) DO UPDATE
             SET checked_out_quantity = checkout_team_inventory.checked_out_quantity + EXCLUDED.checked_out_quantity`,
          [originalReceipt.team_id, original.component_id, checkedOutDelta]
        );
      }

      await transaction.query(
        `INSERT INTO checkout_return_correction_items
          (correction_receipt_id, original_return_item_id, component_id, quantity,
           original_condition, corrected_condition, note, component_name_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [correction.id, item.originalReturnItemId, original.component_id, item.quantity,
          original.original_condition, item.correctedCondition, item.note, original.snapshot_name]
      );
      await transaction.query(
        `INSERT INTO checkout_inventory_transactions
          (component_id, team_id, admin_id, actor_user_id, transaction_type, quantity, note)
         VALUES ($1, $2, $3, $3, 'RETURN_CORRECTION', $4, $5)`,
        [original.component_id, originalReceipt.team_id, actor.id, item.quantity,
          `${correctionCode}: ${original.original_condition} -> ${item.correctedCondition}. ${reason}${item.note ? ` ${item.note}` : ""}`]
      );
    }

    await transaction.query(
      `INSERT INTO checkout_activity (actor_user_id, team_id, return_correction_id, message)
       VALUES ($1, $2, $3, $4)`,
      [actor.id, originalReceipt.team_id, correction.id, `${actor.display_name} recorded ${correctionCode} correcting ${originalReceipt.receipt_code || `Return #${returnReceiptId}`}.`]
    );
    return teamAdminDetail(transaction, originalReceipt.team_id);
  });
}

async function activity(database) {
  const result = await database.query(
    `SELECT activity.*, users.display_name AS actor_name, users.role AS actor_role,
            teams.name AS team_name, orders.receipt_code AS order_receipt_code,
            return_receipts.receipt_code AS return_receipt_code,
            return_corrections.receipt_code AS return_correction_code
       FROM checkout_activity activity
       LEFT JOIN checkout_users users ON users.id = activity.actor_user_id
       LEFT JOIN checkout_teams teams ON teams.id = activity.team_id
       LEFT JOIN checkout_orders orders ON orders.id = activity.order_id
       LEFT JOIN checkout_return_receipts return_receipts ON return_receipts.id = activity.return_receipt_id
       LEFT JOIN checkout_return_corrections return_corrections ON return_corrections.id = activity.return_correction_id
      ORDER BY activity.created_at DESC LIMIT 250`
  );

  return result.rows.map(function (row) {
    const receiptType = row.order_id != null ? "order" :
      row.return_receipt_id != null ? "return" :
        row.return_correction_id != null ? "correction" : null;
    return {
      id: Number(row.id),
      actorName: row.actor_name,
      actorRole: row.actor_role,
      teamName: row.team_name,
      orderId: row.order_id == null ? null : Number(row.order_id),
      receiptType,
      receiptCode: row.order_receipt_code || row.return_receipt_code || row.return_correction_code || null,
      message: row.message,
      createdAt: row.created_at
    };
  });
}

async function activityReceipt(database, activityIdInput) {
  const activityId = positiveInteger(activityIdInput, "Activity ID");
  const result = await database.query(
    `SELECT id, team_id, order_id, return_receipt_id, return_correction_id
       FROM checkout_activity
      WHERE id = $1`,
    [activityId]
  );
  const linked = result.rows[0];

  if (!linked) {
    throw httpError(404, "Activity not found.");
  }
  if (linked.order_id != null) {
    return { receiptType: "order", order: await orderDetails(database, linked.order_id) };
  }
  if (linked.team_id == null) {
    throw httpError(404, "This activity is not linked to a receipt.");
  }

  const detail = await teamAdminDetail(database, linked.team_id);
  if (linked.return_receipt_id != null) {
    const receipt = detail.returns.find(function (item) {
      return item.id === Number(linked.return_receipt_id);
    });
    if (!receipt) throw httpError(404, "Return receipt not found.");
    return { receiptType: "return", team: detail.team, receipt };
  }
  if (linked.return_correction_id != null) {
    const receipt = detail.returnCorrections.find(function (item) {
      return item.id === Number(linked.return_correction_id);
    });
    if (!receipt) throw httpError(404, "Return correction receipt not found.");
    return { receiptType: "correction", team: detail.team, receipt };
  }

  throw httpError(404, "This activity is not linked to a receipt.");
}

async function discrepancyReport(database) {
  await expireOrders(database);
  const componentsResult = await database.query(
    `SELECT components.id, components.name, components.category, components.total_quantity,
            components.mlh_quantity, components.reserved_quantity, components.checked_out_quantity, components.unavailable_quantity,
            COALESCE(reservations.quantity, 0) AS expected_reserved,
            COALESCE(holdings.quantity, 0) AS expected_checked_out
       FROM checkout_components components
       LEFT JOIN (
         SELECT items.component_id, SUM(items.approved_quantity) AS quantity
           FROM checkout_order_items items
           JOIN checkout_orders orders ON orders.id = items.order_id
          WHERE orders.status IN ('submitted', 'reviewing', 'accepted', 'ready')
          GROUP BY items.component_id
       ) reservations ON reservations.component_id = components.id
       LEFT JOIN (
         SELECT component_id, SUM(checked_out_quantity) AS quantity
           FROM checkout_team_inventory
          GROUP BY component_id
       ) holdings ON holdings.component_id = components.id
      ORDER BY components.category, components.name`
  );
  const outstandingResult = await database.query(
    `SELECT teams.id AS team_id, teams.name AS team_name, components.id AS component_id,
            components.name AS component_name, inventory.checked_out_quantity
       FROM checkout_team_inventory inventory
       JOIN checkout_teams teams ON teams.id = inventory.team_id
       JOIN checkout_components components ON components.id = inventory.component_id
      WHERE inventory.checked_out_quantity > 0
      ORDER BY teams.name, components.name`
  );
  const outcomesResult = await database.query(
    `SELECT condition, COALESCE(SUM(quantity), 0) AS quantity
       FROM checkout_return_items
      GROUP BY condition`
  );
  const correctionsResult = await database.query("SELECT COUNT(*) AS count FROM checkout_return_corrections");
  const components = componentsResult.rows.map(function (row) {
    const mlh = Number(row.mlh_quantity || 0);
    const reserved = Number(row.reserved_quantity);
    const checkedOut = Number(row.checked_out_quantity);
    const expectedReserved = Number(row.expected_reserved);
    const expectedCheckedOut = Number(row.expected_checked_out);
    const total = Number(row.total_quantity);
    const unavailable = Number(row.unavailable_quantity);
    return {
      componentId: Number(row.id),
      name: row.name,
      category: row.category,
      totalQuantity: total,
      mlhQuantity: mlh,
      reservedQuantity: reserved,
      expectedReservedQuantity: expectedReserved,
      checkedOutQuantity: checkedOut,
      expectedCheckedOutQuantity: expectedCheckedOut,
      unavailableQuantity: unavailable,
      availableQuantity: total - mlh - reserved - checkedOut - unavailable,
      reservationDifference: reserved - expectedReserved,
      holdingDifference: checkedOut - expectedCheckedOut,
      mismatch: reserved !== expectedReserved || checkedOut !== expectedCheckedOut || mlh + reserved + checkedOut + unavailable > total
    };
  });
  const outstandingByTeam = new Map();

  outstandingResult.rows.forEach(function (row) {
    const teamId = Number(row.team_id);
    if (!outstandingByTeam.has(teamId)) {
      outstandingByTeam.set(teamId, { teamId, teamName: row.team_name, items: [], totalQuantity: 0 });
    }
    const team = outstandingByTeam.get(teamId);
    const quantity = Number(row.checked_out_quantity);
    team.items.push({ componentId: Number(row.component_id), name: row.component_name, quantity });
    team.totalQuantity += quantity;
  });
  const outcomes = { good: 0, damaged: 0, missing: 0 };
  outcomesResult.rows.forEach(function (row) { outcomes[row.condition] = Number(row.quantity); });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      components: components.length,
      componentsWithMismatches: components.filter(function (component) { return component.mismatch; }).length,
      teamsHoldingHardware: outstandingByTeam.size,
      unitsStillCheckedOut: components.reduce(function (sum, component) { return sum + component.checkedOutQuantity; }, 0),
      unitsUnavailable: components.reduce(function (sum, component) { return sum + component.unavailableQuantity; }, 0),
      unitsReserved: components.reduce(function (sum, component) { return sum + component.reservedQuantity; }, 0),
      returnCorrections: Number(correctionsResult.rows[0].count)
    },
    returnOutcomes: outcomes,
    components,
    outstandingTeams: Array.from(outstandingByTeam.values())
  };
}

module.exports = {
  catalog,
  cartAdvice,
  createTeam,
  changeAccountName,
  saveTeamProfile,
  resetTeamPassword,
  saveComponent,
  submitOrder,
  grantOrderCooldownOverride,
  createProtectedStockOverrideOrder,
  orderDetails,
  teamDashboard,
  adminOrders,
  adminOverview,
  claimOrder,
  releaseClaim,
  adjustOrder,
  transitionOrder,
  teamsList,
  teamAdminDetail,
  processReturn,
  correctReturn,
  activity,
  activityReceipt,
  discrepancyReport
};
