const crypto = require('crypto');
const db = require('./db');
const { v4: uuidv4 } = require('uuid');

class McAuthModule {
    
    // 生成 Token
    generateToken(playerUuid, expireMinutes = 10) {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + expireMinutes * 60 * 1000;

        // 使用事务：清理过期 + 插入新 Token
        const createTokenTx = db.transaction(() => {
            db.prepare("DELETE FROM tokens WHERE expires_at < ?").run(Date.now());
            db.prepare("INSERT INTO tokens (token, uuid, expires_at) VALUES (?, ?, ?)")
              .run(token, playerUuid, expiresAt);
        });

        createTokenTx(); // 执行事务
        return token;
    }

    // 验证 Token
    verifyAndUse(token) {
        // 查+删 必须在一个原子操作里
        let uuid = null;
        
        const verifyTx = db.transaction(() => {
            const row = db.prepare("SELECT uuid, expires_at FROM tokens WHERE token = ?").get(token);
            if (!row) return; // 不存在

            // 立即删除 (一次性)
            db.prepare("DELETE FROM tokens WHERE token = ?").run(token);

            if (Date.now() <= row.expires_at) {
                uuid = row.uuid;
            }
        });

        verifyTx();
        return uuid;
    }

    // Web下单
    addPurchaseOrder(uuid, itemId) {
        const orderId = uuidv4();
        const time = new Date().toISOString();
        
        db.prepare("INSERT INTO purchase_queue (order_id, uuid, item_id, created_at) VALUES (?, ?, ?, ?)")
          .run(orderId, uuid, itemId, time);
          
        return { orderId, uuid, itemId, time };
    }

    // [核心] 插件获取待领取物品
    fetchPendingPurchases() {
        let orders = [];

        // 事务：读取 -> 删除
        const fetchTx = db.transaction(() => {
            // 1. 读取所有未领取订单
            orders = db.prepare("SELECT * FROM purchase_queue WHERE claimed = 0").all();
            
            if (orders.length > 0) {
                // 2. 物理删除 (防止重复领取)
                // 也可以改为 UPDATE claimed = 1
                const deleteStmt = db.prepare("DELETE FROM purchase_queue WHERE order_id = ?");
                for (const order of orders) {
                    deleteStmt.run(order.order_id);
                }
            }
        });

        fetchTx();
        return orders;
    }

    // 提交出售请求
    submitSellRequest(uuid, itemId, amount) {
        const time = new Date().toISOString();
        const info = db.prepare("INSERT INTO sell_queue (uuid, item_id, amount, created_at) VALUES (?, ?, ?, ?)")
                       .run(uuid, itemId, amount, time);
        return { id: info.lastInsertRowid, uuid, itemId, amount, time };
    }

    // Web端结算出售
    getPlayerSells(uuid) {
        let items = [];
        const sellTx = db.transaction(() => {
            items = db.prepare("SELECT * FROM sell_queue WHERE uuid = ? AND processed = 0").all(uuid);
            if (items.length > 0) {
                const deleteStmt = db.prepare("DELETE FROM sell_queue WHERE id = ?");
                for (const item of items) {
                    deleteStmt.run(item.id);
                }
            }
        });
        sellTx();
        return items;
    }
}

module.exports = new McAuthModule();