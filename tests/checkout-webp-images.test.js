const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const imageDirectory = path.join(process.cwd(), "images", "checkout", "components");
const thumbnailDirectory = path.join(imageDirectory, "thumbnails");

test("component photos are WebP, valid at the container level, and size-budgeted", function () {
  const files = fs.readdirSync(imageDirectory).filter(function (name) {
    return /\.(?:jpe?g|png|gif|webp)$/i.test(name);
  });
  const legacy = files.filter(function (name) { return !/\.webp$/i.test(name); });
  const totalBytes = files.reduce(function (sum, name) {
    const contents = fs.readFileSync(path.join(imageDirectory, name));
    assert.equal(contents.subarray(0, 4).toString("ascii"), "RIFF", name);
    assert.equal(contents.subarray(8, 12).toString("ascii"), "WEBP", name);
    return sum + contents.length;
  }, 0);

  assert.deepEqual(legacy, []);
  assert.equal(files.length, 178);
  assert.ok(totalBytes < 12 * 1024 * 1024, `Component images use ${totalBytes} bytes`);
});

test("every component photo has a compact WebP thumbnail", function () {
  const images = fs.readdirSync(imageDirectory).filter(function (name) { return /\.webp$/i.test(name); }).sort();
  const thumbnails = fs.readdirSync(thumbnailDirectory).filter(function (name) { return /\.webp$/i.test(name); }).sort();
  const totalBytes = thumbnails.reduce(function (sum, name) {
    const contents = fs.readFileSync(path.join(thumbnailDirectory, name));
    assert.equal(contents.subarray(0, 4).toString("ascii"), "RIFF", name);
    assert.equal(contents.subarray(8, 12).toString("ascii"), "WEBP", name);
    return sum + contents.length;
  }, 0);

  assert.deepEqual(thumbnails, images);
  assert.ok(totalBytes < 2 * 1024 * 1024, `Component thumbnails use ${totalBytes} bytes`);
});

test("component image manifests reference existing WebP files", function () {
  const localMappings = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "checkout-local-images.json"), "utf8"));
  const downloadManifest = JSON.parse(fs.readFileSync(path.join(imageDirectory, "download-manifest.json"), "utf8"));
  const references = localMappings.map(function (item) { return item.file; }).concat(
    downloadManifest.items.filter(function (item) { return item.localImage; }).map(function (item) {
      return path.basename(item.localImage);
    })
  );

  references.forEach(function (name) {
    assert.match(name, /\.webp$/i);
    assert.equal(fs.existsSync(path.join(imageDirectory, name)), true, name);
  });
});
