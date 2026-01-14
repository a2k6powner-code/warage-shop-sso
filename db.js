// db.js
const Database = require('better-sqlite3');
const path = require('path');

// 连接数据库 (自动创建 shop.sqlite)
const db = new Database(path.join(__dirname, 'shop.sqlite'), { 
    // verbose: console.log // 调试时取消注释，可看SQL语句
});

// ==========================================
// 性能优化：开启 WAL 模式 (Write-Ahead Logging)
// ==========================================
db.pragma('journal_mode = WAL'); 
db.pragma('synchronous = NORMAL'); 

const initSchema = () => {
    // 1. SSO Token 表
    db.prepare(`
        CREATE TABLE IF NOT EXISTS tokens (
            token TEXT PRIMARY KEY,
            uuid TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        )
    `).run();

    // 2. 基础购买队列 (Web -> 游戏内)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS purchase_queue (
            order_id TEXT PRIMARY KEY,
            uuid TEXT NOT NULL,
            item_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            claimed INTEGER DEFAULT 0
        )
    `).run();

    // 3. 基础出售队列 (游戏内 -> Web)
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

    // 4. 市场挂单表 (Order Book)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL,
            item_id TEXT NOT NULL,
            type TEXT NOT NULL,          -- 'BUY' or 'SELL'
            price INTEGER NOT NULL,
            amount INTEGER NOT NULL,     -- 剩余数量
            initial_amount INTEGER NOT NULL,
            status TEXT DEFAULT 'OPEN',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `).run();

    // 5. 市场成交记录表 (K线图数据源)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            buy_order_id INTEGER,
            sell_order_id INTEGER,
            item_id TEXT NOT NULL,
            price INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )
    `).run();

    // 市场查询索引
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_sell ON orders (item_id, type, status, price ASC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_buy ON orders (item_id, type, status, price DESC)`).run();

    // 6. [新] 分类目录表 (无限层级)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_id INTEGER DEFAULT NULL,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        )
    `).run();

    // 7. [新] 商品档案表 (定义物品名和所属分类)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER NOT NULL,
            item_id TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            icon_url TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE
        )
    `).run();

    console.log("SQLite (WAL模式) 数据库架构加载完成 (全模块)");
};

initSchema();

module.exports = db;