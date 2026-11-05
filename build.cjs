const fs = require("node:fs");
const path = require("node:path");

function build(destination = path.join(__dirname, "dist")) {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "demo-dataset.json"), "utf8"));
  if (!Array.isArray(seed) || !seed.length || seed.some(row => row.tag === "custom")) {
    throw new Error("The public seed must contain only reviewed synthetic examples.");
  }
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(path.join(__dirname, "confusion-matrix.html"), path.join(destination, "index.html"));
  fs.copyFileSync(path.join(__dirname, "favicon.svg"), path.join(destination, "favicon.svg"));
  fs.writeFileSync(path.join(destination, "dataset.json"), `${JSON.stringify(seed, null, 2)}\n`);
  fs.writeFileSync(path.join(destination, "demo-config.json"), '{"storage":"browser"}\n');
  console.log("Built public demo: index.html, dataset.json, demo-config.json, favicon.svg");
}

if (require.main === module) build();
module.exports = { build };
