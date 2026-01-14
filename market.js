// market.js
const db = require('./db');

class MarketModule {

    // --- 辅助：获取玩家资产 ---
    getBalance(uuid) {
        const row = db.prepare('SELECT balance FROM wallets WHERE uuid = ?').get(uuid);
        return row ? row.balance : 0;
    }

    getItemAmount(uuid, itemId) {
        const row = db.prepare('SELECT amount FROM inventories WHERE uuid = ? AND item_id = ?').get(uuid, itemId);
        return row ? row.amount : 0;
    }

    // --- 辅助：变动资产 (内部使用) ---
    _updateBalance(uuid, delta) {
        db.prepare(`
            INSERT INTO wallets (uuid, balance) VALUES (?, ?)
            ON CONFLICT(uuid) DO UPDATE SET balance = balance + ?
        `).run(uuid, delta, delta);
    }

    _updateInventory(uuid, itemId, delta) {
        db.prepare(`
            INSERT INTO inventories (uuid, item_id, amount) VALUES (?, ?, ?)
            ON CONFLICT(uuid, item_id) DO UPDATE SET amount = amount + ?
        `).run(uuid, itemId, delta, delta);
    }

    // --- 1. 获取订单簿 ---
    getOrderBook(itemId) {
        const asks = db.prepare(`SELECT id, uuid, price, amount, created_at FROM orders WHERE item_id = ? AND type = 'SELL' AND status = 'OPEN' ORDER BY price ASC LIMIT 50`).all(itemId);
        const bids = db.prepare(`SELECT id, uuid, price, amount, created_at FROM orders WHERE item_id = ? AND type = 'BUY' AND status = 'OPEN' ORDER BY price DESC LIMIT 50`).all(itemId);
        return { itemId, asks, bids };
    }

    // --- 2. 玩家挂单 (Maker - 需预扣资产) ---
    placeOrder(uuid, itemId, type, price, amount) {
        if (amount <= 0 || price <= 0) throw new Error("价格和数量必须大于0");
        if (!['BUY', 'SELL'].includes(type)) throw new Error("类型错误");

        const insertTx = db.transaction(() => {
            const time = new Date().toISOString();
            
            if (type === 'BUY') {
                // 买单：预扣钱
                const totalCost = price * amount;
                const balance = this.getBalance(uuid);
                if (balance < totalCost) throw new Error(`余额不足 (需要 ${totalCost}, 只有 ${balance})`);
                
                this._updateBalance(uuid, -totalCost);
            } else {
                // 卖单：预扣货
                const inv = this.getItemAmount(uuid, itemId);
                if (inv < amount) throw new Error(`库存不足 (需要 ${amount}个 ${itemId}, 只有 ${inv})`);
                
                this._updateInventory(uuid, itemId, -amount);
            }

            // 写入订单
            db.prepare(`
                INSERT INTO orders (uuid, item_id, type, price, amount, initial_amount, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(uuid, itemId, type, price, amount, amount, time, time);
        });

        insertTx();
        return { success: true, msg: "挂单成功 (资产已冻结)" };
    }

    // --- 3. 吃单/成交 (Taker - 钱货两清) ---
    fulfillOrder(takerUuid, orderId, amount) {
        if (amount <= 0) throw new Error("数量必须大于0");

        const tradeTx = db.transaction(() => {
            // A. 锁定目标订单
            const order = db.prepare(`SELECT * FROM orders WHERE id = ? AND status = 'OPEN'`).get(orderId);
            
            if (!order) throw new Error("订单不存在或已成交");
            if (order.uuid === takerUuid) throw new Error("不能交易自己的订单"); 
            if (order.amount < amount) throw new Error(`订单剩余不足 (仅剩 ${order.amount})`);

            const makerUuid = order.uuid;
            const itemId = order.item_id;
            const price = order.price;
            const totalMoney = price * amount;

            // B. 资金/物品划转逻辑 (核心)
            if (order.type === 'SELL') {
                // 目标是卖单 (Maker是卖家，已经扣了货)
                // 我是买家 (Taker)，我需要出钱
                
                // 1. 扣我的钱
                const myBalance = this.getBalance(takerUuid);
                if (myBalance < totalMoney) throw new Error(`余额不足 (需要 ${totalMoney}, 只有 ${myBalance})`);
                this._updateBalance(takerUuid, -totalMoney);

                // 2. 给卖家钱
                this._updateBalance(makerUuid, totalMoney);

                // 3. 给我货
                this._updateInventory(takerUuid, itemId, amount);
                
                // (卖家的货在挂单时已经扣了，不用管)

            } else {
                // 目标是买单 (Maker是买家，已经扣了钱)
                // 我是卖家 (Taker)，我需要出货

                // 1. 扣我的货
                const myInv = this.getItemAmount(takerUuid, itemId);
                if (myInv < amount) throw new Error(`库存不足 (需要 ${amount}, 只有 ${myInv})`);
                this._updateInventory(takerUuid, itemId, -amount);

                // 2. 给买家货
                this._updateInventory(makerUuid, itemId, amount);

                // 3. 给我钱
                this._updateBalance(takerUuid, totalMoney);

                // (买家的钱在挂单时已经扣了，不用管)
            }
            
            // C. 更新订单状态
            const newAmount = order.amount - amount;
            const newStatus = newAmount === 0 ? 'FILLED' : 'OPEN';
            const time = new Date().toISOString();
            
            db.prepare(`UPDATE orders SET amount = ?, status = ?, updated_at = ? WHERE id = ?`)
              .run(newAmount, newStatus, time, orderId);

            // D. 记录成交历史
            db.prepare(`
                INSERT INTO trades (buy_order_id, sell_order_id, item_id, price, amount, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                order.type === 'BUY' ? order.id : null,   
                order.type === 'SELL' ? order.id : null,  
                itemId, price, amount, time
            );

            return { price, amount, total: totalMoney };
        });

        return tradeTx();
    }
    
    // --- 4. 撤单 (Maker - 退还资产) ---
    // 这个功能之前没写，但有了扣款就必须有退款
    cancelOrder(uuid, orderId) {
        const cancelTx = db.transaction(() => {
            const order = db.prepare(`SELECT * FROM orders WHERE id = ? AND uuid = ? AND status = 'OPEN'`).get(orderId, uuid);
            if (!order) throw new Error("订单不存在或无法撤销");

            // 退还资产
            if (order.type === 'BUY') {
                // 撤买单：退钱
                const refund = order.price * order.amount;
                this._updateBalance(uuid, refund);
            } else {
                // 撤卖单：退货
                this._updateInventory(uuid, order.item_id, order.amount);
            }

            // 标记为已撤销
            db.prepare(`UPDATE orders SET status = 'CANCELLED', updated_at = ? WHERE id = ?`)
              .run(new Date().toISOString(), orderId);
        });
        cancelTx();
        return { success: true };
    }

    // --- 其他查询方法保持不变 ---
    getTradeHistory(itemId) { /* ...同前... */ return db.prepare(`SELECT price, amount, created_at FROM trades WHERE item_id = ? ORDER BY created_at DESC LIMIT 100`).all(itemId); }
    getKlineData(itemId, resolution = 60) { /* ...同前，请保留修正后的聚合逻辑... */ 
        // 这里为了节省篇幅简写了，请务必把上一条回复里修正过的 getKlineData 逻辑贴回来！
        // 如果你需要我再贴一遍完整的，请告诉我。
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