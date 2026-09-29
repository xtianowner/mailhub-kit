#!/usr/bin/env node
// 设置云端登录网页的用户名与密码。必须由用户本人在终端里运行：
// 密码输入不回显、输两次确认，直接交给 Cloudflare 加密保存，不写任何文件、不经过聊天。
import { EXIT, StepError, log, reportError, wrangler } from "./lib/common.mjs";
import { configPath, loadConfig, passwordProblem, saveConfig } from "./lib/config.mjs";

function ask(prompt, { hidden = false } = {}) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(prompt);
    let buf = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (value, err) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      err ? reject(err) : resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(buf);
        if (ch === "\u0003") return done(null, new StepError("已取消", { code: EXIT.FAIL }));
        if (ch === "\u007f" || ch === "\b") {
          if (buf.length) {
            buf = buf.slice(0, -1);
            if (!hidden) stdout.write("\b \b");
          }
          continue;
        }
        if (ch < " ") continue;
        buf += ch;
        if (!hidden) stdout.write(ch);
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  if (!process.stdin.isTTY) {
    throw new StepError("这个脚本要在终端窗口里由你本人运行（需要输入密码）", { code: EXIT.BAD_INPUT });
  }
  const cfg = loadConfig();
  console.log("\n  MailHub · 设置云端登录网页的账号密码");
  console.log(`  登录地址：https://${cfg.web_host}\n`);

  const userInput = (await ask(`  登录用户名（直接回车使用 ${cfg.login_user}）：`)).trim();
  const user = userInput || cfg.login_user;

  let password;
  for (;;) {
    const a = await ask("  设置登录密码（输入时不显示）：", { hidden: true });
    const problem = passwordProblem(a);
    if (problem) {
      console.log(`  ⚠️  ${problem}，请重新输入`);
      continue;
    }
    const b = await ask("  再输入一次：", { hidden: true });
    if (a !== b) {
      console.log("  ⚠️  两次不一致，请重新输入");
      continue;
    }
    password = a;
    break;
  }

  const put = (name, value) => {
    const res = wrangler(["secret", "put", name, "-c", configPath("web")], { input: value, secretValues: [value] });
    if (res.code !== 0) throw new StepError(`保存 ${name} 失败\n${(res.stderr || res.stdout).slice(-600)}`);
  };
  put("APP_PASSWORD", password);
  if (user !== cfg.login_user) {
    put("APP_USER", user);
    saveConfig({ ...cfg, login_user: user });
  }
  log.ok("已保存（加密存放在 Cloudflare，本机不留副本）");
  console.log(`\n  以后登录：https://${cfg.web_host}　用户名 ${user}（不区分大小写）`);
  console.log("  忘了密码：重新运行这个脚本即可。现在可以关闭这个窗口。\n");
}

try {
  await main();
  process.exit(EXIT.OK);
} catch (err) {
  process.exit(reportError(err));
}
