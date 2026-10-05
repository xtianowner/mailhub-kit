-- 按收信时间倒序的索引，与 kit/schema/0000_base.sql 的同名索引完全一致。
-- 从老项目继承的库没有它：/admin/messages/recent（总览时间线，前端每 20 秒轮询一次）
-- 每次都全表扫描 messages 再排序，读取行数随邮件总数线性增长，页面长开会持续消耗 D1 读取额度。
-- kit 新建的库已有此索引，IF NOT EXISTS 让本迁移在那里是空操作。
CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages(received_at DESC);
