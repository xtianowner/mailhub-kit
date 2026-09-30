import { StepError, needHuman } from "./common.mjs";

// Prepare a real recipient without generating mail or exposing the mailbox token.
export async function prepareTestMailbox({ domain, address = `test@${domain}`, request }) {
  address = address.trim().toLowerCase();
  const [name, recipientDomain, extra] = address.split("@");
  if (extra !== undefined || recipientDomain !== domain || !/^[a-z0-9][a-z0-9._+-]{0,63}$/.test(name || "")) {
    throw new StepError("测试地址必须属于当前域名，且使用有效的邮箱前缀", { code: 2 });
  }
  const domains = await request("/admin/domains");
  if (!domains.domains?.includes(domain)) throw new StepError("测试域名未启用，不能准备收件地址");
  let existing;
  for (let offset = 0; ; offset += 1000) {
    const page = await request(`/admin/mailboxes?q=${encodeURIComponent(address)}&limit=1000&offset=${offset}`);
    if (!Array.isArray(page.results)) throw new StepError("无法确认测试邮箱状态");
    existing = page.results.find((box) => box.email?.toLowerCase() === address);
    if (existing || page.results.length < 1000) break;
  }
  if (existing && existing.status !== "active") {
    throw needHuman(`测试邮箱 ${address} 已被停用`, "请在网页确认是否恢复它，或使用 prepare-test --mail <其它地址>。不会自动重新启用。");
  }
  if (!existing || existing.fingerprint === "auto-inbound") {
    const created = await request("/admin/new_address", { method: "POST", body: { name, domain } });
    if (created.email !== address || !created.id) throw new StepError("登记结果与测试地址不一致，请检查域名配置");
  }
  return address;
}
