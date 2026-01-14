const crypto = require('crypto');

class McAuthModule {
    constructor() {
        this.tokenDb = new Map();
        this.purchaseQueue = [];
        this.sellQueue = [];
    }

    // 生成 128 位 Token
    generateToken(playerUuid, expireMinutes = 5) {
        const token = crypto.randomBytes(64).toString('hex');
        const expiry = Date.now() + expireMinutes * 60 * 1000;
        this.tokenDb.set(token, { uuid: playerUuid, expiry });
        return token;
    }

    // 验证 Token
    verifyToken(token) {
        const record = this.tokenDb.get(token);
        if (!record || Date.now() > record.expiry) {
            if (record) this.tokenDb.delete(token);
            return null;
        }
        this.tokenDb.delete(token);
        return record.uuid;
    }

    // 订单处理
    addPurchase(uuid, itemId) {
        const order = { orderId: crypto.randomBytes(4).toString('hex'), uuid, itemId, time: new Date().toISOString() };
        this.purchaseQueue.push(order);
        return order;
    }

    popPurchases() {
        const orders = [...this.purchaseQueue];
        this.purchaseQueue = [];
        return orders;
    }

    // 出售处理
    addSell(uuid, itemId, amount) {
        this.sellQueue.push({ uuid, itemId, amount, time: new Date().toISOString() });
    }

    popSells(uuid) {
        const playerSells = this.sellQueue.filter(s => s.uuid === uuid);
        this.sellQueue = this.sellQueue.filter(s => s.uuid !== uuid);
        return playerSells;
    }
}

module.exports = new McAuthModule();