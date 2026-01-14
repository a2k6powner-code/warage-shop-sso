const express = require('express');
const session = require('express-session');
const mcAuth = require('./mcAuth'); // 确保 mcAuth.js 在同级目录

const app = express();
const PORT = 3000;

// --- 基础中间件配置 ---
// 必须在所有路由之前配置，否则无法解析请求体
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

// 配置 Session，用于保持玩家登录状态
app.use(session({
    secret: 'mc-secret-key-128',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 600000 } // 10分钟有效期
}));

// ================= [ 1. 认证路由 ] =================

/**
 * 接口: 供插件生成 Token
 * 验证方式: curl -X POST http://localhost:3000/api/generate-token -H "Content-Type: application/json" -d "{\"playerUuid\":\"Steve-123\"}"
 */
app.post('/api/generate-token', (req, res) => {
    const { playerUuid } = req.body;
    if (!playerUuid) return res.status(400).json({ error: "Missing playerUuid" });

    const token = mcAuth.generateToken(playerUuid);
    res.json({
        token: token,
        loginUrl: `http://localhost:3000/login?token=${token}`
    });
});

/**
 * 接口: 玩家登录入口
 * 验证方式: 浏览器访问返回的 loginUrl
 */
app.get('/login', (req, res) => {
    const { token } = req.query;
    const uuid = mcAuth.verifyAndUse(token);

    if (!uuid) {
        return res.status(403).send('<h1>令牌无效或已过期</h1><p>请在游戏内重新生成链接。</p>');
    }

    // 绑定 Session
    req.session.playerUuid = uuid;
    res.redirect('/shop'); // 登录成功直接跳转商城
});

// ================= [ 2. 网页商城路由 ] =================

/**
 * 商城主页
 */
app.get('/shop', (req, res) => {
    if (!req.session.playerUuid) return res.status(401).send('<h1>未登录</h1><a href="/test">点此模拟生成Token</a>');

    const uuid = req.session.playerUuid;
    res.send(`
        <h1>MC 外部商城</h1>
        <p>当前登录玩家: <b>${uuid}</b></p>
        <hr>
        <h3>功能模拟</h3>
        <button onclick="buyItem('DIAMOND')">购买 1颗钻石</button>
        <button onclick="checkEarnings()">查看出售收入</button>
        <div id="msg" style="margin-top:20px; color: blue;"></div>

        <script>
            function buyItem(id) {
                fetch('/api/purchase', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ itemId: id })
                })
                .then(r => r.json())
                .then(d => { document.getElementById('msg').innerText = d.message; });
            }

            function checkEarnings() {
                fetch('/api/check-earnings')
                .then(r => r.json())
                .then(d => { document.getElementById('msg').innerText = JSON.stringify(d, null, 2); });
            }
        </script>
    `);
});

/**
 * 接口: 购买商品
 */
app.post('/api/purchase', (req, res) => {
    if (!req.session.playerUuid) return res.status(401).json({ error: "未登录" });
    
    const { itemId } = req.body;
    const order = mcAuth.addPurchaseOrder(req.session.playerUuid, itemId || "STONE", "Main_Vault");
    
    res.json({ success: true, message: "购买成功！物品已发往仓库队列", order });
});

/**
 * 接口: 结算出售收入
 */
app.get('/api/check-earnings', (req, res) => {
    if (!req.session.playerUuid) return res.status(401).json({ error: "未登录" });

    const earnings = mcAuth.getPlayerSells(req.session.playerUuid);
    res.json({
        player: req.session.playerUuid,
        count: earnings.length,
        items: earnings
    });
});

// ================= [ 3. 游戏插件内部接口 ] =================

/**
 * 接口: 插件拉取购买订单
 */
app.get('/api/internal/fetch-purchases', (req, res) => {
    res.json(mcAuth.getPendingPurchases());
});

/**
 * 接口: 插件提交出售请求
 */
app.post('/api/internal/submit-sell', (req, res) => {
    const { uuid, itemId, amount } = req.body;
    if (!uuid || !itemId) return res.status(400).send("参数不足");

    const record = mcAuth.submitSellRequest(uuid, itemId, amount);
    res.json({ success: true, record });
});

// ================= [ 4. 调试辅助 ] =================

app.get('/test', (req, res) => {
    const token = mcAuth.generateToken("Dev_Player");
    res.send(`测试用：<a href="/login?token=${token}">点击以 Dev_Player 身份登录</a>`);
});

app.listen(PORT, () => {
    console.log(`
=========================================
MC 互联服务端 (完整版) 已启动
运行地址: http://localhost:${PORT}
-----------------------------------------
1. 插件生成 Token: POST /api/generate-token
2. 插件获取购买: GET /api/internal/fetch-purchases
3. 插件提交出售: POST /api/internal/submit-sell
=========================================
    `);
});