// Fingerprint of everything that goes into the Android shell. Gradle stamps it into the
// versionName and the release's version.json carries it, so the app can tell whether a
// release is just new JavaScript or needs the APK reinstalled.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..", "app");
const skip = new Set(["build", ".gradle", ".idea", "local.properties", "keystore.properties", "opsim.keystore", "public"]);

function walk(dir, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (skip.has(name) || name.endsWith(".keystore")) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
}

const files = [];
walk(path.join(root, "android"), files);
files.push(path.join(root, "capacitor.config.ts"));

const h = crypto.createHash("sha256");
for (const f of files) {
  h.update(path.relative(root, f).replace(/\\/g, "/"));
  // windows checkouts may be CRLF; hash what the file means, not its line endings
  h.update(fs.readFileSync(f).toString("latin1").replace(/\r/g, ""));
}
process.stdout.write(h.digest("hex").slice(0, 10));
