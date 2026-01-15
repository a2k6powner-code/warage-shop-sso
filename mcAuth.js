// mcAuth.js
const crypto = require('crypto');
const db = require('./db');

// 生成 30 天有效的新 Token (新钱包)
function generateToken(uuid) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + (30 * 24 * 60 * 60 * 1000); // 30天后过期

    db.prepare(`
        INSERT INTO tokens (token, uuid, created_at, expires_at)
        VALUES (?, ?, ?, ?)
    `).run(token, uuid, now, expiresAt);

    return token;
}

// 验证 Token 是否有效
function verifyToken(token) {
    const row = db.prepare('SELECT * FROM tokens WHERE token = ?').get(token);
    
    if (!row) return null;
    if (Date.now() > row.expires_at) {
        // 过期了，但这行记录可以留着做日志，或者另行清理
        return null; 
    }
    
    return row; // 返回包含 uuid 和 token 的对象
}

// 发货逻辑 (Web -> Game)
function addPurchaseOrder(uuid, itemId) {
    const orderId = crypto.randomUUID();
    db.prepare(`
        INSERT INTO purchase_queue (order_id, uuid, item_id, created_at)
        VALUES (?, ?, ?, ?)
    `).run(orderId, uuid, itemId, new Date().toISOString());
    return { orderId, itemId };
}

function fetchPendingPurchases() {
    const orders = db.prepare(`SELECT * FROM purchase_queue WHERE claimed = 0`).all();
    if (orders.length > 0) {
        const ids = orders.map(o => `'${o.order_id}'`).join(',');
        db.prepare(`UPDATE purchase_queue SET claimed = 1 WHERE order_id IN (${ids})`).run();
    }
    return orders;
}

module.exports = { generateToken, verifyToken, addPurchaseOrder, fetchPendingPurchases };