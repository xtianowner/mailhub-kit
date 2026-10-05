// 验证码提取器回归测试。
//
// 2026-07-27 修了一个长期潜伏的 bug：looksLikeCodeToken 放行任何 ≤6 字母的纯字母
// token，导致英文验证信被提取成 "YOUR" / "CODE"（线上真实邮件出现过 "ZWNJ"）。
// 中文信一直是对的，所以这个洞在英文侧藏了很久 —— 而 ChatGPT/OpenAI 的信都是英文。
// 下面的英文用例就是当年会挂的那批，务必保持绿色。
import test from "node:test";
import assert from "node:assert/strict";
import { extractVerificationCode } from "../src/verification_extractor.mjs";

const pick = (subject, text, html = "") =>
  extractVerificationCode({ subject, text, html }).code;

test("英文验证信：不能再把 YOUR / CODE 当成验证码", () => {
  assert.equal(pick("Your verification code", "Your code is 123456."), "123456");
  assert.equal(pick("Your temporary login code", "Your ChatGPT code is 908070"), "908070");
  assert.equal(pick("Verify your email", "123456 is your verification code"), "123456");
});

test("英文验证信：独立成行的码", () => {
  assert.equal(
    pick("Sign in", "Enter this code to sign in:\n\n  482913\n\nExpires in 10 minutes."),
    "482913",
  );
});

test("中文验证信保持原样（修复不能有回归）", () => {
  assert.equal(pick("验证码", "您的验证码是 123456，5分钟内有效。"), "123456");
  assert.equal(pick("登录验证", "验证码：654321"), "654321");
  assert.equal(pick("安全提醒", "您的动态验证码为 778899"), "778899");
});

test("字母数字混合码仍然认得", () => {
  assert.equal(pick("Your code", "Your code is A1B2C3"), "A1B2C3");
});

// 2026-10-05：提取结果曾被统一 toUpperCase()，区分大小写的码（aB3dE9）被改坏成
// AB3DE9，用户照抄必然输错。码必须原样返回；只有内部比较（日期、邮箱地址判断）忽略大小写。
test("验证码保持原始大小写，不能被改成全大写", () => {
  assert.equal(pick("Your code", "Your verification code is aB3dE9"), "aB3dE9");
  assert.equal(pick("Your code", "Your code is a1b2c3"), "a1b2c3");
  assert.equal(
    pick("Sign in", "Enter this code to sign in:\n\n  xK7pQ2\n\nExpires in 10 minutes."),
    "xK7pQ2",
  );
  assert.equal(pick("验证码", "您的验证码是 Ab12Cd，5分钟内有效。"), "Ab12Cd");
});

// 「code is <混合码>」且同一行有网址时，行级候选被网址扣分、行内模式又不认 "is"，码会被整体丢掉。
test("「code is」后的字母数字混合码，同一行有网址也认得", () => {
  assert.equal(pick("Your code", "Your code is A1B2C3. Visit https://example.com/verify to continue."), "A1B2C3");
  assert.equal(pick("Your code", "Your code is aB3dE9. Visit https://example.com/verify to continue."), "aB3dE9");
  // 「code is」后面跟普通单词时不能硬凑成码
  assert.equal(pick("Newsletter", "This code is valid for everyone. See https://example.com"), null);
});

test("邮箱地址里的 token 仍按忽略大小写排除", () => {
  assert.equal(
    pick("Your code", "Sent to Ab12cd@example.com\nYour verification code is 482913"),
    "482913",
  );
});

test("纯字母词一律不再当验证码", () => {
  for (const word of ["YOUR", "CODE", "LOGIN", "EMAIL", "VERIFY", "ZWNJ"]) {
    const got = pick("Your verification code", `Please ${word} to continue.`);
    assert.notEqual(got, word, `${word} 不该被当成验证码`);
  }
});

test("年份 / 时间不能当验证码", () => {
  assert.equal(pick("注册成功", "感谢注册，2026 年见"), null);
  assert.equal(pick("Meeting", "Meeting at 10:30 on 2026-07-27"), null);
});

test("没有码时回 null，不硬凑", () => {
  assert.equal(pick("Newsletter", "Here is our weekly digest. Enjoy reading!"), null);
});
