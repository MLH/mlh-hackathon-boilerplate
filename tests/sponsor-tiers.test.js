const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Notability and PI are listed in the Silver sponsor tier", function () {
  const config = fs.readFileSync(path.join(process.cwd(), "_config.yml"), "utf8");
  const goldStart = config.indexOf('    - tier: "Gold"');
  const silverStart = config.indexOf('    - tier: "Silver"');
  const bronzeStart = config.indexOf('    - tier: "Bronze"');
  const gold = config.slice(goldStart, silverStart);
  const silver = config.slice(silverStart, bronzeStart);

  assert.equal(gold.includes('name: "Notability"'), false);
  assert.equal(gold.includes('name: "PI (Physik Instrumente)"'), false);
  assert.equal(silver.includes('name: "Notability"'), true);
  assert.equal(silver.includes('name: "PI (Physik Instrumente)"'), true);
});
