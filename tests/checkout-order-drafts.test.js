const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/checkout.js"), "utf8");
const decode = value => value.replace(/&quot;/g, '"').replace(/&#039;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// A small DOM adapter exercises the actual page script, including its polling and save handlers.
function page(orders) {
  const roots = new Map();
  const intervals = [];
  const document = {
    activeElement: null,
    querySelector(selector) {
      if (!roots.has(selector)) roots.set(selector, new Element());
      return roots.get(selector);
    },
    querySelectorAll() { return []; }
  };

  class Element {
    constructor(attributes = {}, parent = null) {
      this.attributes = attributes;
      this.dataset = Object.fromEntries(Object.entries(attributes)
        .filter(([key]) => key.startsWith("data-"))
        .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
      this.parent = parent;
      this.children = [];
      this.listeners = {};
      this.value = attributes.value || "";
      this.selectionStart = null;
      this.selectionEnd = null;
      this.textContent = "Save Adjustments";
    }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    insertAdjacentHTML() {}
    focus() { document.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    closest(selector) { return selector === "[data-admin-order]" ? this.parent : this; }
    querySelectorAll(selector) {
      return this.children.filter(child => selector.split(",").some(part => {
        const match = part.trim().match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        return match && child.hasAttribute(match[1]) && (match[2] === undefined || child.getAttribute(match[1]) === match[2]);
      }));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    set innerHTML(html) {
      this.html = html;
      this.children = [];
      const attributes = tag => Object.fromEntries(Array.from(tag.matchAll(/([\w-]+)="([^"]*)"/g), match => [match[1], decode(match[2])]));
      for (const match of html.matchAll(/<article\b[^>]*data-admin-order="(\d+)"[^>]*>([\s\S]*?)<\/article>/g)) {
        const card = new Element({ "data-admin-order": match[1] }, this);
        for (const control of match[2].matchAll(/<input\b([^>]*)>|<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
          const field = new Element(attributes(control[1] || control[2]), card);
          if (control[2] !== undefined) {
            const options = Array.from(control[3].matchAll(/<option\b([^>]*)>/g));
            field.value = attributes((options.find(option => /\bselected\b/.test(option[1])) || options[0])[1]).value;
          }
          if (field.hasAttribute("data-adjust-note")) field.selectionStart = field.selectionEnd = 0;
          card.children.push(field);
        }
        this.children.push(card);
      }
    }
  }

  let respond = async action => {
    if (action === "admin-orders") return { orders };
    if (action === "admin-overview") return { inventory: {} };
    throw new Error(`Unexpected action: ${action}`);
  };
  const window = {
    sessionStorage: { getItem() { return null; }, setItem() {} },
    setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
    clearInterval() {}, setTimeout() {}, clearTimeout() {},
    async fetch(url, request) {
      const payload = JSON.parse(request.body);
      const result = await respond(payload.action, payload);
      return { ok: !result.error, status: result.error ? 400 : 200, async json() { return result; } };
    }
  };
  const context = vm.createContext({ document, window, Intl });
  vm.runInContext(source.replace(/  initialize\(\);\s*\}\)\(\);\s*$/, `
    window.testPage = { state, renderAdminOrders, loadAdminOrders, beginPolling };
  })();`), context);
  const hooks = window.testPage;
  hooks.state.user = { id: 7, role: "admin" };
  hooks.state.activeAdminTab = "orders";
  hooks.state.adminOrders = structuredClone(orders);
  hooks.renderAdminOrders();
  const board = document.querySelector("[data-admin-orders]");
  return {
    ...hooks, document, board, intervals,
    respond(callback) { respond = callback; },
    field(orderId, kind, itemId = orderId * 10) {
      return board.querySelector(`[data-admin-order="${orderId}"]`).querySelector(`[data-adjust-${kind}="${itemId}"]`);
    },
    save(orderId) {
      const card = board.querySelector(`[data-admin-order="${orderId}"]`);
      const button = new Element({ "data-save-adjustments": String(orderId) }, card);
      return board.listeners.click({ target: button });
    }
  };
}

function order(id, overrides = {}) {
  return {
    id, status: "reviewing", reviewedBy: 7, teamName: `Team ${id}`,
    createdAt: "2026-11-07T15:00:00Z",
    items: [{ id: id * 10, name: "Test part", requestedQuantity: 3, approvedQuantity: 3, adjustmentReason: "", note: "" }],
    ...overrides
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("five-second polling preserves quantities, out-of-stock reasons, notes, and caret", async () => {
  const ui = page([order(1), order(2)]);
  ui.field(1, "quantity").value = "0";
  ui.field(1, "reason").value = "Out of Stock";
  ui.field(1, "note").value = 'Checked bin <A> & "B"';
  ui.field(1, "note").focus();
  ui.field(1, "note").setSelectionRange(3, 8);
  ui.field(2, "quantity").value = "";
  ui.beginPolling();
  const poll = ui.intervals.find(interval => interval.delay === 5000);
  for (let index = 0; index < 3; index++) {
    poll.callback();
    await settle();
    assert.equal(ui.field(1, "quantity").value, "0");
    assert.equal(ui.field(1, "reason").value, "Out of Stock");
    assert.equal(ui.field(1, "note").value, 'Checked bin <A> & "B"');
    assert.equal(ui.field(2, "quantity").value, "");
    assert.equal(ui.document.activeElement, ui.field(1, "note"));
    assert.equal(ui.field(1, "note").selectionStart, 3);
    assert.equal(ui.field(1, "note").selectionEnd, 8);
  }
});

test("refresh preserves edits made while its request is pending and renders new orders", async () => {
  const ui = page([order(1)]);
  let finish;
  ui.respond(() => new Promise(resolve => { finish = resolve; }));
  const refreshing = ui.loadAdminOrders();
  ui.field(1, "note").value = "Still checking stock";
  finish({ orders: [order(2), order(1)] });
  await refreshing;
  assert.equal(ui.field(1, "note").value, "Still checking stock");
  assert.equal(ui.field(2, "quantity").value, "3");
});

test("successful saves show confirmed values and keep other orders' drafts", async () => {
  const ui = page([order(1), order(2)]);
  ui.field(1, "quantity").value = "0";
  ui.field(1, "reason").value = "Out of Stock";
  ui.field(1, "note").value = "  Empty bin  ";
  ui.field(2, "note").value = "Do not clear this draft";
  let submitted;
  const saved = order(1);
  saved.items[0] = { ...saved.items[0], approvedQuantity: 0, adjustmentReason: "Out of Stock", note: "Empty bin" };
  ui.respond(async (action, payload) => {
    if (action === "adjust-order") { submitted = payload.items; return { order: saved }; }
    if (action === "admin-orders") return { orders: [saved, order(2)] };
    return { inventory: {} };
  });
  await ui.save(1);
  assert.deepEqual(submitted, [{ itemId: 10, approvedQuantity: 0, reason: "Out of Stock", note: "  Empty bin  " }]);
  assert.equal(ui.field(1, "note").value, "Empty bin");
  assert.equal(ui.field(1, "quantity").value, "0");
  assert.equal(ui.field(2, "note").value, "Do not clear this draft");
});

test("failed saves retain the draft for correction or retry", async () => {
  const ui = page([order(1)]);
  ui.field(1, "quantity").value = "0";
  ui.field(1, "note").value = "Reason is still being entered";
  ui.respond(async action => action === "adjust-order" ? { error: "Choose a reason" } : { orders: [order(1)] });
  await ui.save(1);
  assert.equal(ui.field(1, "quantity").value, "0");
  assert.equal(ui.field(1, "note").value, "Reason is still being entered");
});

test("out-of-order polling responses cannot replace newer order data", async () => {
  const ui = page([order(1)]);
  const pending = [];
  ui.respond(() => new Promise(resolve => pending.push(resolve)));
  const first = ui.loadAdminOrders();
  const second = ui.loadAdminOrders();
  pending[1]({ orders: [order(1, { status: "accepted", acceptedBy: 7 })] });
  await second;
  pending[0]({ orders: [order(1)] });
  await first;
  assert.equal(ui.state.adminOrders[0].status, "accepted");
  assert.equal(ui.field(1, "quantity"), null);
});

test("a polling response started before a save cannot revert confirmed values", async () => {
  const ui = page([order(1)]);
  let finishPoll;
  ui.respond(() => new Promise(resolve => { finishPoll = resolve; }));
  const polling = ui.loadAdminOrders();
  const saved = order(1);
  saved.items[0].note = "Confirmed";
  ui.respond(async action => {
    if (action === "adjust-order") return { order: saved };
    if (action === "admin-orders") return { orders: [saved] };
    return { inventory: {} };
  });
  await ui.save(1);
  finishPoll({ orders: [order(1)] });
  await polling;
  assert.equal(ui.state.adminOrders[0].items[0].note, "Confirmed");
  assert.equal(ui.field(1, "note").value, "Confirmed");
});

test("status and reviewer changes remove editing controls without leaking drafts", async () => {
  for (const changes of [{ status: "accepted" }, { status: "cancelled" }, { reviewedBy: 9 }]) {
    const ui = page([order(1)]);
    ui.field(1, "note").value = "Private draft";
    ui.respond(async () => ({ orders: [order(1, changes)] }));
    await ui.loadAdminOrders();
    assert.equal(ui.field(1, "note"), null);
    assert.equal(ui.board.html.includes("Private draft"), false);
  }
});
