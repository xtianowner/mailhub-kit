-- 按小写地址查信箱的表达式索引，与 kit/schema/0000_base.sql 的同名索引完全一致。
-- 取码（/api/mailboxes/code）、按地址看信（/admin/mails）、改备注、收信登记、发信都用
-- `WHERE lower(email) = ?` 找信箱：email 列上的唯一索引对 lower(email) 无效，每次都全表扫描 mailboxes。
-- 新建信箱后的等码面板每 5～10 秒取一次码，读取行数 = 信箱总数 × 检查次数，这条索引把每次降到个位数。
-- 列上的唯一约束不变；IF NOT EXISTS 让本迁移在已有此索引的库上是空操作。
CREATE INDEX IF NOT EXISTS idx_mailboxes_email_lower ON mailboxes(lower(email));
