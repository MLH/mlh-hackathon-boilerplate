const { CATEGORIES, COMPATIBILITY, RETURN_CONDITIONS, RELATIONSHIP_TYPES } = require("./checkout-constants");

function cleanString(value, name, options) {
  const settings = options || {};
  const result = String(value == null ? "" : value).trim();

  if (!settings.optional && !result) {
    throw httpError(400, `${name} is required.`);
  }

  if (settings.max && result.length > settings.max) {
    throw httpError(400, `${name} must be ${settings.max} characters or fewer.`);
  }

  return result;
}

function positiveInteger(value, name, allowZero) {
  const result = Number(value);

  if (!Number.isInteger(result) || result < (allowZero ? 0 : 1)) {
    throw httpError(400, `${name} must be ${allowZero ? "zero or a positive" : "a positive"} whole number.`);
  }

  return result;
}

function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) {
    throw httpError(400, `${name} is invalid.`);
  }

  return value;
}

function componentInput(body) {
  const max = body.maxActivePerTeam == null || body.maxActivePerTeam === ""
    ? null
    : positiveInteger(body.maxActivePerTeam, "Maximum per team");

  const imageUrl = cleanString(body.imageUrl, "Image URL", { max: 1000, optional: true });
  const imageAlt = cleanString(body.imageAlt, "Image description", { max: 240, optional: true });
  const active = body.active !== false;
  const totalQuantity = positiveInteger(body.totalQuantity, "Total quantity", true);
  const mlhQuantity = positiveInteger(body.mlhQuantity || 0, "MLH desk quantity", true);
  const unavailableQuantity = positiveInteger(body.unavailableQuantity || 0, "Unavailable quantity", true);
  const protectedStock = positiveInteger(body.protectedStock || 0, "Protected stock", true);

  if (imageUrl && !/^https?:\/\//i.test(imageUrl) && !imageUrl.startsWith("/")) {
    throw httpError(400, "Image URL must use http(s) or be a site-relative path beginning with /.");
  }

  if (active && (!imageUrl || !imageAlt)) {
    throw httpError(400, "An active component requires both a photo and an image description.");
  }

  if (mlhQuantity + unavailableQuantity > totalQuantity) {
    throw httpError(409, "MLH desk and unavailable quantities cannot exceed total inventory.");
  }

  if (protectedStock > totalQuantity - mlhQuantity - unavailableQuantity) {
    throw httpError(409, "Protected stock cannot exceed CURC-managed usable inventory.");
  }

  return {
    name: cleanString(body.name, "Component name", { max: 120 }),
    description: cleanString(body.description, "Description", { max: 2000, optional: true }),
    imageUrl,
    imageAlt,
    category: oneOf(body.category, CATEGORIES, "Category"),
    compatibility: oneOf(body.compatibility, COMPATIBILITY, "Compatibility"),
    arduinoGuidance: cleanString(body.arduinoGuidance, "Arduino guidance", { max: 2000, optional: true }),
    raspberryPiGuidance: cleanString(body.raspberryPiGuidance, "Raspberry Pi guidance", { max: 2000, optional: true }),
    binLocation: cleanString(body.binLocation, "Bin location", { max: 240, optional: true }),
    technicalSpecs: cleanString(body.technicalSpecs, "Technical guidance", { max: 4000, optional: true }),
    totalQuantity,
    mlhQuantity,
    unavailableQuantity,
    protectedStock,
    maxActivePerTeam: max,
    active,
    adminNotes: cleanString(body.adminNotes, "Admin notes", { max: 2000, optional: true })
  };
}

function relationshipInput(item) {
  const ratio = Number(item.quantityRatio == null || item.quantityRatio === "" ? 1 : item.quantityRatio);

  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 10000) {
    throw httpError(400, "Relationship capacity ratio must be a number greater than zero.");
  }

  return {
    targetComponentId: positiveInteger(item.targetComponentId, "Related component"),
    relationType: oneOf(item.relationType, RELATIONSHIP_TYPES, "Relationship type"),
    quantityRatio: ratio,
    minimumSourceQuantity: positiveInteger(item.minimumSourceQuantity == null || item.minimumSourceQuantity === "" ? 1 : item.minimumSourceQuantity, "Relationship threshold"),
    message: cleanString(item.message, "Relationship message", { max: 1000, optional: true })
  };
}

function returnInput(item) {
  const condition = oneOf(item.condition || "good", RETURN_CONDITIONS, "Return condition");
  const note = cleanString(item.note, "Return note", { max: 1000, optional: true });

  if (condition !== "good" && !note) {
    throw httpError(400, `A note is required when hardware is ${condition}.`);
  }

  return {
    componentId: positiveInteger(item.componentId, "Component ID"),
    quantity: positiveInteger(item.quantity, "Return quantity"),
    condition,
    note
  };
}

function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

module.exports = { cleanString, positiveInteger, oneOf, componentInput, relationshipInput, returnInput, httpError };
