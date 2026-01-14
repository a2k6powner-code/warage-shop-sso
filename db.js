const Database = require('better-sqlite3');
const path = require('path');

// 连接数据库 (文件名为 shop.sqlite)
// verbose: console.log 可以看到具体执行的 SQL，方便调试
const db = new Database(path.join(__dirname, 'shop.sqlite'), { 
    // verbose: console.log 
});

// ==========================================
// 核心优化：开启 WAL 模式 (Write-Ahead Logging)
// 这就是你想要的“高性能/企业级”效果
// ==========================================
db.pragma('journal_mode = WAL'); 
db.pragma('synchronous = NORMAL'); // 进一步提升写入速度，兼顾安全性

// 初始化表结构
const initSchema = () => {
    // 1. Token 表
    db.prepare(`
        CREATE TABLE IF NOT EXISTS tokens (
            token TEXT PRIMARY KEY,
            uuid TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        )
    `).run();

    // 2. 购买队列
    db.prepare(`
        CREATE TABLE IF NOT EXISTS purchase_queue (
            order_id TEXT PRIMARY KEY,
            uuid TEXT NOT NULL,
            item_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            claimed INTEGER DEFAULT 0
        )
    `).run();

    // 3. 出售队列
    db.prepare(`
        CREATE TABLE IF NOT EXISTS sell_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL,
            item_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            processed INTEGER DEFAULT 0
        )
    `).run();
    
    console.log("SQLite (WAL模式) 数据库加载完成");
};

initSchema();

module.exports = db;