// Fingerprint of everything that goes into the Android shell. Gradle stamps it into the
// versionName and the release's version.json carries it, so the app can tell whether a
// release is just new JavaScript or needs the APK reinstalled.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..", "app");
// only what git tracks, so a local checkout and the CI runner see the same set
const files = execFileSync("git", ["ls-files", "android", "capacitor.config.ts"], { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .sort()
  .map((f) => path.join(root, f));
// never committed, but an apk built without it boots with the firebase plugins dead
const gs = path.join(root, "android", "app", "google-services.json");
if (fs.existsSync(gs)) files.push(gs);

const h = crypto.createHash("sha256");
for (const f of files) {
  h.update(path.relative(root, f).replace(/\\/g, "/"));
  // windows checkouts may be CRLF; hash what the file means, not its line endings
  h.update(fs.readFileSync(f).toString("latin1").replace(/\r/g, ""));
}
process.stdout.write(h.digest("hex").slice(0, 10));
