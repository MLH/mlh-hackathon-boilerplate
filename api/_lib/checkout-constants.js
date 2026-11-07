const CATEGORIES = [
  "Audio",
  "Button",
  "Camera",
  "Communication",
  "Distance",
  "Electronics",
  "Microcontroller",
  "Motor",
  "Motor Related",
  "Pi-related",
  "Power",
  "Sensor",
  "Tool"
];

const COMPATIBILITY = ["Arduino", "Raspberry Pi", "Arduino + Raspberry Pi", "N/A"];
const ORDER_STATUSES = ["submitted", "reviewing", "accepted", "ready", "picked_up", "cancelled", "expired"];
const RETURN_CONDITIONS = ["good", "damaged", "missing"];
const RELATIONSHIP_TYPES = ["requires", "recommends", "compatible_driver", "compatible_power_supply"];
const MAX_DISTINCT_ORDER_ITEMS = 10;
const ORDER_COOLDOWN_MINUTES = 45;
const ORDER_EXPIRATION_MINUTES = 60;

module.exports = {
  CATEGORIES,
  COMPATIBILITY,
  MAX_DISTINCT_ORDER_ITEMS,
  ORDER_COOLDOWN_MINUTES,
  ORDER_EXPIRATION_MINUTES,
  ORDER_STATUSES,
  RETURN_CONDITIONS,
  RELATIONSHIP_TYPES
};
