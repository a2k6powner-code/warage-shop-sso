const crypto = require('crypto');

class McAuthModule {
    constructor() {
        this.tokenDb = new Map();
        this.purchaseQueue = []; // Web -> 游戏 (买入)
        this.sellQueue = [];     // 游戏 -> Web (卖出)
    }

    // --- 认证：生成 128位 Token ---
    generateToken(playerUuid, expireMinutes = 5) {
        const token = crypto.randomBytes(64).toString('hex');
        const expiry = Date.now() + expireMinutes * 60 * 1000;
        this.tokenDb.set(token, { uuid: playerUuid, expiry });
        return token;
    }

    // --- 认证：验证并销毁 Token ---
    verifyAndUse(token) {
        const record = this.tokenDb.get(token);
        if (!record || Date.now() > record.expiry) {
            if (record) this.tokenDb.delete(token);
            return null;
        }
        this.tokenDb.delete(token);
        return record.uuid;
    }

    // --- 买入：Web端下单 ---
    addPurchaseOrder(uuid, itemId) {
        const order = {
            orderId: crypto.randomBytes(4).toString('hex'),
            uuid, itemId, time: new Date().toISOString()
        };
        this.purchaseQueue.push(order);
        return order;
    }

    // --- 买入：插件领取并清空 ---
    getPendingPurchases() {
        const orders = [...this.purchaseQueue];
        this.purchaseQueue = [];
        return orders;
    }

    // --- 卖出：插件提交数据 ---
    submitSellRequest(uuid, itemId, amount) {
        const record = { uuid, itemId, amount: parseInt(amount), time: new Date().toISOString() };
        this.sellQueue.push(record);
        return record;
    }

    // --- 卖出：网页结算并清空 ---
    getPlayerSells(uuid) {
        const playerSells = this.sellQueue.filter(s => s.uuid === uuid);
        this.sellQueue = this.sellQueue.filter(s => s.uuid !== uuid);
        return playerSells;
    }
}

module.exports = new McAuthModule();