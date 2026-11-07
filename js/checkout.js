(function () {
  var app = document.querySelector("[data-checkout-app]");

  if (!app) {
    return;
  }

  var state = {
    user: null,
    components: [],
    cart: {},
    cartAdvice: [],
    dashboard: { orders: [], inventory: [], cooldownSeconds: 0 },
    adminOrders: [],
    adminOrdersRequestId: 0,
    teams: [],
    activity: [],
    selectedTeamId: null,
    activeAdminTab: "overview",
    mutationKeys: {},
    pollTimer: null,
    toastTimer: null,
    liveStatus: null,
    teamDetailRequestId: 0,
    openingActivityReceiptId: null
  };
  var categories = ["Audio", "Button", "Camera", "Communication", "Distance", "Electronics", "Microcontroller", "Motor", "Motor Related", "Pi-related", "Power", "Sensor", "Tool"];
  var maxDistinctCartItems = 10;
  var loadingState = document.querySelector("[data-loading-state]");
  var closedState = document.querySelector("[data-closed-state]");
  var loginState = document.querySelector("[data-login-state]");
  var teamApp = document.querySelector("[data-team-app]");
  var adminApp = document.querySelector("[data-admin-app]");
  var session = document.querySelector("[data-session]");
  var toast = document.querySelector("[data-toast]");
  var cartDialog = document.querySelector("[data-cart-dialog]");
  var orderDialog = document.querySelector("[data-order-dialog]");
  var confirmDialog = document.querySelector("[data-confirm-dialog]");
  var teamCreateDialog = document.querySelector("[data-team-create-dialog]");
  var componentDialog = document.querySelector("[data-component-dialog]");
  var imageDialog = document.querySelector("[data-image-dialog]");

  try {
    state.mutationKeys = JSON.parse(window.sessionStorage.getItem("makecu-checkout-idempotency") || "{}");
  } catch (error) {
    state.mutationKeys = {};
  }

  var saveMutationKeys = function () {
    try {
      window.sessionStorage.setItem("makecu-checkout-idempotency", JSON.stringify(state.mutationKeys));
    } catch (error) {
      // Idempotency still works for the current page when browser storage is unavailable.
    }
  };

  var escapeHtml = function (value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  var formatDate = function (value) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  };

  var statusLabel = function (status) {
    return {
      submitted: "Submitted",
      reviewing: "Reviewing",
      accepted: "Accepted",
      ready: "Ready for Pickup",
      picked_up: "Picked Up",
      cancelled: "Cancelled",
      expired: "Expired"
    }[status] || status;
  };

  var activeOrderStatus = function (status) {
    return ["submitted", "reviewing", "accepted", "ready"].indexOf(status) >= 0;
  };

  var api = async function (action, payload) {
    var response = await window.fetch("/api/checkout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    });
    var result = await response.json().catch(function () { return {}; });

    if (!response.ok) {
      var error = new Error(result.error || "The checkout system could not complete that action.");
      error.status = response.status;
      error.details = result.details;
      throw error;
    }

    return result;
  };

  var newIdempotencyKey = function () {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2);
  };

  var mutate = async function (action, payload) {
    var data = payload || {};
    var signature = action + ":" + JSON.stringify(data);
    var key = state.mutationKeys[signature] || newIdempotencyKey();

    state.mutationKeys[signature] = key;
    saveMutationKeys();

    try {
      var result = await api(action, Object.assign({}, data, { idempotencyKey: key }));
      delete state.mutationKeys[signature];
      saveMutationKeys();
      return result;
    } catch (error) {
      if (error.status && error.status < 500) {
        delete state.mutationKeys[signature];
        saveMutationKeys();
      }
      throw error;
    }
  };

  var showOnly = function (element) {
    [loadingState, closedState, loginState, teamApp, adminApp].forEach(function (candidate) {
      candidate.hidden = candidate !== element;
    });
  };

  var notify = function (message) {
    window.clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    state.toastTimer = window.setTimeout(function () {
      toast.hidden = true;
    }, 4200);
  };

  var setBusy = function (button, busy, label) {
    if (!button) {
      return;
    }

    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = label || "Working…";
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalLabel || button.textContent;
      button.disabled = false;
    }
  };

  var setSession = function (user) {
    state.user = user;
    session.hidden = !user;

    if (user) {
      var nameButton = session.querySelector("[data-change-account-name]");
      nameButton.disabled = !user.canChangeName;
      nameButton.textContent = user.canChangeName ? "Change name (once)" : "Name change used";
      session.querySelector("[data-session-name]").textContent = user.role === "team"
        ? user.teamName
        : user.displayName;
    }
  };

  var thumbnailUrl = function (url) {
    return String(url || "").replace(
      /^(\/images\/checkout\/components\/)(?!thumbnails\/)([^/?#]+\.webp)([?#].*)?$/i,
      "$1thumbnails/$2$3"
    );
  };

  var imageMarkup = function (component) {
    if (component.imageUrl) {
      return '<img src="' + escapeHtml(thumbnailUrl(component.imageUrl)) + '" alt="' + escapeHtml(component.imageAlt || component.name) + '" loading="lazy" decoding="async">';
    }

    return '<span class="checkout-component-placeholder" aria-hidden="true">' + escapeHtml(component.name.slice(0, 2).toUpperCase()) + "</span>";
  };

  var inventoryImageMarkup = function (component) {
    var content = imageMarkup(component);
    var hasPreviewImage = component.imageUrl && !/\/checkout-image-pending\.svg(?:$|[?#])/.test(component.imageUrl);

    if (!hasPreviewImage) {
      return '<div class="checkout-inventory-thumbnail">' + content + "</div>";
    }

    return '<button class="checkout-inventory-thumbnail" type="button" data-preview-component="' + component.id + '" aria-label="View a larger image of ' + escapeHtml(component.name) + '">' + content + "</button>";
  };

  var openImagePreview = function (component) {
    if (!component || !component.imageUrl || /\/checkout-image-pending\.svg(?:$|[?#])/.test(component.imageUrl)) {
      return;
    }

    imageDialog.querySelector("[data-image-dialog-title]").textContent = component.name;
    var image = imageDialog.querySelector("[data-image-dialog-image]");
    image.src = component.imageUrl;
    image.alt = component.imageAlt || component.name;
    imageDialog.showModal();
  };

  var tagTone = function (value) {
    var tones = {
      "Audio": 0,
      "Button": 4,
      "Camera": 3,
      "Communication": 1,
      "Distance": 5,
      "Electronics": 2,
      "Microcontroller": 0,
      "Motor": 4,
      "Motor Related": 3,
      "Pi-related": 1,
      "Power": 5,
      "Sensor": 2,
      "Tool": 0,
      "Arduino": 0,
      "Raspberry Pi": 1,
      "Arduino + Raspberry Pi": 3,
      "N/A": 5
    };

    if (Object.prototype.hasOwnProperty.call(tones, value)) {
      return " checkout-tag-tone-" + tones[value];
    }

    var hash = String(value).split("").reduce(function (total, character) {
      return total + character.charCodeAt(0);
    }, 0);
    return " checkout-tag-tone-" + (hash % 6);
  };

  var tagMarkup = function (value) {
    return '<span class="checkout-tag' + tagTone(value) + '">' + escapeHtml(value) + "</span>";
  };

  var itemImageMarkup = function (item) {
    if (item.imageUrl) {
      return '<img src="' + escapeHtml(thumbnailUrl(item.imageUrl)) + '" alt="' + escapeHtml(item.imageAlt || "") + '" loading="lazy" decoding="async">';
    }

    return '<span aria-hidden="true">' + escapeHtml(item.name.slice(0, 2).toUpperCase()) + "</span>";
  };

  var updateCartCounts = function () {
    var count = Object.keys(state.cart).reduce(function (total, key) {
      return total + state.cart[key];
    }, 0);

    document.querySelectorAll("[data-cart-count], [data-cart-button-count]").forEach(function (element) {
      element.textContent = count;
    });
  };

  var cartDistinctItemCount = function () {
    return Object.keys(state.cart).filter(function (key) { return state.cart[key] > 0; }).length;
  };

  var canAddCartItem = function (componentId) {
    if (state.cart[componentId] || cartDistinctItemCount() < maxDistinctCartItems) {
      return true;
    }

    notify("Each order can contain at most 10 different items.");
    return false;
  };

  var componentMaximum = function (component) {
    if (component.mlhQuantity > 0) {
      return 0;
    }

    var stockMaximum = component.teamAvailableQuantity;

    if (component.maxActivePerTeam == null) {
      return stockMaximum;
    }

    return Math.max(0, Math.min(stockMaximum, component.maxActivePerTeam - component.teamActiveQuantity));
  };

  var renderCatalog = function () {
    var grid = document.querySelector("[data-component-grid]");
    var search = document.querySelector("[data-component-search]").value.trim().toLowerCase();
    var category = document.querySelector("[data-category-filter]").value;
    var compatibility = document.querySelector("[data-compatibility-filter]").value;
    var availableOnly = document.querySelector("[data-availability-filter]").checked;
    var visible = state.components.filter(function (component) {
      var haystack = (component.name + " " + component.description).toLowerCase();
      return (!search || haystack.indexOf(search) >= 0) &&
        (!category || component.category === category) &&
        (!compatibility || component.compatibility === compatibility) &&
        (!availableOnly || componentMaximum(component) > 0 || component.mlhQuantity > 0);
    });

    if (!visible.length) {
      grid.innerHTML = '<p class="checkout-empty">No components match these filters.</p>';
      return;
    }

    grid.innerHTML = visible.map(function (component) {
      var maximum = componentMaximum(component);
      var quantity = state.cart[component.id] || 0;
      var stockClass = maximum === 0 ? " checkout-stock-out" : maximum <= 3 ? " checkout-stock-low" : "";
      var stockLabel = maximum === 0
        ? (component.availableQuantity > 0 && component.teamAvailableQuantity === 0
          ? "Protected stock only"
          : component.availableQuantity === 0 ? "Out of Stock" : "Limit Reached")
        : "Available: " + component.teamAvailableQuantity;
      var limit = component.maxActivePerTeam == null
        ? ""
        : '<p class="checkout-limit">Maximum ' + component.maxActivePerTeam + " active per team" +
          (component.teamActiveQuantity ? " · You already have/reserved " + component.teamActiveQuantity : "") + "</p>";
      var mlhNotice = component.mlhQuantity > 0
        ? '<div class="checkout-mlh-notice"><strong>Pick up at the MLH desk</strong><p>MLH listed quantity: ' + component.mlhQuantity + '. This number is not updated by CURC.</p></div>'
        : "";
      var quantityControls = component.mlhQuantity > 0
        ? ""
        : '<div class="checkout-quantity-row"><button type="button" data-quantity-change="-1" aria-label="Remove one ' + escapeHtml(component.name) + '"' + (quantity === 0 ? " disabled" : "") + '>−</button><output aria-live="polite">' + quantity + '</output><button type="button" data-quantity-change="1" aria-label="Add one ' + escapeHtml(component.name) + '"' + (quantity >= maximum ? " disabled" : "") + ">+</button></div>";

      return '<article class="checkout-component-card" data-component-id="' + component.id + '">' +
        '<div class="checkout-component-image">' + imageMarkup(component) + "</div>" +
        '<div class="checkout-component-body"><h2>' + escapeHtml(component.name) + "</h2>" +
        '<div class="checkout-tags">' + tagMarkup(component.category) + tagMarkup(component.compatibility) + (component.mlhQuantity > 0 ? tagMarkup("MLH desk") : "") + "</div>" +
        '<p class="checkout-component-description">' + escapeHtml(component.description) + "</p>" +
        (component.arduinoGuidance ? '<p class="checkout-compatibility-note"><strong>Arduino:</strong> ' + escapeHtml(component.arduinoGuidance) + "</p>" : "") +
        (component.raspberryPiGuidance ? '<p class="checkout-compatibility-note"><strong>Raspberry Pi:</strong> ' + escapeHtml(component.raspberryPiGuidance) + "</p>" : "") +
        (component.technicalSpecs ? '<p class="checkout-form-note">' + escapeHtml(component.technicalSpecs) + "</p>" : "") +
        (component.mlhQuantity > 0 ? "" : '<p class="checkout-stock' + stockClass + '">' + stockLabel + "</p>" + limit) + mlhNotice + quantityControls +
        "</div></article>";
    }).join("");
  };

  var renderCooldown = function () {
    var cooldown = document.querySelector("[data-cooldown]");
    var seconds = Math.max(0, Math.ceil(state.dashboard.cooldownSeconds));

    if (!seconds) {
      cooldown.hidden = true;
      return;
    }

    var minutes = Math.floor(seconds / 60);
    var remainder = String(seconds % 60).padStart(2, "0");
    cooldown.textContent = "You can place another order in " + String(minutes).padStart(2, "0") + ":" + remainder;
    cooldown.hidden = false;
  };

  var orderItemsMarkup = function (order, adjustable, showImages) {
    return '<div class="checkout-order-items">' + order.items.map(function (item) {
      var changed = item.approvedQuantity !== item.requestedQuantity;
      var adjustment = changed
        ? "<small>Approved " + item.approvedQuantity + " of " + item.requestedQuantity + (item.adjustmentReason ? " · " + escapeHtml(item.adjustmentReason) : "") + "</small>"
        : "";
      var controls = "";

      if (adjustable) {
        var reasons = ["", "Out of Stock", "Reached Max Per Team", "Component Unavailable", "Quantity Adjusted by Volunteer", "Other"];
        var reasonOptions = reasons.map(function (reason) {
          var label = reason || "No adjustment";
          var selected = item.adjustmentReason === reason || (!item.adjustmentReason && !reason) ? " selected" : "";
          return '<option value="' + escapeHtml(reason) + '"' + selected + ">" + escapeHtml(label) + "</option>";
        }).join("");

        controls = '<div class="checkout-approved-input"><label class="checkout-approved-quantity">Approved<input type="number" min="0" max="' + item.requestedQuantity + '" value="' + item.approvedQuantity + '" data-adjust-quantity="' + item.id + '"></label><label class="checkout-approved-reason">Reason<select data-adjust-reason="' + item.id + '">' + reasonOptions + '</select></label><label class="checkout-approved-note">Note<input maxlength="1000" data-adjust-note="' + item.id + '" value="' + escapeHtml(item.note || "") + '" placeholder="Optional volunteer note"></label></div>';
      }

      var image = showImages
        ? '<div class="checkout-order-item-image">' + itemImageMarkup(item) + "</div>"
        : "";
      var category = showImages ? '<div class="checkout-order-item-tags">' + tagMarkup(item.category) + "</div>" : "";
      var location = showImages && item.binLocation ? '<small>Location: ' + escapeHtml(item.binLocation) + "</small>" : "";

      return '<div class="checkout-order-item' + (showImages ? " checkout-order-item-with-image" : "") + '">' + image + '<span><strong>' + escapeHtml(item.name) + "</strong>" + category + location + adjustment + '</span><span class="checkout-order-item-quantity">× ' + item.approvedQuantity + "</span>" + controls + "</div>";
    }).join("") + "</div>";
  };

  var openOrderReceipt = function (order) {
    var title = order.status === "ready" ? "READY FOR PICKUP" : (order.receiptCode || "Order #" + order.id);
    var heroClass = order.status === "ready" ? " checkout-receipt-ready" : "";
    var events = order.events && order.events.length ? '<ol class="checkout-activity-list">' + order.events.map(function (event) {
      return '<li><time datetime="' + escapeHtml(event.createdAt) + '">' + formatDate(event.createdAt) + '</time><span>' + escapeHtml(event.type.replace(/_/g, " ")) + (event.actorName ? " · " + escapeHtml(event.actorName) : "") + "</span></li>";
    }).join("") + "</ol>" : "";
    orderDialog.querySelector("[data-receipt-dialog-kicker]").textContent = "ORDER RECEIPT";
    orderDialog.querySelector("[data-order-dialog-title]").textContent = title;
    orderDialog.querySelector("[data-order-dialog-body]").innerHTML =
      '<div class="checkout-receipt-hero' + heroClass + '"><span>' + escapeHtml(statusLabel(order.status).toUpperCase()) + '</span><strong>' + escapeHtml(order.receiptCode || "#" + order.id) + "</strong><span>" + escapeHtml(order.teamName) + " · " + formatDate(order.createdAt) + "</span></div>" +
      (order.protectedStockOverrideReason ? '<div class="checkout-override-notice"><strong>Protected-stock exception</strong><p>' + escapeHtml(order.protectedStockOverrideReason) + "</p></div>" : "") +
      orderItemsMarkup(order, false) +
      (activeOrderStatus(order.status) && order.reservationExpiresAt ? '<p><strong>This stage expires:</strong> ' + formatDate(order.reservationExpiresAt) + '</p>' : '') +
      (order.status === "ready" ? "<p><strong>Please bring this screen to the hardware desk.</strong></p>" : "") + events;
    orderDialog.showModal();
  };

  var activityReceiptItemsMarkup = function (items, correction) {
    return '<div class="checkout-order-items">' + items.map(function (item) {
      var outcome = correction
        ? escapeHtml(item.originalCondition) + " → " + escapeHtml(item.correctedCondition.replace("_", " "))
        : escapeHtml(item.condition);
      return '<div class="checkout-order-item"><span><strong>' + escapeHtml(item.name) + '</strong><small>' + outcome + (item.note ? " · " + escapeHtml(item.note) : "") + '</small></span><span class="checkout-order-item-quantity">× ' + item.quantity + "</span></div>";
    }).join("") + "</div>";
  };

  var openActivityReceipt = function (result) {
    if (result.receiptType === "order") {
      openOrderReceipt(result.order);
      return;
    }

    var receipt = result.receipt;
    var correction = result.receiptType === "correction";
    var label = correction ? "RETURN CORRECTION" : "RETURN";
    orderDialog.querySelector("[data-receipt-dialog-kicker]").textContent = correction ? "CORRECTION RECEIPT" : "RETURN RECEIPT";
    orderDialog.querySelector("[data-order-dialog-title]").textContent = receipt.receiptCode;
    orderDialog.querySelector("[data-order-dialog-body]").innerHTML =
      '<div class="checkout-receipt-hero"><span>' + label + '</span><strong>' + escapeHtml(receipt.receiptCode) + '</strong><span>' + escapeHtml(result.team.name) + " · " + formatDate(receipt.createdAt) + "</span></div>" +
      '<dl class="checkout-receipt-details"><div><dt>Responsible admin</dt><dd>' + escapeHtml(receipt.processedBy) + '</dd></div><div><dt>Team</dt><dd>' + escapeHtml(result.team.name) + "</dd></div>" +
      (correction ? '<div><dt>Original return</dt><dd>' + escapeHtml(receipt.originalReturnReceiptCode) + '</dd></div><div><dt>Reason</dt><dd>' + escapeHtml(receipt.reason) + "</dd></div>" : "") +
      "</dl>" + activityReceiptItemsMarkup(receipt.items, correction);
    orderDialog.showModal();
  };

  var renderTeamOrders = function () {
    var list = document.querySelector("[data-team-orders]");

    if (!state.dashboard.orders.length) {
      list.innerHTML = '<p class="checkout-empty">No orders yet. Browse components to place your first reservation.</p>';
      return;
    }

    list.innerHTML = state.dashboard.orders.map(function (order) {
      var expiry = activeOrderStatus(order.status) && order.reservationExpiresAt ? " · expires " + formatDate(order.reservationExpiresAt) : "";
      return '<article class="checkout-order-card"><div class="checkout-order-card-header"><div><h2>' + escapeHtml(order.receiptCode || "Order #" + order.id) + '</h2><p class="checkout-order-card-meta">' + formatDate(order.createdAt) + expiry + '</p></div><span class="checkout-status checkout-status-' + order.status + '">' + escapeHtml(statusLabel(order.status)) + "</span></div>" +
        orderItemsMarkup(order, false) + '<div class="checkout-order-actions"><button class="checkout-button checkout-button-secondary" type="button" data-view-order="' + order.id + '">Open receipt</button></div></article>';
    }).join("");
  };

  var renderHolding = function () {
    var grid = document.querySelector("[data-team-holding]");

    if (!state.dashboard.inventory.length) {
      grid.innerHTML = '<p class="checkout-empty">Your team is not holding any checked-out hardware.</p>';
      return;
    }

    grid.innerHTML = state.dashboard.inventory.map(function (item) {
      return '<article class="checkout-holding-card">' +
        '<div class="checkout-component-image">' + imageMarkup(item) + "</div>" +
        '<div class="checkout-component-body"><div class="checkout-tags">' + tagMarkup(item.category) + '</div><h2>' + escapeHtml(item.name) + '</h2><p class="checkout-holding-quantity">× ' + item.checkedOutQuantity + "</p></div></article>";
    }).join("");
  };

  var loadTeamData = async function (quiet) {
    try {
      var results = await Promise.all([api("catalog"), api("team-dashboard")]);
      state.components = results[0].components;
      state.dashboard = results[1];
      state.components.forEach(function (component) {
        if (component.mlhQuantity > 0) {
          delete state.cart[component.id];
        }
      });
      updateCartCounts();
      renderCatalog();
      renderCooldown();
      renderTeamOrders();
      renderHolding();
    } catch (error) {
      if (!quiet) {
        notify(error.message);
      }
    }
  };

  var renderCart = function () {
    var items = Object.keys(state.cart).map(function (id) {
      return state.components.find(function (component) { return component.id === Number(id); });
    }).filter(Boolean);
    var container = document.querySelector("[data-cart-items]");
    var submit = document.querySelector("[data-submit-order]");

    if (!items.length) {
      container.innerHTML = '<p class="checkout-empty">Your order is empty.</p>';
      submit.disabled = true;
      return;
    }

    var requiredAdvice = state.cartAdvice.some(function (item) { return item.severity === "required"; });
    submit.disabled = state.dashboard.cooldownSeconds > 0 || requiredAdvice || items.length > maxDistinctCartItems;
    var rows = items.map(function (component) {
      return '<div class="checkout-cart-row"><strong>' + escapeHtml(component.name) + '</strong><span>× ' + state.cart[component.id] + '</span><button type="button" data-cart-remove="' + component.id + '">Remove</button></div>';
    }).join("");
    var advice = state.cartAdvice.length ? '<section class="checkout-cart-advice"><h3>Compatibility check</h3>' + state.cartAdvice.map(function (item) {
      var action = item.canAddQuantity > 0
        ? '<button class="checkout-button checkout-button-secondary" type="button" data-add-related="' + item.targetComponentId + '" data-add-related-quantity="' + item.canAddQuantity + '">Add ' + item.canAddQuantity + "</button>"
        : "";
      return '<article class="checkout-advice checkout-advice-' + item.severity + '"><strong>' + escapeHtml(item.severity.toUpperCase()) + '</strong><p>' + escapeHtml(item.message) + '</p><small>You have/reserved ' + item.currentQuantity + '; calculated need: ' + item.requiredQuantity + ".</small>" + action + "</article>";
    }).join("") + "</section>" : "";
    container.innerHTML = rows + '<p class="checkout-form-note">' + items.length + ' of 10 different items used.</p>' + advice;
  };

  var loadCartAdvice = async function () {
    var items = Object.keys(state.cart).map(function (componentId) {
      return { componentId: Number(componentId), quantity: state.cart[componentId] };
    });
    state.cartAdvice = items.length ? (await api("cart-advice", { items: items })).advice : [];
    renderCart();
  };

  var teamTab = function (name) {
    document.querySelectorAll("[data-team-tab]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.teamTab === name);
    });
    document.querySelectorAll("[data-team-panel]").forEach(function (panel) {
      panel.hidden = panel.dataset.teamPanel !== name;
    });
  };

  var renderOverview = function (overview) {
    var orderCounts = overview.orders || {};
    document.querySelector("[data-admin-overview]").innerHTML =
      '<article class="checkout-metric-card"><h2>Orders</h2><dl class="checkout-metric-list"><div><dt>Submitted</dt><dd>' + (orderCounts.submitted || 0) + '</dd></div><div><dt>Reviewing</dt><dd>' + (orderCounts.reviewing || 0) + '</dd></div><div><dt>Accepted</dt><dd>' + (orderCounts.accepted || 0) + '</dd></div><div><dt>Ready</dt><dd>' + (orderCounts.ready || 0) + "</dd></div></dl></article>" +
      '<article class="checkout-metric-card"><h2>Inventory</h2><dl class="checkout-metric-list"><div><dt>Available</dt><dd>' + overview.inventory.available + '</dd></div><div><dt>Reserved</dt><dd>' + overview.inventory.reserved + '</dd></div><div><dt>Checked Out</dt><dd>' + overview.inventory.checked_out + '</dd></div><div><dt>Unavailable</dt><dd>' + overview.inventory.unavailable + "</dd></div></dl></article>" +
      '<article class="checkout-metric-card"><h2>Returns</h2><dl class="checkout-metric-list"><div><dt>Teams holding hardware</dt><dd>' + overview.teamsHoldingHardware + "</dd></div></dl></article>";
  };

  var adminOrderActions = function (order) {
    if (order.status === "submitted") {
      return '<button class="checkout-button checkout-button-primary" type="button" data-claim-order="' + order.id + '">Review Order</button>';
    }

    var claimExpired = order.status === "reviewing" && order.claimExpiresAt && new Date(order.claimExpiresAt) <= new Date();

    if (claimExpired) {
      return '<button class="checkout-button checkout-button-primary" type="button" data-claim-order="' + order.id + '">Take Over Expired Claim</button>';
    }

    if (order.status === "reviewing" && order.reviewedBy === state.user.id) {
      return '<button class="checkout-button checkout-button-secondary" type="button" data-save-adjustments="' + order.id + '">Save Adjustments</button><button class="checkout-button checkout-button-primary" type="button" data-accept-order="' + order.id + '">Accept Order</button><button class="checkout-button checkout-button-secondary" type="button" data-release-claim="' + order.id + '">Release Claim</button><button class="checkout-button checkout-button-danger" type="button" data-cancel-order="' + order.id + '">Cancel Order</button>';
    }

    if (order.status === "accepted" && order.acceptedBy === state.user.id) {
      return '<button class="checkout-button checkout-button-primary" type="button" data-mark-ready="' + order.id + '">Mark Ready for Pickup</button><button class="checkout-button checkout-button-danger" type="button" data-cancel-order="' + order.id + '">Cancel Order</button>';
    }

    if (order.status === "ready") {
      return '<button class="checkout-button checkout-button-primary" type="button" data-confirm-pickup="' + order.id + '">Confirm Pickup</button><button class="checkout-button checkout-button-danger" type="button" data-cancel-order="' + order.id + '">Cancel Order</button>';
    }

    return "";
  };

  var renderAdminOrders = function (options) {
    var list = document.querySelector("[data-admin-orders]");
    var drafts = {};
    // Capture at render time so edits made while the request was pending survive too.
    list.querySelectorAll("[data-admin-order]").forEach(function (card) {
      var orderId = Number(card.dataset.adminOrder);
      if (options && options.discardDraftOrderId === orderId) return;
      drafts[orderId] = {};
      card.querySelectorAll("[data-adjust-quantity], [data-adjust-reason], [data-adjust-note]").forEach(function (field) {
        var attribute = field.hasAttribute("data-adjust-quantity") ? "data-adjust-quantity"
          : field.hasAttribute("data-adjust-reason") ? "data-adjust-reason" : "data-adjust-note";
        drafts[orderId][attribute + ":" + field.getAttribute(attribute)] = captureFieldDraft(field);
      });
    });
    var stages = [
      { status: "submitted", label: "Submitted" },
      { status: "reviewing", label: "Reviewing" },
      { status: "accepted", label: "Accepted" },
      { status: "ready", label: "Ready for pickup" },
      { status: "picked_up", label: "Picked up" },
      { status: "cancelled", label: "Cancelled" },
      { status: "expired", label: "Expired" }
    ];

    list.innerHTML = stages.map(function (stage) {
      var orders = state.adminOrders.filter(function (order) { return order.status === stage.status; });
      var cards = orders.length ? orders.map(function (order) {
        var adjustable = order.status === "reviewing" && order.reviewedBy === state.user.id;
        var claimMeta = order.status === "reviewing" && order.claimExpiresAt ? " · claim until " + formatDate(order.claimExpiresAt) : "";
        var expiryMeta = activeOrderStatus(order.status) && order.reservationExpiresAt ? " · stage expires " + formatDate(order.reservationExpiresAt) : "";
        return '<article class="checkout-order-card checkout-order-board-card" data-admin-order="' + order.id + '"><div class="checkout-order-card-header"><div><h2>' + escapeHtml(order.receiptCode || "#" + order.id) + " — " + escapeHtml(order.teamName) + '</h2><p class="checkout-order-card-meta">Submitted ' + formatDate(order.createdAt) + (order.reviewerName ? " · " + escapeHtml(order.reviewerName) : "") + claimMeta + expiryMeta + "</p></div></div>" +
          (order.protectedStockOverrideReason ? '<div class="checkout-override-notice"><strong>Protected-stock exception</strong><p>' + escapeHtml(order.protectedStockOverrideReason) + "</p></div>" : "") +
          orderItemsMarkup(order, adjustable, true) + '<div class="checkout-order-actions">' + adminOrderActions(order) + "</div></article>";
      }).join("") : '<p class="checkout-stage-empty">No ' + stage.label.toLowerCase() + " orders.</p>";

      return '<section class="checkout-order-column checkout-order-column-' + stage.status + '"><header><span class="checkout-status checkout-status-' + stage.status + '">' + escapeHtml(stage.label) + '</span><strong>' + orders.length + '</strong></header><div class="checkout-order-column-cards">' + cards + "</div></section>";
    }).join("");

    list.querySelectorAll("[data-admin-order]").forEach(function (card) {
      var draft = drafts[card.dataset.adminOrder];
      // Only rendered review controls can receive drafts; status/ownership changes still apply.
      if (!draft) return;
      card.querySelectorAll("[data-adjust-quantity], [data-adjust-reason], [data-adjust-note]").forEach(function (field) {
        var attribute = field.hasAttribute("data-adjust-quantity") ? "data-adjust-quantity"
          : field.hasAttribute("data-adjust-reason") ? "data-adjust-reason" : "data-adjust-note";
        restoreFieldDraft(field, draft[attribute + ":" + field.getAttribute(attribute)]);
      });
    });
  };

  var loadAdminOverview = async function () {
    renderOverview(await api("admin-overview"));
  };

  var loadAdminOrders = async function () {
    var requestId = ++state.adminOrdersRequestId;
    var result = await api("admin-orders");
    if (requestId !== state.adminOrdersRequestId) return;
    state.adminOrders = result.orders;
    renderAdminOrders();
  };

  var renderTeams = function () {
    var list = document.querySelector("[data-team-list]");

    if (!state.teams.length) {
      list.innerHTML = '<p class="checkout-empty">No teams found.</p>';
      return;
    }

    list.innerHTML = state.teams.map(function (team) {
      return '<button class="checkout-team-button' + (team.id === state.selectedTeamId ? " is-active" : "") + '" type="button" data-select-team="' + team.id + '"><strong>' + escapeHtml(team.name) + '</strong><small>@' + escapeHtml(team.username) + " · " + team.checkedOutQuantity + " items out</small></button>";
    }).join("");
  };

  var loadTeams = async function () {
    var search = document.querySelector("[data-team-search]").value;
    state.teams = (await api("teams", { search: search })).teams;
    renderTeams();
  };

  var captureFieldDraft = function (field) {
    return {
      value: field.value,
      active: document.activeElement === field,
      selectionStart: typeof field.selectionStart === "number" ? field.selectionStart : null,
      selectionEnd: typeof field.selectionEnd === "number" ? field.selectionEnd : null
    };
  };

  var restoreFieldDraft = function (field, draft) {
    if (!field || !draft) {
      return;
    }

    field.value = draft.value;
    if (draft.active) {
      field.focus();
      if (draft.selectionStart != null && typeof field.setSelectionRange === "function") {
        field.setSelectionRange(draft.selectionStart, draft.selectionEnd);
      }
    }
  };

  var captureTeamDetailDraft = function (container, teamId) {
    if (Number(container.dataset.teamDetailTeam) !== Number(teamId)) {
      return null;
    }

    var draft = { returns: {}, overrides: {}, corrections: {} };
    var profile = container.querySelector("[data-team-profile-form]");
    if (profile && profile.dataset.dirty === "true") {
      draft.profile = Array.from(profile.querySelectorAll("input")).map(captureFieldDraft);
      draft.profileVersion = profile.dataset.version;
    }
    container.querySelectorAll("[data-return-component]").forEach(function (row) {
      draft.returns[row.dataset.returnComponent] = {
        quantity: captureFieldDraft(row.querySelector("[data-return-quantity]")),
        condition: captureFieldDraft(row.querySelector("[data-return-condition]")),
        note: captureFieldDraft(row.querySelector("[data-return-note]"))
      };
    });
    container.querySelectorAll("[data-override-component]").forEach(function (row) {
      draft.overrides[row.dataset.overrideComponent] = captureFieldDraft(row.querySelector("[data-override-quantity]"));
    });

    var protectedOrder = container.querySelector(".checkout-protected-order");
    if (protectedOrder) {
      draft.protectedOrder = {
        open: protectedOrder.open,
        reason: captureFieldDraft(protectedOrder.querySelector("[data-override-reason]"))
      };
    }

    container.querySelectorAll("[data-correction-receipt]").forEach(function (correction) {
      var correctionDraft = {
        open: correction.open,
        reason: captureFieldDraft(correction.querySelector("[data-correction-reason]")),
        items: {}
      };
      correction.querySelectorAll("[data-correction-item]").forEach(function (row) {
        correctionDraft.items[row.dataset.correctionItem] = {
          quantity: captureFieldDraft(row.querySelector("[data-correction-quantity]")),
          condition: captureFieldDraft(row.querySelector("[data-correction-condition]")),
          note: captureFieldDraft(row.querySelector("[data-correction-note]"))
        };
      });
      draft.corrections[correction.dataset.correctionReceipt] = correctionDraft;
    });
    return draft;
  };

  var restoreTeamDetailDraft = function (container, draft) {
    if (!draft) {
      return;
    }

    var profile = container.querySelector("[data-team-profile-form]");
    if (profile && draft.profile) {
      profile.dataset.dirty = "true";
      profile.dataset.version = draft.profileVersion;
      profile.querySelectorAll("input").forEach(function (field, index) { restoreFieldDraft(field, draft.profile[index]); });
    }

    container.querySelectorAll("[data-return-component]").forEach(function (row) {
      var rowDraft = draft.returns[row.dataset.returnComponent];
      if (!rowDraft) return;
      restoreFieldDraft(row.querySelector("[data-return-quantity]"), rowDraft.quantity);
      restoreFieldDraft(row.querySelector("[data-return-condition]"), rowDraft.condition);
      restoreFieldDraft(row.querySelector("[data-return-note]"), rowDraft.note);
    });
    container.querySelectorAll("[data-override-component]").forEach(function (row) {
      restoreFieldDraft(row.querySelector("[data-override-quantity]"), draft.overrides[row.dataset.overrideComponent]);
    });

    var protectedOrder = container.querySelector(".checkout-protected-order");
    if (protectedOrder && draft.protectedOrder) {
      protectedOrder.open = draft.protectedOrder.open;
      restoreFieldDraft(protectedOrder.querySelector("[data-override-reason]"), draft.protectedOrder.reason);
    }

    container.querySelectorAll("[data-correction-receipt]").forEach(function (correction) {
      var correctionDraft = draft.corrections[correction.dataset.correctionReceipt];
      if (!correctionDraft) return;
      correction.open = correctionDraft.open;
      restoreFieldDraft(correction.querySelector("[data-correction-reason]"), correctionDraft.reason);
      correction.querySelectorAll("[data-correction-item]").forEach(function (row) {
        var rowDraft = correctionDraft.items[row.dataset.correctionItem];
        if (!rowDraft) return;
        restoreFieldDraft(row.querySelector("[data-correction-quantity]"), rowDraft.quantity);
        restoreFieldDraft(row.querySelector("[data-correction-condition]"), rowDraft.condition);
        restoreFieldDraft(row.querySelector("[data-correction-note]"), rowDraft.note);
      });
    });
  };

  var teamDetailHasDraft = function () {
    var container = document.querySelector("[data-team-detail]");
    if (!container || !container.dataset.teamDetailTeam) {
      return false;
    }
    if (container.querySelector('[data-team-profile-form][data-dirty="true"]')) return true;

    if (container.querySelector(".checkout-protected-order[open], .checkout-return-correction[open]")) {
      return true;
    }

    return Array.prototype.some.call(container.querySelectorAll(
      "[data-return-quantity], [data-return-note], [data-override-quantity], [data-override-reason], [data-correction-quantity], [data-correction-note], [data-correction-reason]"
    ), function (field) {
      return String(field.value || "").trim() !== "" && String(field.value) !== "0";
    }) || Array.prototype.some.call(container.querySelectorAll("[data-return-condition]"), function (field) {
      return field.value !== "good";
    }) || Array.prototype.some.call(container.querySelectorAll("[data-correction-condition]"), function (field) {
      return field.value !== "still_held";
    });
  };

  var renderTeamDetail = function (detail, options) {
    var container = document.querySelector("[data-team-detail]");
    var draft = options && options.preserveDraft === false
      ? null
      : captureTeamDetailDraft(container, detail.team.id);
    var holding = detail.inventory.length ? detail.inventory.map(function (item) {
      return '<div class="checkout-return-row" data-return-component="' + item.componentId + '"><strong>' + escapeHtml(item.name) + '<span>Currently holding ' + item.checkedOutQuantity + '</span></strong><label>Return now<input type="number" min="0" max="' + item.checkedOutQuantity + '" value="0" data-return-quantity></label><label>Condition<select data-return-condition><option value="good">Good</option><option value="damaged">Damaged</option><option value="missing">Missing</option></select></label><label>Note<input maxlength="1000" placeholder="Required if damaged/missing" data-return-note></label></div>';
    }).join("") + '<div class="checkout-order-actions"><button class="checkout-button checkout-button-primary" type="button" data-process-return="' + detail.team.id + '">Process Return</button></div>' : '<p class="checkout-empty">This team has returned all checked-out hardware.</p>';
    var receipts = detail.returns.length ? detail.returns.map(function (receipt) {
      var correctableItems = receipt.items.filter(function (item) { return item.correctableQuantity > 0; });
      var correctionForm = correctableItems.length ? '<details class="checkout-return-correction" data-correction-receipt="' + receipt.id + '"><summary>Correct this receipt</summary><p class="checkout-form-note">This adds a correction receipt; the original remains unchanged.</p>' + correctableItems.map(function (item) {
        return '<div class="checkout-correction-row" data-correction-item="' + item.id + '"><strong>' + escapeHtml(item.name) + '<span>Original: ' + escapeHtml(item.condition) + ' · up to ' + item.correctableQuantity + '</span></strong><label>Quantity<input type="number" min="0" max="' + item.correctableQuantity + '" value="0" data-correction-quantity></label><label>Correct outcome<select data-correction-condition><option value="still_held">Still held by team</option><option value="good">Returned good</option><option value="damaged">Returned damaged</option><option value="missing">Missing</option></select></label><label>Item note<input maxlength="1000" data-correction-note placeholder="Required for damaged/missing"></label></div>';
      }).join("") + '<label>Required correction reason<textarea rows="2" maxlength="500" data-correction-reason placeholder="What was entered incorrectly?"></textarea></label><div class="checkout-order-actions"><button class="checkout-button checkout-button-danger" type="button" data-correct-return="' + receipt.id + '">Record correction</button></div></details>' : "";
      return '<article class="checkout-receipt"><strong>' + escapeHtml(receipt.receiptCode || "R-" + receipt.id) + '</strong><p>' + formatDate(receipt.createdAt) + " · " + escapeHtml(receipt.processedBy) + '</p><p>' + receipt.items.map(function (item) { return item.quantity + " × " + escapeHtml(item.name) + " — " + escapeHtml(item.condition) + (item.note ? " · " + escapeHtml(item.note) : ""); }).join("<br>") + "</p>" + correctionForm + "</article>";
    }).join("") : '<p class="checkout-empty">No return receipts yet.</p>';
    var corrections = detail.returnCorrections && detail.returnCorrections.length ? detail.returnCorrections.map(function (correction) {
      return '<article class="checkout-receipt checkout-correction-receipt"><strong>' + escapeHtml(correction.receiptCode) + '</strong><p>' + formatDate(correction.createdAt) + " · " + escapeHtml(correction.processedBy) + '</p><p><strong>Reason:</strong> ' + escapeHtml(correction.reason) + '</p><p>' + correction.items.map(function (item) {
        return item.quantity + " × " + escapeHtml(item.name) + ": " + escapeHtml(item.originalCondition) + " → " + escapeHtml(item.correctedCondition.replace("_", " ")) + (item.note ? " · " + escapeHtml(item.note) : "");
      }).join("<br>") + "</p></article>";
    }).join("") : "";
    var orders = detail.orders.length ? detail.orders.map(function (order) {
      return '<button class="checkout-team-button" type="button" data-view-admin-order="' + order.id + '"><strong>Order #' + order.id + '</strong><small>' + escapeHtml(statusLabel(order.status)) + " · " + formatDate(order.createdAt) + "</small></button>";
    }).join("") : '<p class="checkout-empty">No orders yet.</p>';
    var protectedOrder = detail.protectedInventory && detail.protectedInventory.length
      ? '<details class="checkout-protected-order"><summary>Create protected-stock exception</summary><p class="checkout-form-note">Use only for an organizer-approved exception. The quantity must consume protected reserve, and a reason is required.</p>' + detail.protectedInventory.map(function (item) {
        return '<div class="checkout-override-row" data-override-component="' + item.componentId + '"><strong>' + escapeHtml(item.name) + '<span>Normally available ' + item.normalAvailable + ' · physically available ' + item.physicalAvailable + '</span></strong><label>Quantity<input type="number" min="0" max="' + item.physicalAvailable + '" value="0" data-override-quantity></label></div>';
      }).join("") + '<label>Required override reason<textarea maxlength="500" rows="2" data-override-reason placeholder="Why should protected stock be released for this team?"></textarea></label><div class="checkout-order-actions"><button class="checkout-button checkout-button-danger" type="button" data-create-protected-order="' + detail.team.id + '">Create exception order</button></div></details>'
      : "";
    var cooldown = detail.cooldown || { policySecondsLeft: 0, overrideAvailable: false };
    var cooldownMinutes = Math.ceil(cooldown.policySecondsLeft / 60);
    var timeoutControl = cooldown.policySecondsLeft > 0
      ? '<section class="checkout-override-notice"><strong>45-minute order timeout</strong><p>' +
        (cooldown.overrideAvailable
          ? 'A one-order exception is ready for this team. It will be consumed by their next successful order.'
          : 'This team can normally order again in about ' + cooldownMinutes + ' minute(s).') +
        '</p>' + (cooldown.overrideAvailable ? '' : '<button class="checkout-button checkout-button-secondary" type="button" data-remove-order-timeout="' + detail.team.id + '">Grant one-order exception</button>') + '</section>'
      : '';

    var profile = '<aside class="checkout-team-profile"><form class="checkout-form" data-team-profile-form data-version="' + detail.team.profileVersion + '"><h3>Team members & contact</h3><p class="checkout-form-note">Only admins can add or change these details. Leave unused names blank.</p>' +
      [0, 1, 2, 3].map(function (index) {
        return '<label>Member ' + (index + 1) + '<input name="member' + index + '" maxlength="120" autocomplete="off" value="' + escapeHtml((detail.team.memberNames || [])[index] || '') + '"></label>';
      }).join('') + '<label>Contact email<input name="contactEmail" type="email" maxlength="254" autocomplete="off" value="' + escapeHtml(detail.team.contactEmail || '') + '"></label><p class="checkout-form-error" data-profile-error role="alert" hidden></p><button class="checkout-button checkout-button-primary" type="submit">Save team details</button><button class="checkout-button checkout-button-secondary" type="button" data-reload-team-profile>Reload saved details</button></form></aside>';
    container.innerHTML = '<div class="checkout-team-detail-grid"><div class="checkout-team-history"><div class="checkout-order-card-header"><div><span class="checkout-kicker">TEAM</span><h2>' + escapeHtml(detail.team.name) + '</h2><p class="checkout-order-card-meta">' + escapeHtml(detail.team.identifier) + '</p></div><button class="checkout-button checkout-button-secondary" type="button" data-reset-password="' + detail.team.id + '">Reset password</button></div>' + timeoutControl + '<h3 class="checkout-section-title">Currently Holding</h3>' + holding + protectedOrder + '<h3 class="checkout-section-title">Orders & Pickup History</h3>' + orders + '<h3 class="checkout-section-title">Return History</h3>' + receipts + corrections + '</div>' + profile + '</div>';
    container.dataset.teamDetailTeam = detail.team.id;
    restoreTeamDetailDraft(container, draft);
  };

  var loadTeamDetail = async function (teamId, options) {
    var requestedTeamId = Number(teamId);
    var requestId = ++state.teamDetailRequestId;
    state.selectedTeamId = requestedTeamId;
    renderTeams();
    var detail = await api("team-detail", { teamId: requestedTeamId });
    if (state.selectedTeamId !== requestedTeamId || requestId !== state.teamDetailRequestId) {
      return;
    }
    if (options && options.polling && teamDetailHasDraft()) {
      return;
    }
    renderTeamDetail(detail, options);
  };

  var renderInventory = function () {
    var search = document.querySelector("[data-inventory-search]").value.trim().toLowerCase();
    var category = document.querySelector("[data-inventory-category-filter]").value;
    var compatibility = document.querySelector("[data-inventory-compatibility-filter]").value;
    var visible = state.components.filter(function (component) {
      return (!search || component.name.toLowerCase().indexOf(search) >= 0) &&
        (!category || component.category === category) &&
        (!compatibility || component.compatibility === compatibility);
    });

    document.querySelector("[data-inventory-table]").innerHTML = visible.length ? visible.map(function (component) {
      var source = component.mlhQuantity > 0 ? ' · MLH listed: ' + component.mlhQuantity : "";
      return '<tr><td><div class="checkout-inventory-component">' + inventoryImageMarkup(component) + '<span><strong>' + escapeHtml(component.name) + '</strong><small>' + escapeHtml(component.category) + ' · ' + escapeHtml(component.compatibility) + source + (component.active ? "" : " · Disabled") + '</small></span></div></td><td>' + component.availableQuantity + '</td><td>' + component.reservedQuantity + '</td><td>' + component.checkedOutQuantity + '</td><td>' + component.unavailableQuantity + '</td><td>' + component.totalQuantity + '</td><td><button class="checkout-button checkout-button-secondary" type="button" data-edit-component="' + component.id + '">Edit</button></td></tr>';
    }).join("") : '<tr><td class="checkout-empty" colspan="7">No components match those filters.</td></tr>';
  };

  var loadInventory = async function () {
    state.components = (await api("catalog")).components;
    renderInventory();
  };

  var renderActivity = function () {
    var search = document.querySelector("[data-activity-search]").value.trim().toLowerCase();
    var items = state.activity.filter(function (item) {
      var haystack = [item.message, item.actorName, item.teamName, item.orderId == null ? "" : "order " + item.orderId, item.receiptType, item.receiptCode, formatDate(item.createdAt)].join(" ").toLowerCase();
      return !search || haystack.indexOf(search) >= 0;
    });

    document.querySelector("[data-activity-list]").innerHTML = items.length ? items.map(function (item) {
      var meta = [
        item.actorName ? (item.actorRole === "admin" ? "Admin: " : "Actor: ") + escapeHtml(item.actorName) : "System",
        item.teamName ? "Team: " + escapeHtml(item.teamName) : "No team"
      ].join(" · ");
      var content = '<time datetime="' + escapeHtml(item.createdAt) + '">' + formatDate(item.createdAt) + '</time><span><strong>' + escapeHtml(item.message) + '</strong><small>' + meta + "</small></span>";
      if (item.receiptType) {
        return '<li class="checkout-activity-receipt"><button type="button" data-view-activity-receipt="' + item.id + '">' + content + '<em>View ' + escapeHtml(item.receiptCode || "receipt") + "</em></button></li>";
      }
      return "<li>" + content + "</li>";
    }).join("") : '<li class="checkout-empty">' + (search ? "No activity matches that search." : "No activity yet.") + "</li>";
  };

  var loadActivity = async function () {
    state.activity = (await api("activity")).activity;
    renderActivity();
  };

  var renderDiscrepancyReport = function (report) {
    var summary = report.summary;
    var flagged = report.components.filter(function (component) { return component.mismatch; });
    var componentRows = report.components.map(function (component) {
      return '<tr class="' + (component.mismatch ? "checkout-report-mismatch" : "") + '"><td><strong>' + escapeHtml(component.name) + '</strong><br><small>' + escapeHtml(component.category) + '</small></td><td>' + component.reservedQuantity + ' / ' + component.expectedReservedQuantity + '</td><td>' + component.checkedOutQuantity + ' / ' + component.expectedCheckedOutQuantity + '</td><td>' + component.unavailableQuantity + '</td><td>' + component.availableQuantity + '</td><td>' + (component.mismatch ? "Review" : "Balanced") + "</td></tr>";
    }).join("");
    var teams = report.outstandingTeams.length ? report.outstandingTeams.map(function (team) {
      return '<article class="checkout-report-team"><h3>' + escapeHtml(team.teamName) + ' <span>' + team.totalQuantity + ' unit' + (team.totalQuantity === 1 ? "" : "s") + '</span></h3><p>' + team.items.map(function (item) { return item.quantity + " × " + escapeHtml(item.name); }).join("<br>") + "</p></article>";
    }).join("") : '<p class="checkout-empty">No teams are holding hardware.</p>';

    document.querySelector("[data-discrepancy-report]").innerHTML =
      '<p class="checkout-report-generated">Generated ' + formatDate(report.generatedAt) + '</p><div class="checkout-overview-grid"><article class="checkout-metric-card"><h2>Reconciliation</h2><dl class="checkout-metric-list"><div><dt>Counter mismatches</dt><dd>' + summary.componentsWithMismatches + '</dd></div><div><dt>Components checked</dt><dd>' + summary.components + '</dd></div></dl></article><article class="checkout-metric-card"><h2>Outstanding</h2><dl class="checkout-metric-list"><div><dt>Teams holding hardware</dt><dd>' + summary.teamsHoldingHardware + '</dd></div><div><dt>Units still out</dt><dd>' + summary.unitsStillCheckedOut + '</dd></div><div><dt>Units reserved</dt><dd>' + summary.unitsReserved + '</dd></div></dl></article><article class="checkout-metric-card"><h2>Return outcomes</h2><dl class="checkout-metric-list"><div><dt>Damaged</dt><dd>' + report.returnOutcomes.damaged + '</dd></div><div><dt>Missing</dt><dd>' + report.returnOutcomes.missing + '</dd></div><div><dt>Corrections</dt><dd>' + summary.returnCorrections + '</dd></div></dl></article></div>' +
      (flagged.length ? '<div class="checkout-override-notice"><strong>Action required</strong><p>' + flagged.length + ' component counter' + (flagged.length === 1 ? " does" : "s do") + ' not match the underlying orders or team holdings.</p></div>' : "") +
      '<h2 class="checkout-section-title">Component reconciliation</h2><div class="checkout-inventory-table-wrap"><table class="checkout-table"><thead><tr><th>Component</th><th>Reserved / orders</th><th>Out / teams</th><th>Unavailable</th><th>Available</th><th>Status</th></tr></thead><tbody>' + componentRows + '</tbody></table></div><h2 class="checkout-section-title">Outstanding team holdings</h2><div class="checkout-report-teams">' + teams + "</div>";
  };

  var loadDiscrepancyReport = async function () {
    renderDiscrepancyReport(await api("discrepancy-report"));
  };

  var adminTab = async function (name) {
    state.activeAdminTab = name;
    document.querySelectorAll("[data-admin-tab]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.adminTab === name);
    });
    document.querySelectorAll("[data-admin-panel]").forEach(function (panel) {
      panel.hidden = panel.dataset.adminPanel !== name;
    });

    try {
      if (name === "overview") {
        await loadAdminOverview();
      } else if (name === "orders") {
        await loadAdminOrders();
      } else if (name === "teams") {
        await loadTeams();
      } else if (name === "inventory") {
        await loadInventory();
      } else if (name === "activity") {
        await loadActivity();
      } else if (name === "report") {
        await loadDiscrepancyReport();
      }
    } catch (error) {
      notify(error.message);
    }
  };

  var confirmAction = function (title, message, buttonLabel) {
    return new Promise(function (resolve) {
      confirmDialog.querySelector("[data-confirm-title]").textContent = title;
      confirmDialog.querySelector("[data-confirm-body]").textContent = message;
      var accept = confirmDialog.querySelector("[data-confirm-accept]");
      var cancel = confirmDialog.querySelector("[data-confirm-cancel]");
      accept.textContent = buttonLabel || "Confirm";

      var finish = function (value) {
        accept.removeEventListener("click", acceptAction);
        cancel.removeEventListener("click", cancelAction);
        confirmDialog.close();
        resolve(value);
      };
      var acceptAction = function () { finish(true); };
      var cancelAction = function () { finish(false); };
      accept.addEventListener("click", acceptAction);
      cancel.addEventListener("click", cancelAction);
      confirmDialog.showModal();
    });
  };

  var beginPolling = function () {
    window.clearInterval(state.pollTimer);
    state.pollTimer = window.setInterval(function () {
      if (state.user && state.user.role === "team") {
        loadTeamData(true);
      } else if (state.user && state.user.role === "admin") {
        loadAdminOverview().catch(function () {});
        if (state.activeAdminTab === "orders") {
          loadAdminOrders().catch(function () {});
        } else if (state.activeAdminTab === "teams") {
          loadTeams().catch(function () {});
          if (state.selectedTeamId) {
            loadTeamDetail(state.selectedTeamId, { polling: true }).catch(function () {});
          }
        } else if (state.activeAdminTab === "inventory") {
          loadInventory().catch(function () {});
        } else if (state.activeAdminTab === "activity") {
          loadActivity().catch(function () {});
        } else if (state.activeAdminTab === "report") {
          loadDiscrepancyReport().catch(function () {});
        }
      }
    }, 5000);
  };

  var enterApplication = async function (user) {
    setSession(user);

    if (user.role === "team") {
      showOnly(teamApp);
      await loadTeamData();
    } else {
      showOnly(adminApp);
      await adminTab("overview");
    }

    beginPolling();
  };

  var initialize = async function () {
    try {
      var response = await window.fetch("/api/checkout?action=status", { credentials: "same-origin" });
      var statusResult = await response.json();
      state.liveStatus = statusResult.status;

      if (!statusResult.status.live) {
        document.querySelector("[data-live-start]").textContent = formatDate(statusResult.status.startsAt);
        document.querySelector("[data-live-end]").textContent = formatDate(statusResult.status.endsAt);
        try {
          var closedMe = await api("me");
          if (closedMe.user.role === "admin") {
            await enterApplication(closedMe.user);
            return;
          }
        } catch (error) {
          if (error.status !== 401 && error.status !== 423) throw error;
        }
        setSession(null);
        showOnly(closedState);
        return;
      }

      try {
        var me = await api("me");
        await enterApplication(me.user);
      } catch (error) {
        if (error.status === 401) {
          setSession(null);
          showOnly(loginState);
        } else {
          throw error;
        }
      }
    } catch (error) {
      loadingState.querySelector("h1").textContent = "The hardware desk is temporarily unavailable.";
      loadingState.insertAdjacentHTML("beforeend", '<p class="checkout-form-error">' + escapeHtml(error.message) + "</p>");
    }
  };

  document.querySelector("[data-closed-admin-login]").addEventListener("click", function () {
    document.querySelector("[data-login-title]").textContent = "Organizer login";
    document.querySelector("[data-login-note]").textContent = "Only admin accounts can sign in outside the live hackathon window.";
    showOnly(loginState);
  });

  document.querySelector("[data-login-form]").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var errorElement = document.querySelector("[data-login-error]");
    var button = form.querySelector("button[type=submit]");
    errorElement.hidden = true;
    setBusy(button, true, "Signing in…");

    try {
      var result = await api("login", { username: form.username.value, password: form.password.value });
      form.reset();
      await enterApplication(result.user);
    } catch (error) {
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    } finally {
      setBusy(button, false);
    }
  });

  document.querySelector("[data-logout]").addEventListener("click", async function () {
    await api("logout").catch(function () {});
    window.clearInterval(state.pollTimer);
    setSession(null);
    showOnly(state.liveStatus && !state.liveStatus.live ? closedState : loginState);
  });

  document.querySelectorAll("[data-team-tab]").forEach(function (button) {
    button.addEventListener("click", function () { teamTab(button.dataset.teamTab); });
  });

  ["[data-component-search]", "[data-category-filter]", "[data-compatibility-filter]", "[data-availability-filter]"].forEach(function (selector) {
    document.querySelector(selector).addEventListener("input", renderCatalog);
  });

  document.querySelector("[data-component-grid]").addEventListener("click", function (event) {
    var button = event.target.closest("[data-quantity-change]");

    if (!button) {
      return;
    }

    var card = button.closest("[data-component-id]");
    var componentId = Number(card.dataset.componentId);
    var component = state.components.find(function (item) { return item.id === componentId; });
    var next = (state.cart[componentId] || 0) + Number(button.dataset.quantityChange);

    if (next > 0 && !canAddCartItem(componentId)) {
      return;
    }

    state.cart[componentId] = Math.max(0, Math.min(componentMaximum(component), next));

    if (!state.cart[componentId]) {
      delete state.cart[componentId];
    }

    updateCartCounts();
    renderCatalog();
  });

  document.querySelector("[data-open-cart]").addEventListener("click", function () {
    state.cartAdvice = [];
    renderCart();
    document.querySelector("[data-cart-error]").hidden = true;
    cartDialog.showModal();
    loadCartAdvice().catch(function (error) { notify(error.message); });
  });
  document.querySelector("[data-cart-close]").addEventListener("click", function () { cartDialog.close(); });
  document.querySelector("[data-cart-items]").addEventListener("click", function (event) {
    var button = event.target.closest("[data-cart-remove]");
    var relatedButton = event.target.closest("[data-add-related]");

    if (button) {
      delete state.cart[button.dataset.cartRemove];
      updateCartCounts();
      renderCart();
      renderCatalog();
      loadCartAdvice().catch(function (error) { notify(error.message); });
    } else if (relatedButton) {
      var componentId = Number(relatedButton.dataset.addRelated);
      if (!canAddCartItem(componentId)) {
        return;
      }
      var component = state.components.find(function (item) { return item.id === componentId; });
      var next = (state.cart[componentId] || 0) + Number(relatedButton.dataset.addRelatedQuantity);
      state.cart[componentId] = Math.min(componentMaximum(component), next);
      updateCartCounts();
      renderCatalog();
      loadCartAdvice().catch(function (error) { notify(error.message); });
    }
  });
  document.querySelector("[data-submit-order]").addEventListener("click", async function (event) {
    var button = event.currentTarget;
    var errorElement = document.querySelector("[data-cart-error]");
    var items = Object.keys(state.cart).map(function (componentId) {
      return { componentId: Number(componentId), quantity: state.cart[componentId] };
    });
    errorElement.hidden = true;
    setBusy(button, true, "Reserving…");

    try {
      var result = await mutate("submit-order", { items: items });
      state.cart = {};
      updateCartCounts();
      cartDialog.close();
      await loadTeamData();
      teamTab("orders");
      openOrderReceipt(result.order);
      notify("Order #" + result.order.id + " is reserved and waiting for review.");
    } catch (error) {
      var details = error.details && error.details.items
        ? " " + error.details.items.map(function (item) { return item.message; }).join(" ")
        : "";
      errorElement.textContent = error.message + details;
      errorElement.hidden = false;
    } finally {
      setBusy(button, false);
    }
  });

  document.querySelector("[data-team-orders]").addEventListener("click", function (event) {
    var button = event.target.closest("[data-view-order]");

    if (button) {
      var order = state.dashboard.orders.find(function (item) { return item.id === Number(button.dataset.viewOrder); });
      openOrderReceipt(order);
    }
  });

  document.querySelectorAll("[data-admin-tab]").forEach(function (button) {
    button.addEventListener("click", function () { adminTab(button.dataset.adminTab); });
  });
  document.querySelector("[data-refresh-orders]").addEventListener("click", loadAdminOrders);
  document.querySelector("[data-refresh-report]").addEventListener("click", function () {
    loadDiscrepancyReport().catch(function (error) { notify(error.message); });
  });
  document.querySelector("[data-admin-orders]").addEventListener("click", async function (event) {
    var actionButton = event.target.closest("button[data-claim-order], button[data-save-adjustments], button[data-accept-order], button[data-release-claim], button[data-mark-ready], button[data-confirm-pickup], button[data-cancel-order]");

    if (!actionButton) {
      return;
    }

    var orderId = Number(actionButton.dataset.claimOrder || actionButton.dataset.saveAdjustments || actionButton.dataset.acceptOrder || actionButton.dataset.releaseClaim || actionButton.dataset.markReady || actionButton.dataset.confirmPickup || actionButton.dataset.cancelOrder);
    var order = state.adminOrders.find(function (item) { return item.id === orderId; });

    try {
      if (actionButton.hasAttribute("data-claim-order")) {
        setBusy(actionButton, true, "Claiming…");
        await mutate("claim-order", { orderId: orderId });
        notify("Order #" + orderId + " is assigned to you.");
      } else if (actionButton.hasAttribute("data-save-adjustments")) {
        var card = actionButton.closest("[data-admin-order]");
        var items = order.items.map(function (item) {
          return {
            itemId: item.id,
            approvedQuantity: Number(card.querySelector('[data-adjust-quantity="' + item.id + '"]').value),
            reason: card.querySelector('[data-adjust-reason="' + item.id + '"]').value,
            note: card.querySelector('[data-adjust-note="' + item.id + '"]').value
          };
        });
        setBusy(actionButton, true, "Saving…");
        var saved = await mutate("adjust-order", { orderId: orderId, items: items });
        // Apply the confirmed values before refreshing, and invalidate older polling responses.
        state.adminOrdersRequestId += 1;
        state.adminOrders = state.adminOrders.map(function (item) { return item.id === orderId ? saved.order : item; });
        renderAdminOrders({ discardDraftOrderId: orderId });
        notify("Approved quantities saved.");
      } else if (actionButton.hasAttribute("data-accept-order")) {
        if (!(await confirmAction("Accept Order #" + orderId + "?", "Approved quantities will be finalized. Mark the order ready only after gathering every approved component.", "Accept Order"))) {
          return;
        }
        await mutate("accept-order", { orderId: orderId });
        notify("Order #" + orderId + " was accepted.");
      } else if (actionButton.hasAttribute("data-release-claim")) {
        await mutate("release-claim", { orderId: orderId });
        notify("Order #" + orderId + " is available for another volunteer.");
      } else if (actionButton.hasAttribute("data-mark-ready")) {
        if (!(await confirmAction("Mark Order #" + orderId + " ready?", "Confirm that every approved component has been physically prepared. Inventory remains reserved until pickup.", "Mark Ready"))) {
          return;
        }
        await mutate("mark-ready", { orderId: orderId });
        notify("Order #" + orderId + " is ready for pickup.");
      } else if (actionButton.hasAttribute("data-confirm-pickup")) {
        var total = order.items.reduce(function (sum, item) { return sum + item.approvedQuantity; }, 0);
        if (!(await confirmAction("Confirm pickup for Order #" + orderId + "?", "You are handing " + total + " component" + (total === 1 ? "" : "s") + " to " + order.teamName + ". This moves inventory from reserved to checked out.", "Confirm Pickup"))) {
          return;
        }
        await mutate("confirm-pickup", { orderId: orderId });
        notify("Pickup recorded for Order #" + orderId + ".");
      } else if (actionButton.hasAttribute("data-cancel-order")) {
        if (!(await confirmAction("Cancel Order #" + orderId + "?", "All reserved quantities in this order will be released back to available inventory.", "Cancel Order"))) {
          return;
        }
        await mutate("cancel-order", { orderId: orderId });
        notify("Order #" + orderId + " was cancelled.");
      }

      await Promise.all([loadAdminOrders(), loadAdminOverview()]);
    } catch (error) {
      notify(error.message);
      await loadAdminOrders().catch(function () {});
    } finally {
      setBusy(actionButton, false);
    }
  });

  var teamSearchTimer;
  document.querySelector("[data-team-search]").addEventListener("input", function () {
    window.clearTimeout(teamSearchTimer);
    teamSearchTimer = window.setTimeout(function () { loadTeams().catch(function (error) { notify(error.message); }); }, 220);
  });

  ["[data-inventory-search]", "[data-inventory-category-filter]", "[data-inventory-compatibility-filter]"].forEach(function (selector) {
    document.querySelector(selector).addEventListener("input", renderInventory);
  });
  document.querySelector("[data-activity-search]").addEventListener("input", renderActivity);
  document.querySelector("[data-activity-list]").addEventListener("click", async function (event) {
    var button = event.target.closest("[data-view-activity-receipt]");
    if (!button) return;
    var activityId = Number(button.dataset.viewActivityReceipt);
    if (state.openingActivityReceiptId != null) return;
    state.openingActivityReceiptId = activityId;
    setBusy(button, true, "Opening…");
    try {
      openActivityReceipt(await api("activity-receipt", { activityId: activityId }));
    } catch (error) {
      notify(error.message);
    } finally {
      state.openingActivityReceiptId = null;
      setBusy(button, false);
    }
  });
  document.querySelector("[data-team-list]").addEventListener("click", function (event) {
    var button = event.target.closest("[data-select-team]");

    if (button) {
      loadTeamDetail(button.dataset.selectTeam).catch(function (error) { notify(error.message); });
    }
  });
  document.querySelector("[data-team-detail]").addEventListener("click", async function (event) {
    var returnButton = event.target.closest("[data-process-return]");
    var resetButton = event.target.closest("[data-reset-password]");
    var orderButton = event.target.closest("[data-view-admin-order]");
    var protectedButton = event.target.closest("[data-create-protected-order]");
    var correctionButton = event.target.closest("[data-correct-return]");
    var timeoutButton = event.target.closest("[data-remove-order-timeout]");

    try {
      if (returnButton) {
        var rows = Array.prototype.slice.call(document.querySelectorAll("[data-return-component]"));
        var items = rows.map(function (row) {
          return {
            componentId: Number(row.dataset.returnComponent),
            quantity: Number(row.querySelector("[data-return-quantity]").value),
            condition: row.querySelector("[data-return-condition]").value,
            note: row.querySelector("[data-return-note]").value
          };
        }).filter(function (item) { return item.quantity > 0; });

        if (!items.length) {
          notify("Enter a return quantity for at least one component.");
          return;
        }

        if (!(await confirmAction("Process this return?", "You are confirming that " + items.reduce(function (sum, item) { return sum + item.quantity; }, 0) + " component(s) were physically returned or finalized as missing.", "Process Return"))) {
          return;
        }

        setBusy(returnButton, true, "Processing…");
        var detail = await mutate("process-return", { teamId: Number(returnButton.dataset.processReturn), items: items });
        state.teamDetailRequestId += 1;
        renderTeamDetail(detail, { preserveDraft: false });
        await loadTeams();
        notify("Return receipt created.");
      } else if (resetButton) {
        var password = window.prompt("Enter a new temporary password (at least 8 characters):");

        if (!password) {
          return;
        }

        await mutate("reset-team-password", { teamId: Number(resetButton.dataset.resetPassword), password: password });
        notify("Team password reset. Existing team sessions were signed out.");
      } else if (timeoutButton) {
        var timeoutReason = window.prompt("Why is this team allowed to bypass the 45-minute order timeout once?");
        if (!timeoutReason || !timeoutReason.trim()) {
          return;
        }
        setBusy(timeoutButton, true, "Granting…");
        await mutate("grant-order-timeout-exception", {
          teamId: Number(timeoutButton.dataset.removeOrderTimeout),
          reason: timeoutReason.trim()
        });
        await loadTeamDetail(state.selectedTeamId, { preserveDraft: false });
        notify("One-order timeout exception granted.");
      } else if (protectedButton) {
        var overrideItems = Array.prototype.slice.call(document.querySelectorAll("[data-override-component]")).map(function (row) {
          return {
            componentId: Number(row.dataset.overrideComponent),
            quantity: Number(row.querySelector("[data-override-quantity]").value)
          };
        }).filter(function (item) { return item.quantity > 0; });
        var overrideReason = document.querySelector("[data-override-reason]").value.trim();

        if (!overrideItems.length || !overrideReason) {
          notify("Choose hardware and enter the required override reason.");
          return;
        }

        if (!(await confirmAction("Release protected stock?", "This creates a claimed order for the team and records your reason permanently in the audit trail.", "Create Exception"))) {
          return;
        }

        setBusy(protectedButton, true, "Creating…");
        await mutate("create-protected-stock-order", {
          teamId: Number(protectedButton.dataset.createProtectedOrder),
          reason: overrideReason,
          items: overrideItems
        });
        await Promise.all([loadTeamDetail(state.selectedTeamId), loadAdminOverview()]);
        notify("Protected-stock exception order created and assigned to you.");
      } else if (correctionButton) {
        var correctionContainer = correctionButton.closest("[data-correction-receipt]");
        var correctionItems = Array.prototype.slice.call(correctionContainer.querySelectorAll("[data-correction-item]")).map(function (row) {
          return {
            originalReturnItemId: Number(row.dataset.correctionItem),
            quantity: Number(row.querySelector("[data-correction-quantity]").value),
            correctedCondition: row.querySelector("[data-correction-condition]").value,
            note: row.querySelector("[data-correction-note]").value
          };
        }).filter(function (item) { return item.quantity > 0; });
        var correctionReason = correctionContainer.querySelector("[data-correction-reason]").value.trim();

        if (!correctionItems.length || !correctionReason) {
          notify("Choose at least one item and enter the required correction reason.");
          return;
        }
        if (!(await confirmAction("Record a return correction?", "The original receipt will remain unchanged. A new append-only correction receipt will update inventory and the team’s holdings.", "Record Correction"))) {
          return;
        }

        setBusy(correctionButton, true, "Correcting…");
        var correctedDetail = await mutate("correct-return", {
          returnReceiptId: Number(correctionButton.dataset.correctReturn),
          reason: correctionReason,
          items: correctionItems
        });
        state.teamDetailRequestId += 1;
        renderTeamDetail(correctedDetail, { preserveDraft: false });
        await Promise.all([loadTeams(), loadAdminOverview()]);
        notify("Append-only return correction recorded.");
      } else if (orderButton) {
        var result = await api("order", { orderId: Number(orderButton.dataset.viewAdminOrder) });
        openOrderReceipt(result.order);
      }
    } catch (error) {
      notify(error.message);
    } finally {
      if (returnButton) {
        setBusy(returnButton, false);
      }
      if (protectedButton) {
        setBusy(protectedButton, false);
      }
      if (correctionButton) {
        setBusy(correctionButton, false);
      }
      if (timeoutButton) {
        setBusy(timeoutButton, false);
      }
    }
  });

  document.querySelector("[data-team-detail]").addEventListener("input", function (event) {
    var profile = event.target.closest("[data-team-profile-form]");
    if (profile) profile.dataset.dirty = "true";
  });
  document.querySelector("[data-team-detail]").addEventListener("click", async function (event) {
    if (!event.target.closest("[data-reload-team-profile]")) return;
    var form = event.target.closest("[data-team-profile-form]");
    form.dataset.dirty = "false";
    try { await loadTeamDetail(state.selectedTeamId); }
    catch (error) { notify(error.message); }
  });
  document.querySelector("[data-team-detail]").addEventListener("submit", async function (event) {
    var form = event.target.closest("[data-team-profile-form]");
    if (!form) return;
    event.preventDefault();
    var button = form.querySelector('button[type="submit"]');
    var errorElement = form.querySelector("[data-profile-error]");
    var teamId = Number(form.closest("[data-team-detail]").dataset.teamDetailTeam);
    errorElement.hidden = true;
    setBusy(button, true, "Saving…");
    try {
      await mutate("save-team-profile", {
        teamId: teamId, version: Number(form.dataset.version),
        memberNames: [0, 1, 2, 3].map(function (index) { return form.elements['member' + index].value; }),
        contactEmail: form.elements.contactEmail.value
      });
      form.dataset.dirty = "false";
      if (state.selectedTeamId === teamId) await loadTeamDetail(teamId);
      await loadTeams();
      notify("Team members and contact saved.");
    } catch (error) {
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    } finally { setBusy(button, false); }
  });

  document.querySelector("[data-change-account-name]").addEventListener("click", function () {
    var dialog = document.querySelector("[data-account-name-dialog]");
    dialog.querySelector("input").value = state.user.displayName;
    dialog.querySelector("[data-account-name-error]").hidden = true;
    dialog.showModal();
  });
  document.querySelector("[data-cancel-account-name]").addEventListener("click", function () {
    document.querySelector("[data-account-name-dialog]").close();
  });
  document.querySelector("[data-account-name-form]").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector('button[type="submit"]');
    var errorElement = form.querySelector("[data-account-name-error]");
    errorElement.hidden = true;
    setBusy(button, true, "Saving…");
    try {
      var result = await mutate("change-account-name", { name: form.elements.accountName.value });
      setSession(result.user);
      document.querySelector("[data-account-name-dialog]").close();
      notify("Account name changed. Your one name change has been used.");
    } catch (error) {
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    } finally { setBusy(button, false); }
  });

  document.querySelector("[data-open-team-create]").addEventListener("click", function () { teamCreateDialog.showModal(); });
  document.querySelector("[data-team-create-form]").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector("button[type=submit]");
    var errorElement = form.querySelector("[data-team-create-error]");
    errorElement.hidden = true;
    setBusy(button, true, "Creating…");

    try {
      await mutate("create-team", { name: form.name.value, identifier: form.identifier.value, username: form.username.value, password: form.password.value });
      form.reset();
      teamCreateDialog.close();
      await loadTeams();
      notify("Team credentials created.");
    } catch (error) {
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    } finally {
      setBusy(button, false);
    }
  });

  var relationshipRowMarkup = function (relationship, componentId) {
    var targets = state.components.filter(function (item) { return item.id !== componentId; }).map(function (item) {
      return '<option value="' + item.id + '"' + (relationship && relationship.targetComponentId === item.id ? " selected" : "") + '>' + escapeHtml(item.name) + "</option>";
    }).join("");
    var types = [
      ["requires", "Requires (blocks checkout)"],
      ["compatible_driver", "Compatible driver (warning only)"],
      ["compatible_power_supply", "Compatible power supply (warning)"],
      ["recommends", "Recommends"]
    ].map(function (type) {
      return '<option value="' + type[0] + '"' + (relationship && relationship.relationType === type[0] ? " selected" : "") + '>' + type[1] + "</option>";
    }).join("");

    return '<div class="checkout-relationship-row"><label>Related component<select data-relationship-target>' + targets + '</select></label><label>Relationship<select data-relationship-type>' + types + '</select></label><label>Capacity<input data-relationship-ratio type="number" min="0.001" max="10000" step="0.001" value="' + escapeHtml(relationship ? relationship.quantityRatio : 1) + '"></label><label>Starts at quantity<input data-relationship-threshold type="number" min="1" value="' + escapeHtml(relationship ? relationship.minimumSourceQuantity : 1) + '"></label><label class="checkout-relationship-message">Participant message<input data-relationship-message maxlength="1000" value="' + escapeHtml(relationship ? relationship.message : "") + '" placeholder="Explain why this driver or supply is needed"></label><button class="checkout-icon-button" type="button" data-remove-relationship aria-label="Remove relationship">×</button></div>';
  };

  var renderRelationshipRows = function (relationships, componentId) {
    document.querySelector("[data-relationship-rows]").innerHTML = relationships.map(function (relationship) {
      return relationshipRowMarkup(relationship, componentId);
    }).join("");
  };

  var openComponentForm = function (component) {
    var form = document.querySelector("[data-component-form]");
    form.reset();
    form.id.value = component ? component.id : "";
    form.expectedVersion.value = component ? component.version : "";
    form.name.value = component ? component.name : "";
    form.description.value = component ? component.description : "";
    form.imageUrl.value = component ? component.imageUrl : "";
    form.imageAlt.value = component ? component.imageAlt : "";
    form.category.value = component ? component.category : categories[0];
    form.compatibility.value = component ? component.compatibility : "Arduino + Raspberry Pi";
    form.arduinoGuidance.value = component ? component.arduinoGuidance : "";
    form.raspberryPiGuidance.value = component ? component.raspberryPiGuidance : "";
    form.binLocation.value = component ? component.binLocation : "";
    form.technicalSpecs.value = component ? component.technicalSpecs : "";
    form.totalQuantity.value = component ? component.totalQuantity : 0;
    form.mlhQuantity.value = component ? component.mlhQuantity : 0;
    form.unavailableQuantity.value = component ? component.unavailableQuantity : 0;
    form.protectedStock.value = component ? component.protectedStock : 0;
    form.maxActivePerTeam.value = component && component.maxActivePerTeam != null ? component.maxActivePerTeam : "";
    form.adminNotes.value = component ? component.adminNotes : "";
    form.changeReason.value = "";
    form.active.checked = component ? component.active : true;
    form.querySelector("[data-component-form-title]").textContent = component ? "Edit " + component.name : "Add component";
    form.querySelector("[data-component-error]").hidden = true;
    renderRelationshipRows(component ? component.relationships : [], component ? component.id : null);
    componentDialog.showModal();
  };

  document.querySelector("[data-add-relationship]").addEventListener("click", function () {
    var form = document.querySelector("[data-component-form]");
    var componentId = form.id.value ? Number(form.id.value) : null;
    document.querySelector("[data-relationship-rows]").insertAdjacentHTML("beforeend", relationshipRowMarkup(null, componentId));
  });
  document.querySelector("[data-relationship-rows]").addEventListener("click", function (event) {
    var button = event.target.closest("[data-remove-relationship]");
    if (button) button.closest(".checkout-relationship-row").remove();
  });

  document.querySelector("[data-new-component]").addEventListener("click", function () { openComponentForm(null); });
  document.querySelector("[data-inventory-table]").addEventListener("click", function (event) {
    var preview = event.target.closest("[data-preview-component]");
    var button = event.target.closest("[data-edit-component]");

    if (preview) {
      openImagePreview(state.components.find(function (component) { return component.id === Number(preview.dataset.previewComponent); }));
    } else if (button) {
      openComponentForm(state.components.find(function (component) { return component.id === Number(button.dataset.editComponent); }));
    }
  });
  document.querySelector("[data-component-form]").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector("button[type=submit]");
    var errorElement = form.querySelector("[data-component-error]");
    var payload = {
      id: form.id.value ? Number(form.id.value) : null,
      expectedVersion: form.expectedVersion.value ? Number(form.expectedVersion.value) : null,
      name: form.name.value,
      description: form.description.value,
      imageUrl: form.imageUrl.value,
      imageAlt: form.imageAlt.value,
      category: form.category.value,
      compatibility: form.compatibility.value,
      arduinoGuidance: form.arduinoGuidance.value,
      raspberryPiGuidance: form.raspberryPiGuidance.value,
      binLocation: form.binLocation.value,
      technicalSpecs: form.technicalSpecs.value,
      totalQuantity: Number(form.totalQuantity.value),
      mlhQuantity: Number(form.mlhQuantity.value),
      unavailableQuantity: Number(form.unavailableQuantity.value),
      protectedStock: Number(form.protectedStock.value),
      maxActivePerTeam: form.maxActivePerTeam.value ? Number(form.maxActivePerTeam.value) : null,
      adminNotes: form.adminNotes.value,
      changeReason: form.changeReason.value,
      active: form.active.checked,
      relationships: Array.prototype.slice.call(form.querySelectorAll(".checkout-relationship-row")).map(function (row) {
        return {
          targetComponentId: Number(row.querySelector("[data-relationship-target]").value),
          relationType: row.querySelector("[data-relationship-type]").value,
          quantityRatio: Number(row.querySelector("[data-relationship-ratio]").value),
          minimumSourceQuantity: Number(row.querySelector("[data-relationship-threshold]").value),
          message: row.querySelector("[data-relationship-message]").value
        };
      })
    };
    errorElement.hidden = true;
    setBusy(button, true, "Saving…");

    try {
      if (payload.id && !(await confirmAction("Save inventory changes?", "Changing total or unavailable inventory affects live availability. Existing reservations and checkouts remain protected.", "Save Changes"))) {
        return;
      }

      await mutate("save-component", payload);
      componentDialog.close();
      await loadInventory();
      notify(payload.id ? "Component updated." : "Component added.");
    } catch (error) {
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    } finally {
      setBusy(button, false);
    }
  });

  document.querySelectorAll("[data-dialog-close]").forEach(function (button) {
    button.addEventListener("click", function () { button.closest("dialog").close(); });
  });
  imageDialog.addEventListener("click", function (event) {
    if (event.target === imageDialog) {
      imageDialog.close();
    }
  });

  var categoryOptions = categories.map(function (category) {
    return '<option value="' + escapeHtml(category) + '">' + escapeHtml(category) + "</option>";
  }).join("");
  document.querySelector("[data-category-filter]").insertAdjacentHTML("beforeend", categoryOptions);
  document.querySelector("[data-inventory-category-filter]").insertAdjacentHTML("beforeend", categoryOptions);
  document.querySelector("[data-component-form] select[name=category]").innerHTML = categoryOptions;

  window.setInterval(function () {
    if (state.dashboard.cooldownSeconds > 0) {
      state.dashboard.cooldownSeconds -= 1;
      renderCooldown();
    }
  }, 1000);

  initialize();
})();
