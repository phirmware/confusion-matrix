const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const tags = new Set(["missing_middle", "rearranged", "combined", "fraud", "custom"]);

function validateCase(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error("Each case must be an object.");
  }
  for (const field of ["account", "document"]) {
    if (typeof item[field] !== "string" || item[field].trim().length > 200 ||
        !/[\p{L}\p{N}]/u.test(item[field])) {
      throw new Error(`${field} must contain a letter or number and be at most 200 characters.`);
    }
  }
  if (!tags.has(item.tag)) throw new Error("Choose a valid scenario.");
  if (item.truth !== 0 && item.truth !== 1) throw new Error("Ground truth must be 0 or 1.");
}

function readDataset(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data)) throw new Error("Dataset must be a JSON array.");
  const ids = new Set();
  for (const item of data) {
    validateCase(item);
    if (!Number.isSafeInteger(item.id) || item.id < 1 ||
        item.id >= Number.MAX_SAFE_INTEGER || ids.has(item.id)) {
      throw new Error("Dataset IDs must be unique positive safe integers below the maximum.");
    }
    ids.add(item.id);
  }
  return data;
}

function createServer(datasetPath = path.join(__dirname, "dataset.json"), staticDirectory = null) {
  const server = http.createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const port = server.address().port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(req.headers.host)) {
      json(403, { error: "Only local hostnames are allowed." });
      return;
    }
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      json(403, { error: "Cross-origin requests are not allowed." });
      return;
    }

    const route = req.url.split("?")[0];
    try {
      if (staticDirectory) {
        const files = {
          "/": ["index.html", "text/html"],
          "/index.html": ["index.html", "text/html"],
          "/dataset.json": ["dataset.json", "application/json"],
          "/demo-config.json": ["demo-config.json", "application/json"],
          "/favicon.svg": ["favicon.svg", "image/svg+xml"]
        };
        const file = Object.hasOwn(files, route) ? files[route] : null;
        if (req.method !== "GET" || !file) {
          json(404, { error: "Not found." });
          return;
        }
        const content = fs.readFileSync(path.join(staticDirectory, file[0]));
        res.writeHead(200, { "Content-Type": `${file[1]}; charset=utf-8` });
        res.end(content);
        return;
      }

      if (req.method === "GET" && route === "/demo-config.json") {
        json(200, { storage: "server" });
        return;
      }
      if (req.method === "GET" && route === "/favicon.svg") {
        res.writeHead(200, { "Content-Type": "image/svg+xml" });
        res.end(fs.readFileSync(path.join(__dirname, "favicon.svg")));
        return;
      }
      if (req.method === "GET" && (route === "/api/cases" || route === "/dataset.json")) {
        json(200, readDataset(datasetPath));
        return;
      }

      if (req.method === "POST" && route === "/api/cases") {
        if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
          json(415, { error: "Use application/json." });
          return;
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16384) {
            json(413, { error: "Request is too large." });
            return;
          }
          chunks.push(chunk);
        }
        let input;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          validateCase(input);
        } catch (error) {
          json(400, { error: error.message });
          return;
        }

        // Keep read/append/atomic replacement synchronous to serialize local saves.
        const data = readDataset(datasetPath);
        const item = {
          id: data.reduce((max, row) => Math.max(max, row.id), 0) + 1,
          account: input.account.trim(),
          document: input.document.trim(),
          tag: input.tag,
          truth: input.truth
        };
        if (item.id >= Number.MAX_SAFE_INTEGER) throw new Error("Dataset ID limit reached.");
        data.push(item);
        const temporaryPath = `${datasetPath}.${process.pid}.tmp`;
        try {
          fs.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
          fs.renameSync(temporaryPath, datasetPath);
        } finally {
          if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        }
        json(201, data);
        return;
      }

      if (req.method === "GET" && (route === "/" || route === "/confusion-matrix.html")) {
        const html = fs.readFileSync(path.join(__dirname, "confusion-matrix.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      json(404, { error: "Not found." });
    } catch (error) {
      console.error("Dataset server error:", error);
      json(500, { error: "Could not read or save dataset.json. Check the server terminal and file permissions." });
    }
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535.");
  }
  const preview = process.argv.includes("--preview");
  if (preview && !fs.existsSync(path.join(__dirname, "dist", "index.html"))) {
    throw new Error("Run npm run build before npm run preview.");
  }
  if (!preview && !fs.existsSync(path.join(__dirname, "dataset.json"))) {
    fs.copyFileSync(path.join(__dirname, "demo-dataset.json"), path.join(__dirname, "dataset.json"));
    console.log("Created a local dataset.json from the synthetic demo examples.");
  }
  const server = createServer(undefined, preview ? path.join(__dirname, "dist") : null);
  server.on("error", error => {
    console.error(`Cannot start local server: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`KYC Name Matching Lab: http://127.0.0.1:${port}`);
  });
}

module.exports = { createServer };
