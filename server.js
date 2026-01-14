// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// 引入业务模块
const db = require('./db');           // 引入数据库 (新增接口需要直接查库)
const mcAuth = require('./mcAuth');   // SSO + 基础交易
const market = require('./market');   // 市场 + K线 + 核心资产逻辑
const catalog = require('./catalog'); // 分类目录

const app = express(); // <--- 关键：必须先在这里初始化 app

// ================= 1. 全局配置 =================
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 开发环境允许跨域 (解决本地文件访问 CORS 问题)
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        return callback(null, true);
    },
    credentials: true
}));

// 限流: 15分钟 100次
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100 
});
app.use(limiter);

// ================= 2. 鉴权中间件 =================

// A. 内部接口鉴权 (给游戏插件用)
const verifyInternalApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.key;
    if (apiKey !== process.env.INTERNAL_API_KEY) {
        return res.status(403).json({ error: "Forbidden: Invalid API Key" });
    }
    next();
};

// B. 管理员鉴权 (给后台管理分类用)
const verifyAdmin = (req, res, next) => {
    const uuid = req.headers['x-user-uuid'];
    const adminList = (process.env.ADMIN_UUIDS || '').split(',');
    if (!uuid || !adminList.includes(uuid)) {
        return res.status(403).json({ error: "Forbidden: 需要管理员权限" });
    }
    next();
};

// ================= 3. API 路由定义 =================

// --- [新] 资产查询接口 ---
/**
 * 查询我的资产 (余额 + 库存)
 */
app.get('/api/assets/my', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    if (!uuid) return res.status(401).json({ error: "未登录" });
    
    try {
        // 1. 查余额
        const balance = market.getBalance(uuid);
        
        // 2. 查库存 (只查有的)
        const inventory = db.prepare('SELECT item_id, amount FROM inventories WHERE uuid = ? AND amount > 0').all(uuid);
        
        res.json({ success: true, balance, inventory });
    } catch (err) { 
        console.error(err);
        res.status(500).json({ error: err.message }); 
    }
});

// --- [新] 调试作弊接口 (给自己发钱/发货) ---
app.post('/api/debug/give', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    const { type, itemId, amount } = req.body;
    
    // 如果你想限制这个接口只能管理员用，可以把 verifyAdmin 加到路由里
    if (!uuid) return res.status(401).json({ error: "未登录" });

    try {
        if (type === 'money') {
            market._updateBalance(uuid, parseInt(amount));
        } else if (type === 'item') {
            market._updateInventory(uuid, itemId, parseInt(amount));
        }
        res.json({ success: true, msg: "作弊成功 (资产已到账)" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SSO 身份验证模块 ---
app.post('/api/internal/generate-token', verifyInternalApiKey, (req, res) => {
    try {
        const { uuid } = req.body;
        if (!uuid) return res.status(400).json({ error: "Missing UUID" });
        const token = mcAuth.generateToken(uuid);
        res.json({ success: true, token, loginUrl: `http://localhost:${process.env.PORT||3000}/login?token=${token}` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/login', (req, res) => {
    try {
        const uuid = mcAuth.verifyAndUse(req.query.token);
        if (!uuid) return res.status(403).send("Token无效或已过期");
        res.send(`<h1>欢迎 ${uuid}</h1><script>localStorage.setItem('currentUser', '${uuid}');</script>`);
    } catch (err) { res.status(500).send("Server Error"); }
});

// --- 基础商城模块 (管理员卖给玩家) ---
app.get('/api/internal/fetch-purchases', verifyInternalApiKey, (req, res) => {
    try {
        res.json({ orders: mcAuth.fetchPendingPurchases() });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shop/purchase', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    if (!uuid) return res.status(401).json({ error: "未登录" });
    try {
        const order = mcAuth.addPurchaseOrder(uuid, req.body.itemId);
        res.json({ success: true, order });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 自由市场模块 (玩家交易玩家) ---

// 1. 获取订单簿 (深度图)
app.get('/api/market/orderbook', (req, res) => {
    const { itemId } = req.query;
    if (!itemId) return res.status(400).json({ error: "Missing itemId" });
    try {
        res.json({ success: true, data: market.getOrderBook(itemId) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. 获取 K 线数据
app.get('/api/market/kline', (req, res) => {
    const { itemId, resolution } = req.query;
    if (!itemId) return res.status(400).json({ error: "Missing itemId" });
    try {
        const data = market.getKlineData(itemId, parseInt(resolution) || 60);
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. 获取最新成交记录
app.get('/api/market/trades', (req, res) => {
    const { itemId } = req.query;
    if (!itemId) return res.status(400).json({ error: "Missing itemId" });
    try {
        res.json({ success: true, data: market.getTradeHistory(itemId) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. 玩家挂单
app.post('/api/market/place', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    const { itemId, type, price, amount } = req.body;
    if (!uuid) return res.status(401).json({ error: "未登录" });
    try {
        const result = market.placeOrder(uuid, itemId, type, parseInt(price), parseInt(amount));
        res.json(result);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// 5. 玩家吃单 (成交)
app.post('/api/market/fulfill', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    const { orderId, amount } = req.body;
    if (!uuid) return res.status(401).json({ error: "未登录" });
    try {
        const result = market.fulfillOrder(uuid, orderId, parseInt(amount));
        res.json({ success: true, msg: "交易成功", data: result });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// 6. [新] 撤单 (退款/退货)
app.post('/api/market/cancel', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    const { orderId } = req.body;
    if (!uuid) return res.status(401).json({ error: "未登录" });
    try {
        market.cancelOrder(uuid, orderId);
        res.json({ success: true, msg: "撤单成功，资产已退回" });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// --- 分类目录模块 (Catalog) ---

// 公共：获取分类树
app.get('/api/catalog/tree', (req, res) => {
    try {
        res.json({ success: true, data: catalog.getCategoryTree() });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 管理员：创建分类
app.post('/api/admin/category', verifyAdmin, (req, res) => {
    try {
        const { parentId, name, sortOrder } = req.body;
        res.json({ success: true, data: catalog.createCategory(parentId, name, sortOrder) });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// 管理员：删除分类
app.delete('/api/admin/category', verifyAdmin, (req, res) => {
    try {
        const { id } = req.query;
        catalog.deleteCategory(id);
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// 管理员：添加/移动物品
app.post('/api/admin/item', verifyAdmin, (req, res) => {
    try {
        const { categoryId, itemId, displayName, iconUrl } = req.body;
        catalog.addItemToCategory(categoryId, itemId, displayName, iconUrl);
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// ================= 4. 启动服务 =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
    ===========================================
    全功能 Minecraft Shop 核心已启动 (终极版)
    端口: ${PORT}
    数据库: SQLite (WAL模式)
    功能: SSO, 商城, 市场(K线+资金), 目录, 资产管理
    ===========================================
    `);
});