const express = require('express');
const session = require('express-session');
const mcAuth = require('./mcAuth');
const router = express.Router();

// --- 接口粘合定义 ---

// 1. 认证类接口
router.post('/api/generate-token', (req, res) => {
    const { playerUuid } = req.body;
    if (!playerUuid) return res.status(400).json({ error: "Missing UUID" });
    const token = mcAuth.generateToken(playerUuid);
    res.json({ token, loginUrl: `/login?token=${token}` });
});

router.get('/login', (req, res) => {
    const uuid = mcAuth.verifyToken(req.query.token);
    if (!uuid) return res.status(403).send("Invalid Token");
    req.session.playerUuid = uuid; // 粘合到 Session
    res.send(`登录成功，欢迎 ${uuid}`);
});

// 2. 玩家操作类接口
router.post('/api/purchase', (req, res) => {
    if (!req.session.playerUuid) return res.status(401).json({ error: "Unauthorized" });
    const order = mcAuth.addPurchase(req.session.playerUuid, req.body.itemId);
    res.json({ success: true, order });
});

router.get('/api/check-earnings', (req, res) => {
    if (!req.session.playerUuid) return res.status(401).json({ error: "Unauthorized" });
    const items = mcAuth.popSells(req.session.playerUuid);
    res.json({ items });
});

// 3. 游戏插件内部接口
router.get('/api/internal/fetch-purchases', (req, res) => {
    res.json(mcAuth.popPurchases());
});

router.post('/api/internal/submit-sell', (req, res) => {
    const { uuid, itemId, amount } = req.body;
    mcAuth.addSell(uuid, itemId, amount);
    res.json({ success: true });
});

// 导出这个路由粘合层
module.exports = router;