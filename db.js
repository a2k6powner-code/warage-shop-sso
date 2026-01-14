// db.js
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'shop.sqlite'), { 
    // verbose: console.log 
});

db.pragma('journal_mode = WAL'); 
db.pragma('synchronous = NORMAL'); 

const initSchema = () => {
    // ... 原有的 tokens, purchase_queue, sell_queue, orders, trades, categories, items 表保持不变 ...
    // (为了节省篇幅，这里只列出新增的表，请保留你原有的代码)

    db.prepare(`
        CREATE TABLE IF NOT EXISTS tokens (
            token TEXT PRIMARY KEY,
            uuid TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        )
    `).run();
    db.prepare(`
        CREATE TABLE IF NOT EXISTS purchase_queue (
            order_id TEXT PRIMARY KEY,
            uuid TEXT NOT NULL,
            item_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            claimed INTEGER DEFAULT 0
        )
    `).run();
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
    db.prepare(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL,
            item_id TEXT NOT NULL,
            type TEXT NOT NULL,
            price INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            initial_amount INTEGER NOT NULL,
            status TEXT DEFAULT 'OPEN',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `).run();
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
    db.prepare(`
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_id INTEGER DEFAULT NULL,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        )
    `).run();
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

    // ================= [新] 资产管理表 =================
    
    // 8. 玩家钱包 (存钱)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS wallets (
            uuid TEXT PRIMARY KEY,
            balance INTEGER DEFAULT 0
        )
    `).run();

    // 9. 玩家仓库 (存物品)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS inventories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL,
            item_id TEXT NOT NULL,
            amount INTEGER DEFAULT 0,
            UNIQUE(uuid, item_id) -- 每个玩家每种物品只有一条记录
        )
    `).run();

    // 索引
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_sell ON orders (item_id, type, status, price ASC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_buy ON orders (item_id, type, status, price DESC)`).run();

    console.log("SQLite (WAL模式) 数据库加载完成 (含资产系统)");
};

initSchema();

module.exports = db;