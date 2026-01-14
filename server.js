// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// 引入业务模块
const db = require('./db');           
const mcAuth = require('./mcAuth');   // SSO + 基础交易
const market = require('./market');   // 市场 + K线 + 资产 + 筹集令
const catalog = require('./catalog'); // 分类目录

const app = express(); 

// ================= 1. 全局配置 =================
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 开发环境允许跨域 (解决本地文件/本地调试访问问题)
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

// --- [新] 游戏插件专用接口 (Internal) ---

// 1. 生成登录 Token (SSO)
app.post('/api/internal/generate-token', verifyInternalApiKey, (req, res) => {
    try {
        const { uuid } = req.body;
        const token = mcAuth.generateToken(uuid);
        res.json({ success: true, token, loginUrl: `http://localhost:${process.env.PORT||3000}/login?token=${token}` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. 拉取待发货任务 (Web -> Game)
app.get('/api/internal/fetch-purchases', verifyInternalApiKey, (req, res) => {
    try { res.json({ orders: mcAuth.fetchPendingPurchases() }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. [新] 资产充值接口 (Game -> Web)
// 插件调用此接口，将游戏内的钱或物品“存入”网页账户
app.post('/api/internal/deposit', verifyInternalApiKey, (req, res) => {
    try {
        const { uuid, type, itemId, amount } = req.body;
        
        // 存钱
        if (type === 'money') {
            market._updateBalance(uuid, parseInt(amount));
            console.log(`[充值] 玩家 ${uuid} 存入 $${amount}`);
        } 
        // 存物品
        else if (type === 'item') {
            market._updateInventory(uuid, itemId, parseInt(amount));
            console.log(`[充值] 玩家 ${uuid} 存入物品 ${itemId} x${amount}`);
        }
        
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// --- 网页前端接口 (Web Frontend) ---

// 1. 登录回调
app.get('/login', (req, res) => {
    try {
        const uuid = mcAuth.verifyAndUse(req.query.token);
        if (!uuid) return res.status(403).send("Token无效或已过期");
        // 简单返回，实际项目中这里通常重定向到前端页面
        res.send(`<h1>欢迎 ${uuid}</h1><script>localStorage.setItem('currentUser', '${uuid}'); window.location.href='/';</script>`);
    } catch (err) { res.status(500).send("Login Error"); }
});

// 2. 资产查询
app.get('/api/assets/my', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    if (!uuid) return res.status(401).json({ error: "未登录" });
    try {
        const balance = market.getBalance(uuid);
        const inventory = db.prepare('SELECT item_id, amount FROM inventories WHERE uuid = ? AND amount > 0').all(uuid);
        res.json({ success: true, balance, inventory });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. 调试作弊 (给自己发钱/发货)
app.post('/api/debug/give', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    const { type, itemId, amount } = req.body;
    if (!uuid) return res.status(401).json({ error: "未登录" });
    try {
        if (type === 'money') market._updateBalance(uuid, parseInt(amount));
        else if (type === 'item') market._updateInventory(uuid, itemId, parseInt(amount));
        res.json({ success: true, msg: "作弊成功" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 基础商城 (管理员店) ---
app.post('/api/shop/purchase', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    if (!uuid) return res.status(401).json({ error: "未登录" });
    try {
        const order = mcAuth.addPurchaseOrder(uuid, req.body.itemId);
        res.json({ success: true, order });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 自由市场 (现货 Spot) ---
app.get('/api/market/orderbook', (req, res) => {
    try { res.json({ success: true, data: market.getOrderBook(req.query.itemId) }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/market/kline', (req, res) => {
    try { res.json({ success: true, data: market.getKlineData(req.query.itemId, parseInt(req.query.resolution)||60) }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/market/trades', (req, res) => {
    try { res.json({ success: true, data: market.getTradeHistory(req.query.itemId) }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/market/place', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    const { itemId, type, price, amount } = req.body;
    if (!uuid) return res.status(401).json({ error: "未登录" });
    try {
        const result = market.placeOrder(uuid, itemId, type, parseInt(price), parseInt(amount));
        res.json(result);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/market/fulfill', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    const { orderId, amount } = req.body;
    if (!uuid) return res.status(401).json({ error: "未登录" });
    try {
        const result = market.fulfillOrder(uuid, orderId, parseInt(amount));
        res.json({ success: true, msg: "交易成功", data: result });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/market/cancel', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    const { orderId } = req.body;
    if (!uuid) return res.status(401).json({ error: "未登录" });
    try {
        market.cancelOrder(uuid, orderId);
        res.json({ success: true, msg: "撤单成功" });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// --- 物资筹集令 (公会收购 Procurement) ---
app.get('/api/procurement/list', (req, res) => {
    try { res.json({ success: true, data: market.getProcurementList('OPEN') }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/procurement/create', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    const { itemId, price, targetAmount } = req.body;
    if (!uuid) return res.status(401).json({ error: "未登录" });
    try {
        const result = market.createProcurement(uuid, itemId, parseInt(price), parseInt(targetAmount));
        res.json(result);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/procurement/contribute', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    const { procurementId, amount } = req.body;
    if (!uuid) return res.status(401).json({ error: "未登录" });
    try {
        const result = market.contributeProcurement(uuid, parseInt(procurementId), parseInt(amount));
        res.json(result);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/procurement/cancel', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    const { procurementId } = req.body;
    if (!uuid) return res.status(401).json({ error: "未登录" });
    try {
        const result = market.cancelProcurement(uuid, procurementId);
        res.json(result);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// --- 分类目录 (Catalog) ---
app.get('/api/catalog/tree', (req, res) => {
    try { res.json({ success: true, data: catalog.getCategoryTree() }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/category', verifyAdmin, (req, res) => {
    try { res.json({ success: true, data: catalog.createCategory(req.body.parentId, req.body.name, req.body.sortOrder) }); } 
    catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/admin/category', verifyAdmin, (req, res) => {
    try {
        catalog.deleteCategory(req.query.id);
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/admin/item', verifyAdmin, (req, res) => {
    try {
        catalog.addItemToCategory(req.body.categoryId, req.body.itemId, req.body.displayName, req.body.iconUrl);
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// ================= 4. 启动 =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
    ===========================================
    全功能 Minecraft Shop 核心已启动 (V2.0 双向资产版)
    端口: ${PORT}
    功能: SSO, 基础商城, 现货市场, 筹集令, 资产充提
    ===========================================
    `);
});