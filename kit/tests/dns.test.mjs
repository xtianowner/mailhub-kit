import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";

const CF = new URL("../scripts/lib/cf.mjs", import.meta.url).href;

// 中国大陆不开 TUN / 代理时，cloudflare-dns.com 与 dns.google 基本连不上；
// 解析器全部失败会让 preflight 永远停在「无法确认」、verify 的公网 MX 一项永远失败。
test("默认 DoH 列表含大陆可直连的解析器，且排在 Cloudflare / Google 之后", () => {
  const env = { ...process.env };
  delete env.MAILHUB_TEST_DOH;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `import(${JSON.stringify(CF)}).then(m=>console.log(JSON.stringify(m.DOH_LIST)))`], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const list = JSON.parse(r.stdout);
  assert.match(list[0], /cloudflare-dns\.com/);
  assert.ok(list.some((u) => /alidns\.com|doh\.pub/.test(u)), `缺少大陆可达的解析器：${list}`);
});

test("前一个解析器连不上时换下一个；全部失败才报错", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/dns-json");
    res.end(JSON.stringify({ Status: 0, Answer: [{ type: 15, data: "10 MX.Example.org." }] }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  process.env.MAILHUB_TEST_DOH = `http://127.0.0.1:9/dead,http://127.0.0.1:${port}/resolve`;
  try {
    const { lookupMx, DOH_LIST } = await import(CF);
    assert.equal(DOH_LIST.length, 2);
    assert.deepEqual(await lookupMx("example.org"), ["mx.example.org"]);
    DOH_LIST.splice(1, 1); // 只剩连不上的那个
    await assert.rejects(() => lookupMx("example.org"), /查询 example\.org 的 MX 记录失败/);
  } finally {
    delete process.env.MAILHUB_TEST_DOH;
    server.close();
  }
});
