// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const db = require('./db');
const mcAuth = require('./mcAuth');
const market = require('./market');
const catalog = require('./catalog');

const app = express();

app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: (o, c) => c(null, true), credentials: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// ================= 2. 鉴权中间件 =================

// A. 插件端鉴权 (API Key)
const verifyInternal = (req, res, next) => {
    if ((req.headers['x-api-key'] || req.query.key) !== process.env.INTERNAL_API_KEY) {
        return res.status(403).json({ error: "Invalid API Key" });
    }
    next();
};

// B. 网页端鉴权 (Token)
const verifyWebUser = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "No token provided" });

    const user = mcAuth.verifyToken(token); // 验证是否过期
    if (!user) return res.status(403).json({ error: "Token expired or invalid" });

    req.user = user; // 包含 { token, uuid }
    next();
};

// C. [修复] 管理员鉴权 (兼容 Token 和 Header)
const verifyAdmin = (req, res, next) => {
    let uuid;

    // 1. 尝试从 Token 获取 UUID (网页端管理员)
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
        const user = mcAuth.verifyToken(token);
        if (user) uuid = user.uuid;
    }

    // 2. 尝试从 Header 获取 UUID (旧版/测试工具兼容)
    if (!uuid) {
        uuid = req.headers['x-user-uuid'];
    }

    // 3. 验证是否在管理员白名单中
    const adminList = (process.env.ADMIN_UUIDS || '').split(',');
    if (!uuid || !adminList.includes(uuid)) {
        return res.status(403).json({ error: "Forbidden: 需要管理员权限" });
    }
    
    next();
};

// ================= 3. 路由定义 =================

// --- A. 插件端交互 (Internal) ---

app.post('/api/internal/generate-token', verifyInternal, (req, res) => {
    const token = mcAuth.generateToken(req.body.uuid);
    res.json({ success: true, token, loginUrl: `http://localhost:3000/login?token=${token}` });
});

app.post('/api/internal/deposit', verifyInternal, (req, res) => {
    const { uuid, type, itemId, amount } = req.body;
    market.depositToPending(uuid, type, itemId, parseInt(amount));
    console.log(`[充值] ${uuid} 存入 ${amount} (待领)`);
    res.json({ success: true });
});

app.get('/api/internal/fetch-purchases', verifyInternal, (req, res) => {
    res.json({ orders: mcAuth.fetchPendingPurchases() });
});

// --- B. 网页端交互 (Web) ---

// 1. 登录跳转
app.get('/login', (req, res) => {
    const token = req.query.token;
    const user = mcAuth.verifyToken(token);
    if (!user) return res.send("链接已失效");
    
    res.send(`
        <html><body>
        <h1>正在登录...</h1>
        <script>
            localStorage.setItem('shop_token', '${token}');
            localStorage.setItem('shop_uuid', '${user.uuid}');
            // window.location.href = '/index.html'; 
            document.body.innerHTML = '<h1>登录成功！Token有效期30天。</h1><p>钱包ID: ${token.substring(0,8)}...</p>';
        </script>
        </body></html>
    `);
});

// 2. 资产查询 & 认领
app.get('/api/assets/my', verifyWebUser, (req, res) => {
    const balance = market.getBalance(req.user.token);
    const inventory = db.prepare('SELECT item_id, amount FROM inventories WHERE token = ?').all(req.user.token);
    const pending = market.getPendingDeposits(req.user.uuid);
    res.json({ success: true, balance, inventory, pending });
});

app.post('/api/assets/claim', verifyWebUser, (req, res) => {
    try {
        const result = market.claimDeposit(req.user.token, req.body.depositId, req.user.uuid);
        res.json({ success: true, data: result });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/assets/withdraw', verifyWebUser, (req, res) => {
    try {
        const { itemId, amount } = req.body;
        market._updateInventory(req.user.token, itemId, -parseInt(amount));
        mcAuth.addPurchaseOrder(req.user.uuid, itemId); // 简化版只发1个，需自行扩展
        res.json({ success: true, msg: "提现请求已提交" });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// 3. 市场交易
app.get('/api/market/orderbook', (req, res) => res.json({ success: true, data: market.getOrderBook(req.query.itemId) }));
app.get('/api/market/trades', (req, res) => res.json({ success: true, data: market.getTradeHistory(req.query.itemId) }));
app.get('/api/market/kline', (req, res) => res.json({ success: true, data: market.getKlineData(req.query.itemId, parseInt(req.query.resolution)||60) }));

app.post('/api/market/place', verifyWebUser, (req, res) => {
    try {
        const { itemId, type, price, amount } = req.body;
        market.placeOrder(req.user.token, req.user.uuid, itemId, type, parseInt(price), parseInt(amount));
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/market/fulfill', verifyWebUser, (req, res) => {
    try {
        market.fulfillOrder(req.user.token, req.body.orderId, parseInt(req.body.amount));
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/market/cancel', verifyWebUser, (req, res) => {
    try {
        market.cancelOrder(req.user.token, req.body.orderId);
        res.json({ success: true, msg: "撤单成功" });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// 4. 筹集令
app.get('/api/procurement/list', (req, res) => res.json({ success: true, data: market.getProcurementList() }));

app.post('/api/procurement/create', verifyWebUser, (req, res) => {
    try {
        const { itemId, price, targetAmount } = req.body;
        market.createProcurement(req.user.token, req.user.uuid, itemId, parseInt(price), parseInt(targetAmount));
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/procurement/contribute', verifyWebUser, (req, res) => {
    try {
        market.contributeProcurement(req.user.token, req.body.procurementId, parseInt(req.body.amount));
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// 5. 目录管理 (管理员)
app.post('/api/admin/category', verifyAdmin, (req, res) => {
    try {
        res.json({ success: true, data: catalog.createCategory(req.body.parentId, req.body.name, req.body.sortOrder) });
    } catch (err) { res.status(400).json({ error: err.message }); }
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

// 6. 调试接口 (兼容旧测试代码)
app.post('/api/debug/give', (req, res) => {
    const uuid = req.headers['x-user-uuid'];
    if (!uuid) return res.status(401).json({ error: "未登录" });
    // 这里为了兼容旧测试脚本，简单处理，实际上新版建议走 deposit 流程
    // 如果是旧测试脚本(无Token)，我们无法往钱包发钱，只能往 pending 发
    market.depositToPending(uuid, req.body.type, req.body.itemId, parseInt(req.body.amount));
    res.json({ success: true, msg: "资产已发至待领区，请通过Token认领" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT} (30-Day Token Mode)`));