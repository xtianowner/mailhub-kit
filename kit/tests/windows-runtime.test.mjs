import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("Windows launcher uses the recorded runtime, preserves spaced arguments and exit codes", { skip: process.platform !== "win32" }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mailhub runtime "));
  try {
    const runner = fileURLToPath(new URL("../scripts/node.ps1", import.meta.url));
    fs.writeFileSync(path.join(tmp, "runtime.json"), JSON.stringify({ execPath: process.execPath }));
    const script = path.join(tmp, "check args.mjs");
    fs.writeFileSync(script, "console.log(JSON.stringify({exe:process.execPath,args:process.argv.slice(2)}));process.exit(17);");
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runner, script, "space here", "literal$()"], {
      env: { ...process.env, MAILHUB_STATE_DIR: tmp }, encoding: "utf8",
    });
    assert.equal(r.status, 17, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { exe: process.execPath, args: ["space here", "literal$()"] });
    fs.writeFileSync(path.join(tmp, "runtime.json"), JSON.stringify({ execPath: path.join(tmp, "missing.exe") }));
    const missing = spawnSync("powershell.exe", ["-NoProfile", "-File", runner, script], {
      env: { ...process.env, MAILHUB_STATE_DIR: tmp }, encoding: "utf8",
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Saved Node runtime is missing/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
