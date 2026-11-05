const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { build } = require("./build.cjs");
const { createServer } = require("./server.cjs");

function storageContext() {
  const html = fs.readFileSync(path.join(__dirname, "confusion-matrix.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const memory = new Map();
  const context = vm.createContext({
    localStorage: {
      getItem: key => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, value),
      removeItem: key => memory.delete(key)
    },
    document: { getElementById: () => ({}) }
  });
  vm.runInContext(script.slice(0, script.indexOf('    $("threshold").addEventListener')), context);
  return {
    context,
    run: code => vm.runInContext(code, context),
    plain: code => JSON.parse(JSON.stringify(vm.runInContext(code, context)))
  };
}

test("public build contains only reviewed public files, not private local cases", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kyc-public-build-"));
  t.after(() => {
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  });
  build(directory);
  assert.deepEqual(fs.readdirSync(directory).sort(), [
    "dataset.json", "demo-config.json", "favicon.svg", "index.html"
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "demo-config.json"))), {
    storage: "browser"
  });
  const seed = JSON.parse(fs.readFileSync(path.join(directory, "dataset.json")));
  assert.equal(seed.length, 30);
  assert.ok(seed.every(row => row.id <= 30 && row.tag !== "custom"));
  assert.deepEqual(seed, JSON.parse(fs.readFileSync(path.join(__dirname, "demo-dataset.json"))));

  const server = createServer(undefined, directory);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base)).status, 200);
  assert.deepEqual(await (await fetch(`${base}/dataset.json`)).json(), seed);
  assert.deepEqual(await (await fetch(`${base}/demo-config.json`)).json(), { storage: "browser" });
  for (const route of ["/server.cjs", "/api/cases", "/toString", "/.env"]) {
    assert.equal((await fetch(`${base}${route}`)).status, 404);
  }
  assert.equal((await fetch(`${base}/api/cases`, { method: "POST" })).status, 404);
});

test("30 public cases cover valid permutations, omissions, and independently different identities", () => {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "demo-dataset.json")));
  const { context } = storageContext();
  const { tokenize, compareNames, validateDataset } = context;
  validateDataset(seed);
  assert.equal(seed.length, 30);
  assert.equal(new Set(seed.map(row => `${row.account}|${row.document}`)).size, 30);
  const counts = { missing_middle: 0, rearranged: 0, combined: 0, fraud: 0 };
  for (const row of seed) {
    counts[row.tag]++;
    if (row.tag === "fraud") {
      assert.equal(row.truth, 0);
      continue;
    }
    assert.equal(row.truth, 1);
    const account = tokenize(row.account);
    const document = tokenize(row.document);
    if (row.tag === "rearranged") {
      assert.deepEqual(document, account);
      assert.notEqual(row.account.toLowerCase(), row.document.toLowerCase());
      assert.equal(compareNames(row.account, row.document, 15).score, 100);
    } else {
      assert.ok(account.length > document.length, `Missing component expected: ${row.account}`);
    }
    if (row.id >= 17 && row.tag !== "rearranged") {
      assert.ok(document.every(token => account.includes(token)));
      const expected = 100 - (account.length - document.length) * 15;
      assert.equal(compareNames(row.account, row.document, 15).score, expected);
    }
  }
  assert.deepEqual(counts, { missing_middle: 9, rearranged: 8, combined: 9, fraud: 4 });
});

test("browser saves rehydrate without colliding with seed IDs", () => {
  const { run, plain } = storageContext();
  run(`seedDataset = [
    {id: 1, account: "Alex James Vance", document: "Alex Vance", tag: "combined", truth: 1},
    {id: 9, account: "Priya Sharma", document: "Sharma Priya", tag: "rearranged", truth: 1}
  ]`);
  assert.deepEqual(plain("readBrowserCases()"), []);
  run(`localStorage.setItem(savedCasesKey, JSON.stringify([
    {id: 1, account: "Demo Person", document: "Person Demo", tag: "custom", truth: 1}
  ]))`);
  const combined = plain("combineCases(readBrowserCases())");
  assert.equal(combined.length, 3);
  assert.equal(combined[2].id, 10);
  assert.equal(combined[2].account, "Demo Person");
  assert.equal(run("readBrowserCases()[0].id"), 1);
});

test("corrupted or invalid stored cases are rejected explicitly", () => {
  const { run } = storageContext();
  for (const value of ["{broken", "null", "{}", JSON.stringify([
    { id: 1, account: "!!!", document: "Valid Name", tag: "custom", truth: 1 }
  ])]) {
    run(`localStorage.setItem(savedCasesKey, ${JSON.stringify(value)})`);
    assert.throws(() => run("readBrowserCases()"));
  }
});

test("storage failure preserves the seed and disables browser saves", () => {
  const { run, plain } = storageContext();
  run(`seedDataset = [{id: 1, account: "Demo Name", document: "Name Demo", tag: "rearranged", truth: 1}];
    localStorage.getItem = () => { throw new Error("Storage blocked"); };
    loadBrowserCases();`);
  assert.equal(run("browserStorageReady"), false);
  assert.deepEqual(plain("dataset"), plain("seedDataset"));
});

test("local server advertises JSON persistence explicitly", async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/demo-config.json`);
  assert.deepEqual(await response.json(), { storage: "server" });
});
