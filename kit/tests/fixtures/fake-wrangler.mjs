#!/usr/bin/env node
// 假 wrangler：离线编排测试用。把「对 Cloudflare 做了什么」记进 FAKE_STATE 指向的 JSON，
// 输出格式与退出码模仿真 wrangler 4.x 中被安装器用到的那几条命令。
import fs from "node:fs";
import http from "node:http";

const STATE = process.env.FAKE_STATE;
const argv = process.argv.slice(2);
const load = () => JSON.parse(fs.readFileSync(STATE, "utf8"));
const save = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const workerOf = () => JSON.parse(fs.readFileSync(opt("-c"), "utf8")).name;
const readStdin = () => { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } };

const s = load();
s.calls.push(argv);
save(s);
const cmd = argv.slice(0, 3).join(" ");
const out = (x) => process.stdout.write(typeof x === "string" ? x : JSON.stringify(x));

if (argv[0] === "whoami") {
  if (!s.loggedIn) { process.stderr.write("not authenticated"); process.exit(1); }
  out({ loggedIn: true, accounts: [{ id: "acc_1", name: "Test Account" }], tokenPermissions: s.tokenPermissions });
} else if (argv[0] === "login") {
  // 模拟用户在浏览器里点了「允许」：拿到完整权限。设备码模式先打印链接与验证码（与真 wrangler 同样的措辞）。
  if (argv.includes("--device")) out("To authorize Wrangler, please visit:\n\n  https://dash.cloudflare.com/device\n\nand enter the code:\n\n  FAKE-CODE\n");
  s.loggedIn = true;
  s.tokenPermissions = ["workers_scripts:write", "d1:write", "zone:read", "email_routing:write", "account:read"];
  save(s);
} else if (cmd.startsWith("auth token")) {
  out({ type: "oauth", token: `offline-test-${process.pid}` });
} else if (cmd.startsWith("d1 list")) {
  out(s.d1);
} else if (cmd.startsWith("d1 create")) {
  s.d1.push({ uuid: `uuid-${argv[2]}`, name: argv[2] }); s.d1Creates += 1; save(s);
  out(`✅ Successfully created DB '${argv[2]}'`);
} else if (argv[0] === "d1") {
  s.sql.push(opt("--command") || `file:${opt("--file") || "migrations"}`); save(s);
} else if (cmd.startsWith("r2 bucket create")) {
  out("Created bucket");
} else if (argv[0] === "deploy") {
  const worker = workerOf();
  const file = opt("--secrets-file");
  const rec = { worker, secretNames: [] };
  if (file) {
    rec.secretsFileMode = (fs.statSync(file).mode & 0o777).toString(8);
    const secrets = JSON.parse(fs.readFileSync(file, "utf8"));
    s.secrets[worker] = { ...(s.secrets[worker] || {}), ...secrets };
    rec.secretNames = Object.keys(secrets);
  }
  for (const r of JSON.parse(fs.readFileSync(opt("-c"), "utf8")).routes || []) {
    s.workerDomains = (s.workerDomains || []).filter((d) => d.hostname !== r.pattern);
    s.workerDomains.push({ hostname: r.pattern, service: worker });
  }
  if (!s.scripts.includes(worker)) s.scripts.push(worker);
  s.deploys.push(rec); save(s);
  out(`Uploaded ${worker}\nDeployed ${worker} triggers`);
} else if (cmd.startsWith("secret list")) {
  const worker = workerOf();
  if (!s.deploys.some((d) => d.worker === worker)) { process.stderr.write("worker not found"); process.exit(1); }
  out(Object.keys(s.secrets[worker] || {}).map((name) => ({ name, type: "secret_text" })));
} else if (cmd.startsWith("secret put")) {
  const worker = workerOf();
  s.secrets[worker] = { ...(s.secrets[worker] || {}), [argv[2]]: readStdin() };
  s.secretPuts[argv[2]] = (s.secretPuts[argv[2]] || 0) + 1; save(s);
  out("✨ Success! Uploaded secret");
} else if (cmd === "email routing enable") {
  s.routing = { enabled: true, status: "ready" };
  s.mx = ["route1.mx.cloudflare.net", "route2.mx.cloudflare.net"]; save(s);
} else if (argv[0] === "dev") {
  // 本地版：起一个行为与网关免登录模式一致的小服务，直到被 stop 杀掉。
  const port = Number(opt("--port"));
  http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/auth/status")) return res.end(JSON.stringify({ authed: true, configured: true, local: true }));
    if (req.url.startsWith("/admin/domains")) return res.end(JSON.stringify({ ok: true, domains: [process.env.FAKE_DOMAIN] }));
    res.end("{}");
  }).listen(port, "127.0.0.1");
} else {
  process.stderr.write(`fake-wrangler: 未模拟的命令 ${argv.join(" ")}`);
  process.exit(99);
}
