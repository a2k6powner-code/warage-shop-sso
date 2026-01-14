const express = require('express');
const router = express.Router();
const mcAuth = require('./mcAuth');

// 1. 玩家登录逻辑
router.get('/api/generate-token', (req, res) => {
    const token = mcAuth.generateToken(req.query.uuid || 'Player_Test');
    res.send(`Token: ${token} <br> <a href="/login?token=${token}">点击登录</a>`);
});

router.get('/login', (req, res) => {
    const uuid = mcAuth.verifyAndUse(req.query.token);
    if (!uuid) return res.status(403).send("Token无效或过期");
    req.session.playerUuid = uuid;
    res.redirect('/shop');
});

// 2. 购买接口 (Web端调用)
router.post('/api/purchase', (req, res) => {
    if (!req.session.playerUuid) return res.status(401).json({ error: "未登录" });
    const order = mcAuth.addPurchaseOrder(req.session.playerUuid, req.body.itemId);
    res.json({ success: true, order });
});

// 3. 出售结算接口 (Web端调用)
router.get('/api/check-earnings', (req, res) => {
    if (!req.session.playerUuid) return res.status(401).json({ error: "未登录" });
    const items = mcAuth.getPlayerSells(req.session.playerUuid);
    res.json({ items });
});

// 4. 插件专用接口 (内部调用)
router.get('/api/internal/fetch-purchases', (req, res) => {
    res.json(mcAuth.getPendingPurchases());
});

router.post('/api/internal/submit-sell', (req, res) => {
    const { uuid, itemId, amount } = req.body;
    const record = mcAuth.submitSellRequest(uuid, itemId, amount);
    res.json({ success: true, record });
});

module.exports = router;