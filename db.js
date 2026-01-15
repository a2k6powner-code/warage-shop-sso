// db.js
const Database = require('better-sqlite3');
const path = require('path');

// 连接数据库
const db = new Database(path.join(__dirname, 'shop.sqlite'), { 
    // verbose: console.log // 调试时可以打开，看具体的 SQL 语句
});

// 开启 WAL 模式 (提高并发读写性能)
db.pragma('journal_mode = WAL'); 
db.pragma('synchronous = NORMAL'); 

// ==========================================
// 📜 数据库演变历史 (MIGRATIONS)
// 只要你修改了这里，服务器重启时就会自动应用变更
// ==========================================
const MIGRATIONS = [
    
    // [v0] 初始完整架构 (Token系统 + 资产 + 商城 + 筹集令)
    `
    -- 1. 令牌表 (Session/Wallet ID)
    CREATE TABLE IF NOT EXISTS tokens (
        token TEXT PRIMARY KEY,
        uuid TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );

    -- 2. 待领资产表 (Pending Deposits)
    CREATE TABLE IF NOT EXISTS pending_deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL,
        type TEXT NOT NULL,
        item_id TEXT,
        amount INTEGER NOT NULL,
        created_at TEXT NOT NULL
    );

    -- 3. 钱包余额表
    CREATE TABLE IF NOT EXISTS wallets (
        token TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 0
    );

    -- 4. 仓库表
    CREATE TABLE IF NOT EXISTS inventories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL,
        item_id TEXT NOT NULL,
        amount INTEGER DEFAULT 0,
        UNIQUE(token, item_id)
    );

    -- 5. 订单表 (绑定到 token)
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL,
        uuid TEXT NOT NULL,
        item_id TEXT NOT NULL,
        type TEXT NOT NULL,
        price INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        initial_amount INTEGER NOT NULL,
        status TEXT DEFAULT 'OPEN',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    -- 6. 购买/提现队列 (Web -> Game)
    CREATE TABLE IF NOT EXISTS purchase_queue (
        order_id TEXT PRIMARY KEY,
        uuid TEXT NOT NULL,
        item_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        claimed INTEGER DEFAULT 0
    );

    -- 7. 交易历史表 (K线数据源)
    CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buy_order_id INTEGER,
        sell_order_id INTEGER,
        item_id TEXT NOT NULL,
        price INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        created_at TEXT NOT NULL
    );

    -- 8. 分类与物品表
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER DEFAULT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        item_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        icon_url TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    -- 9. 筹集令 (Procurements)
    CREATE TABLE IF NOT EXISTS procurements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL,
        uuid TEXT NOT NULL,
        item_id TEXT NOT NULL,
        price_per_unit INTEGER NOT NULL,
        target_amount INTEGER NOT NULL,
        filled_amount INTEGER DEFAULT 0,
        status TEXT DEFAULT 'OPEN',
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS procurement_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        procurement_id INTEGER NOT NULL,
        contributor_token TEXT NOT NULL,
        amount INTEGER NOT NULL,
        earnings INTEGER NOT NULL,
        created_at TEXT NOT NULL
    );

    -- 10. 索引优化
    CREATE INDEX IF NOT EXISTS idx_orders_sell ON orders (item_id, type, status, price ASC);
    CREATE INDEX IF NOT EXISTS idx_orders_buy ON orders (item_id, type, status, price DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_time ON trades (item_id, created_at ASC);
    `
    
    // --- 未来如果有新改动，在这里添加逗号，写下一段 SQL ---
    // , `ALTER TABLE wallets ADD COLUMN is_vip INTEGER DEFAULT 0;`
];

// ==========================================
// ⚙️ 自动迁移逻辑 (不要修改下面)
// ==========================================
const initSchema = () => {
    // 1. 获取当前数据库的内部版本号 (默认为 0)
    const currentVersion = db.pragma('user_version', { simple: true });
    
    console.log(`[DB] 当前版本: v${currentVersion} | 最新版本: v${MIGRATIONS.length}`);

    if (currentVersion < MIGRATIONS.length) {
        // 开启事务，确保升级要么全成功，要么全失败，不会破坏数据
        const runMigration = db.transaction(() => {
            for (let v = currentVersion; v < MIGRATIONS.length; v++) {
                console.log(`[DB] 🔄 正在执行升级: v${v} -> v${v+1}...`);
                
                // 执行 SQL
                db.exec(MIGRATIONS[v]);
                
                // 更新数据库版本号
                db.pragma(`user_version = ${v + 1}`);
            }
        });

        try {
            runMigration();
            console.log("[DB] ✅ 数据库升级完成！");
        } catch (err) {
            console.error("[DB] ❌ 数据库升级失败，服务器已停止防止数据损坏。");
            console.error(err);
            process.exit(1); 
        }
    } else {
        console.log("[DB] ✅ 数据库已是最新。");
    }
};

// 启动时立即执行检查
initSchema();

module.exports = db;