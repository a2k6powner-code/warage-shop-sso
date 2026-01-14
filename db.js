// db.js
const Database = require('better-sqlite3');
const path = require('path');

// 连接数据库
const db = new Database(path.join(__dirname, 'shop.sqlite'), { 
    // verbose: console.log // 调试时可打开
});

// 开启 WAL 模式提高并发性能
db.pragma('journal_mode = WAL'); 
db.pragma('synchronous = NORMAL'); 

const initSchema = () => {
    // --- 基础认证与队列 ---
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

    // --- 现货市场 (Order Book) ---
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

    // --- 分类目录 ---
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

    // --- 资产系统 (Web钱包/仓库) ---
    db.prepare(`
        CREATE TABLE IF NOT EXISTS wallets (
            uuid TEXT PRIMARY KEY,
            balance INTEGER DEFAULT 0
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS inventories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL,
            item_id TEXT NOT NULL,
            amount INTEGER DEFAULT 0,
            UNIQUE(uuid, item_id)
        )
    `).run();

    // --- [新] 物资筹集令 (公会收购) ---
    // 1. 筹集令主表
    db.prepare(`
        CREATE TABLE IF NOT EXISTS procurements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL,          -- 发起人
            item_id TEXT NOT NULL,       -- 收什么
            price_per_unit INTEGER NOT NULL, -- 单价
            target_amount INTEGER NOT NULL,  -- 总需求量
            filled_amount INTEGER DEFAULT 0, -- 已收数量
            status TEXT DEFAULT 'OPEN',  -- OPEN, FILLED, CANCELLED
            created_at TEXT NOT NULL
        )
    `).run();

    // 2. 贡献记录表 (散人交货记录)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS procurement_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            procurement_id INTEGER NOT NULL,
            contributor_uuid TEXT NOT NULL, -- 贡献者
            amount INTEGER NOT NULL,        -- 交了多少
            earnings INTEGER NOT NULL,      -- 赚了多少钱
            created_at TEXT NOT NULL
        )
    `).run();

    // --- 索引优化 ---
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_sell ON orders (item_id, type, status, price ASC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_buy ON orders (item_id, type, status, price DESC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_trades_time ON trades (item_id, created_at ASC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_procurements_status ON procurements (status)`).run();

    console.log("SQLite (WAL模式) 完整数据库架构加载完成");
};

initSchema();

module.exports = db;