const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createServer } = require("./server.cjs");

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kyc-dataset-test-"));
  const file = path.join(directory, "dataset.json");
  fs.copyFileSync(path.join(__dirname, "demo-dataset.json"), file);
  const server = createServer(file);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.unlinkSync(file);
    fs.rmdirSync(directory);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = input => fetch(`${base}/api/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return { base, file, post };
}

const example = {
  account: "José James Test",
  document: "Test José",
  tag: "combined",
  truth: 1
};

test("loads external dataset and serves HTML", async t => {
  const { base } = await fixture(t);
  const response = await fetch(`${base}/api/cases`);
  assert.equal(response.status, 200);
  const cases = await response.json();
  assert.equal(cases.length, 30);
  assert.equal(cases[0].account, "Alexander James Vance");
  const html = await (await fetch(base)).text();
  assert.match(html, /id="save-case"/);
  assert.match(html, /loadDataset\(\)/);
});

test("save persists fields and returns updated dataset", async t => {
  const { base, file, post } = await fixture(t);
  const before = JSON.parse(fs.readFileSync(file, "utf8"));
  const response = await post(example);
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.equal(saved.length, before.length + 1);
  assert.deepEqual(saved.at(-1), {
    id: Math.max(...before.map(item => item.id)) + 1,
    ...example
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), saved);
  assert.deepEqual(await (await fetch(`${base}/api/cases`)).json(), saved);
});

test("concurrent saves do not overwrite each other", async t => {
  const { file, post } = await fixture(t);
  const before = JSON.parse(fs.readFileSync(file, "utf8")).length;
  const responses = await Promise.all(Array.from({ length: 5 }, (_, i) =>
    post({ ...example, account: `Example ${i}`, tag: "custom" })
  ));
  assert.ok(responses.every(response => response.status === 201));
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(after.length, before + 5);
  assert.equal(new Set(after.map(item => item.id)).size, after.length);
});

test("invalid cases are rejected without modifying the JSON", async t => {
  const { file, post } = await fixture(t);
  const before = fs.readFileSync(file, "utf8");
  for (const invalid of [
    { ...example, account: "!!!" },
    { ...example, document: "" },
    { ...example, document: "A".repeat(201) },
    { ...example, truth: "1" },
    { ...example, tag: "all" },
    null
  ]) {
    assert.equal((await post(invalid)).status, 400);
  }
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("rejects foreign origins, unsupported content, large bodies and unknown paths", async t => {
  const { base } = await fixture(t);
  assert.equal((await fetch(`${base}/api/cases`, {
    method: "POST",
    headers: { Origin: "https://example.com", "Content-Type": "application/json" },
    body: JSON.stringify(example)
  })).status, 403);
  assert.equal((await fetch(`${base}/api/cases`, { method: "POST", body: "{}" })).status, 415);
  assert.equal((await fetch(`${base}/api/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "A".repeat(17000)
  })).status, 413);
  assert.equal((await fetch(`${base}/server.cjs`)).status, 404);
  assert.equal((await fetch(`${base}/api/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid"
  })).status, 400);
});

test("inline JavaScript parses and preserves matching behavior", () => {
  const html = fs.readFileSync(path.join(__dirname, "confusion-matrix.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script);
  const engine = script.slice(script.indexOf("function tokenize"), script.indexOf("function classify"));
  const context = vm.createContext({});
  vm.runInContext(engine, context);
  const compare = context.compareNames;
  assert.equal(compare("Alexander James Vance", "Vance Alexander James", 15).score, 100);
  assert.equal(compare("Alexander James Vance", "Alexander Vance", 15).score, 85);
  assert.equal(compare("Alexander James Vance", "Vance Alexander", 40).score, 60);
  assert.equal(compare("JOSÉ Silva", "Silva Jose", 15).score, 100);
  assert.equal(compare("!!!", "Alex", 15), null);
});
