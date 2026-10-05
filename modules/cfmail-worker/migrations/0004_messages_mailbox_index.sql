-- 按信箱取邮件的复合索引，与 kit/schema/0000_base.sql 的同名索引完全一致。
-- 从老项目继承的库建表时没有这条索引：/admin/mailboxes 里「最近验证码」两个相关子查询
-- 对每个信箱各全表扫一遍 messages，单次读取 ≈ 2 × 信箱数 × 邮件数行，耗尽 D1 每日读取额度。
-- kit 新建的库已有此索引，IF NOT EXISTS 让本迁移在那里是空操作。
CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received ON messages(mailbox_id, received_at DESC);
