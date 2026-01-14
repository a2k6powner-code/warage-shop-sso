require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mcAuth = require('./mcAuth');

const app = express();

// --- 安全配置 ---
app.use(helmet()); // 防止常见 HTTP 头攻击
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 严格的 CORS 配置
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:8080', // 仅允许前端域名
    credentials: true
}));

// 速率限制 (防止 DDoS 和 暴力破解)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 100 // 每个IP限制100次请求
});
app.use(limiter);

// --- 中间件：内部 API 鉴权 ---
// 任何 /api/internal/ 开头的请求必须携带正确的 API Key
const verifyInternalApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.key;
    if (apiKey !== process.env.INTERNAL_API_KEY) {
        console.warn(`[安全警报] IP ${req.ip} 尝试非法访问内部接口`);
        return res.status(403).json({ error: "Forbidden: Invalid API Key" });
    }
    next();
};

// --- API 路由 ---

/**
 * 1. 生成 Token (已移至内部接口！)
 * 只有可信的游戏服务器插件才能请求生成 Token，玩家不能自己生成。
 * 插件调用此接口获取 Token，然后发给玩家点击链接。
 */
app.post('/api/internal/generate-token', verifyInternalApiKey, async (req, res) => {
    try {
        const { uuid } = req.body;
        if (!uuid) return res.status(400).json({ error: "Missing UUID" });
        
        const token = await mcAuth.generateToken(uuid);
        // 返回完整的登录 URL 给插件，插件显示给玩家
        const loginUrl = `http://localhost:${process.env.PORT}/login?token=${token}`;
        res.json({ success: true, token, loginUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 2. 玩家登录处理
 * 验证 Token 并设置简单的 Cookie/Session 标识
 */
app.get('/login', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).send("Token缺失");

    try {
        const uuid = await mcAuth.verifyAndUse(token);
        if (!uuid) return res.status(403).send("链接失效或已过期，请在游戏中重新输入命令获取");
        
        // 简单模拟 Session，实际建议使用 JWT 或 express-session
        // 这里为了演示，直接设置一个签名的 Cookie (需配合 cookie-parser，此处简化)
        // 在生产环境中，你应该发放一个 JWT 给前端
        res.send(`
            <h1>登录成功</h1>
            <p>欢迎玩家: ${uuid}</p>
            <script>
                // 模拟将用户信息存入 LocalStorage，供前端使用
                localStorage.setItem('currentUser', '${uuid}');
                window.location.href = '${process.env.CORS_ORIGIN}/shop'; 
            </script>
        `);
    } catch (err) {
        res.status(500).send("服务器内部错误");
    }
});

/**
 * 3. 插件拉取待发货订单 (内部接口)
 */
app.get('/api/internal/fetch-purchases', verifyInternalApiKey, async (req, res) => {
    try {
        const orders = await mcAuth.fetchPendingPurchases();
        res.json({ count: orders.length, orders });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 4. 插件提交玩家出售记录 (内部接口)
 */
app.post('/api/internal/submit-sell', verifyInternalApiKey, async (req, res) => {
    try {
        const { uuid, itemId, amount } = req.body;
        if (!uuid || !itemId || !amount) return res.status(400).json({ error: "参数不全" });
        
        const record = await mcAuth.submitSellRequest(uuid, itemId, amount);
        res.json({ success: true, record });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 5. Web端接口：玩家购买物品
 * (实际项目中这里应该验证 JWT 或 Session)
 */
app.post('/api/shop/purchase', async (req, res) => {
    // 简化：假设前端在 Header 里传了用户 UUID (不安全，实际请用 JWT)
    const uuid = req.headers['x-user-uuid']; 
    const { itemId } = req.body;

    if (!uuid || !itemId) return res.status(401).json({ error: "未授权或参数错误" });

    try {
        const order = await mcAuth.addPurchaseOrder(uuid, itemId);
        res.json({ success: true, msg: "下单成功，请在游戏内查收", order });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 6. Web端接口：查询出售收益
 */
app.get('/api/shop/earnings', async (req, res) => {
    const uuid = req.headers['x-user-uuid']; // 同样，实际请用 JWT
    if (!uuid) return res.status(401).json({ error: "未授权" });

    try {
        const items = await mcAuth.getPlayerSells(uuid);
        res.json({ success: true, items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
    ===========================================
    安全版 Minecraft Shop SSO 核心已启动
    端口: ${PORT}
    数据库: SQLite (本地文件)
    ===========================================
    `);
});