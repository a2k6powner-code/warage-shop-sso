// market.js
const db = require('./db');

class MarketModule {

    // --- 资产操作 (基于 Token/钱包) ---
    
    getBalance(token) {
        const row = db.prepare('SELECT balance FROM wallets WHERE token = ?').get(token);
        return row ? row.balance : 0;
    }

    getItemAmount(token, itemId) {
        const row = db.prepare('SELECT amount FROM inventories WHERE token = ? AND item_id = ?').get(token, itemId);
        return row ? row.amount : 0;
    }

    _updateBalance(token, delta) {
        db.prepare(`
            INSERT INTO wallets (token, balance) VALUES (?, ?)
            ON CONFLICT(token) DO UPDATE SET balance = balance + ?
        `).run(token, delta, delta);
    }

    _updateInventory(token, itemId, delta) {
        db.prepare(`
            INSERT INTO inventories (token, item_id, amount) VALUES (?, ?, ?)
            ON CONFLICT(token, item_id) DO UPDATE SET amount = amount + ?
        `).run(token, itemId, delta, delta);
    }

    // --- [新] 游戏充值逻辑 ---
    // 1. 游戏插件存入 -> 待领区 (Pending)
    depositToPending(uuid, type, itemId, amount) {
        db.prepare(`
            INSERT INTO pending_deposits (uuid, type, item_id, amount, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(uuid, type, itemId || null, amount, new Date().toISOString());
    }

    // 2. 玩家领取 -> 当前钱包 (Claim)
    getPendingDeposits(uuid) {
        return db.prepare('SELECT * FROM pending_deposits WHERE uuid = ?').all(uuid);
    }

    claimDeposit(token, depositId, uuid) {
        return db.transaction(() => {
            // 确保这笔钱属于这个 Token 背后的 UUID
            const deposit = db.prepare('SELECT * FROM pending_deposits WHERE id = ? AND uuid = ?').get(depositId, uuid);
            if (!deposit) throw new Error("资产不存在或不属于你");

            // 转入当前钱包
            if (deposit.type === 'money') {
                this._updateBalance(token, deposit.amount);
            } else {
                this._updateInventory(token, deposit.item_id, deposit.amount);
            }

            // 删除待领记录
            db.prepare('DELETE FROM pending_deposits WHERE id = ?').run(depositId);
            return { success: true, type: deposit.type, amount: deposit.amount };
        })();
    }

    // --- 交易逻辑 (Order Book) ---
    // 这里所有的 uuid 参数都改为了 token
    
    getOrderBook(itemId) {
        const asks = db.prepare(`SELECT id, price, amount FROM orders WHERE item_id = ? AND type = 'SELL' AND status = 'OPEN' ORDER BY price ASC LIMIT 50`).all(itemId);
        const bids = db.prepare(`SELECT id, price, amount FROM orders WHERE item_id = ? AND type = 'BUY' AND status = 'OPEN' ORDER BY price DESC LIMIT 50`).all(itemId);
        return { itemId, asks, bids };
    }

    placeOrder(token, uuid, itemId, type, price, amount) {
        if (amount <= 0 || price <= 0) throw new Error("数值错误");
        const tx = db.transaction(() => {
            if (type === 'BUY') {
                const cost = price * amount;
                if (this.getBalance(token) < cost) throw new Error("余额不足");
                this._updateBalance(token, -cost);
            } else {
                if (this.getItemAmount(token, itemId) < amount) throw new Error("库存不足");
                this._updateInventory(token, itemId, -amount);
            }
            db.prepare(`INSERT INTO orders (token, uuid, item_id, type, price, amount, initial_amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(token, uuid, itemId, type, price, amount, amount, new Date().toISOString(), new Date().toISOString());
        });
        tx();
        return { success: true };
    }

    fulfillOrder(takerToken, orderId, amount) {
        const tx = db.transaction(() => {
            const order = db.prepare(`SELECT * FROM orders WHERE id = ? AND status = 'OPEN'`).get(orderId);
            if (!order) throw new Error("订单无效");
            if (order.token === takerToken) throw new Error("不能交易自己的订单");

            const total = order.price * amount;
            
            // 资金与货物流转 (Token 对 Token)
            if (order.type === 'SELL') {
                if (this.getBalance(takerToken) < total) throw new Error("余额不足");
                this._updateBalance(takerToken, -total);
                this._updateBalance(order.token, total);
                this._updateInventory(takerToken, order.item_id, amount);
            } else {
                if (this.getItemAmount(takerToken, order.item_id) < amount) throw new Error("库存不足");
                this._updateInventory(takerToken, order.item_id, -amount);
                this._updateInventory(order.token, order.item_id, amount);
                this._updateBalance(takerToken, total);
            }

            // 更新订单
            const newAmt = order.amount - amount;
            const status = newAmt === 0 ? 'FILLED' : 'OPEN';
            db.prepare('UPDATE orders SET amount = ?, status = ? WHERE id = ?').run(newAmt, status, orderId);
            
            // K线数据记录 (记录价格即可)
            db.prepare('INSERT INTO trades (item_id, price, amount, created_at) VALUES (?, ?, ?, ?)').run(order.item_id, order.price, amount, new Date().toISOString());
            
            return { success: true };
        });
        return tx();
    }

    cancelOrder(token, orderId) {
        const tx = db.transaction(() => {
            const order = db.prepare('SELECT * FROM orders WHERE id = ? AND token = ? AND status = "OPEN"').get(orderId, token);
            if (!order) throw new Error("订单无法撤销");
            
            if (order.type === 'BUY') this._updateBalance(token, order.price * order.amount);
            else this._updateInventory(token, order.item_id, order.amount);
            
            db.prepare('UPDATE orders SET status = "CANCELLED" WHERE id = ?').run(orderId);
        });
        tx();
        return { success: true };
    }

    // --- 筹集令 (Procurement) ---
    getProcurementList() { return db.prepare('SELECT * FROM procurements WHERE status = "OPEN"').all(); }

    createProcurement(token, uuid, itemId, price, targetAmount) {
        const cost = price * targetAmount;
        if (this.getBalance(token) < cost) throw new Error("余额不足");
        const tx = db.transaction(() => {
            this._updateBalance(token, -cost);
            db.prepare('INSERT INTO procurements (token, uuid, item_id, price_per_unit, target_amount, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(token, uuid, itemId, price, targetAmount, new Date().toISOString());
        });
        tx();
        return { success: true };
    }

    contributeProcurement(contributorToken, procurementId, amount) {
        const tx = db.transaction(() => {
            const order = db.prepare('SELECT * FROM procurements WHERE id = ? AND status = "OPEN"').get(procurementId);
            if (!order) throw new Error("无效订单");
            
            if (this.getItemAmount(contributorToken, order.item_id) < amount) throw new Error("库存不足");
            
            this._updateInventory(contributorToken, order.item_id, -amount);
            this._updateBalance(contributorToken, order.price_per_unit * amount);
            this._updateInventory(order.token, order.item_id, amount); // 存入发起者的钱包

            const filled = order.filled_amount + amount;
            const status = filled >= order.target_amount ? 'FILLED' : 'OPEN';
            db.prepare('UPDATE procurements SET filled_amount = ?, status = ? WHERE id = ?').run(filled, status, procurementId);
        });
        tx();
        return { success: true };
    }
    
    // K线逻辑保持不变，略...
    getTradeHistory(itemId) { return db.prepare(`SELECT price, amount, created_at FROM trades WHERE item_id = ? ORDER BY created_at DESC LIMIT 100`).all(itemId); }
    getKlineData(itemId, resolution = 60) { 
        // ... (保持之前的 K 线聚合逻辑) ...
        // 为节省篇幅，这里复用你之前的K线代码
        const trades = db.prepare(`SELECT price, amount, created_at FROM trades WHERE item_id = ? ORDER BY created_at ASC`).all(itemId);
        if (trades.length === 0) return [];
        const klines = [];
        let currentCandle = null;
        let lastBucketTime = 0;
        const intervalMs = resolution * 60 * 1000;
        for (const trade of trades) {
            const tradeTime = new Date(trade.created_at).getTime();
            const bucketTime = Math.floor(tradeTime / intervalMs) * intervalMs;
            if (currentCandle === null || bucketTime !== lastBucketTime) {
                if (currentCandle) klines.push(currentCandle);
                lastBucketTime = bucketTime;
                currentCandle = { time: bucketTime / 1000, open: trade.price, high: trade.price, low: trade.price, close: trade.price, volume: trade.amount };
            } else {
                currentCandle.high = Math.max(currentCandle.high, trade.price);
                currentCandle.low = Math.min(currentCandle.low, trade.price);
                currentCandle.close = trade.price;
                currentCandle.volume += trade.amount;
            }
        }
        if (currentCandle) klines.push(currentCandle);
        return klines;
    }
}

module.exports = new MarketModule();