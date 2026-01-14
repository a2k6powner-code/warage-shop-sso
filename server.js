// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// 引入业务模块
const mcAuth = require('./mcAuth');   // SSO + 基础交易
const market = require('./market');   // 市场 + K线
const catalog = require('./catalog'); // 分类目录

const app = express();

// ================= 1. 全局配置 =================
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:8080', 
    credentials: true
}));

// 限流: 15分钟 100次 (测试时可调大)
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

// 2. [新] 获取 K 线数据 (TradingView格式)
// 参数: resolution=60 (单位分钟)
app.get('/api/market/kline', (req, res) => {
    const { itemId, resolution } = req.query;
    if (!itemId) return res.status(400).json({ error: "Missing itemId" });
    try {
        const data = market.getKlineData(itemId, parseInt(resolution) || 60);
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. 获取最新成交记录 (原始数据)
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
    全功能 Minecraft Shop 核心已启动
    端口: ${PORT}
    数据库: SQLite (WAL模式)
    功能: SSO, 商城, 市场(K线), 目录树
    ===========================================
    `);
});