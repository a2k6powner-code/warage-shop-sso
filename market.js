const db = require('./db');

class MarketModule {

    // --- 1. 获取订单簿 ---
    getOrderBook(itemId) {
        const asks = db.prepare(`
            SELECT id, uuid, price, amount, created_at 
            FROM orders 
            WHERE item_id = ? AND type = 'SELL' AND status = 'OPEN' 
            ORDER BY price ASC 
            LIMIT 50
        `).all(itemId);

        const bids = db.prepare(`
            SELECT id, uuid, price, amount, created_at 
            FROM orders 
            WHERE item_id = ? AND type = 'BUY' AND status = 'OPEN' 
            ORDER BY price DESC 
            LIMIT 50
        `).all(itemId);

        return { itemId, asks, bids };
    }

    // --- 2. 挂单 ---
    placeOrder(uuid, itemId, type, price, amount) {
        if (amount <= 0 || price <= 0) throw new Error("价格和数量必须大于0");
        if (!['BUY', 'SELL'].includes(type)) throw new Error("类型错误");

        const time = new Date().toISOString();
        
        const insertTx = db.transaction(() => {
            db.prepare(`
                INSERT INTO orders (uuid, item_id, type, price, amount, initial_amount, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(uuid, itemId, type, price, amount, amount, time, time);
        });

        insertTx();
        return { success: true, msg: "挂单成功" };
    }

    // --- 3. 吃单 ---
    fulfillOrder(takerUuid, orderId, amount) {
        if (amount <= 0) throw new Error("数量必须大于0");

        const tradeTx = db.transaction(() => {
            const order = db.prepare(`SELECT * FROM orders WHERE id = ? AND status = 'OPEN'`).get(orderId);
            
            if (!order) throw new Error("订单不存在或已成交");
            if (order.uuid === takerUuid) throw new Error("不能交易自己的订单"); 
            if (order.amount < amount) throw new Error(`订单剩余不足 (仅剩 ${order.amount})`);

            const newAmount = order.amount - amount;
            const newStatus = newAmount === 0 ? 'FILLED' : 'OPEN';
            const time = new Date().toISOString();
            
            db.prepare(`UPDATE orders SET amount = ?, status = ?, updated_at = ? WHERE id = ?`)
              .run(newAmount, newStatus, time, orderId);

            db.prepare(`
                INSERT INTO trades (buy_order_id, sell_order_id, item_id, price, amount, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                order.type === 'BUY' ? order.id : null,   
                order.type === 'SELL' ? order.id : null,  
                order.item_id,
                order.price,
                amount,
                time
            );

            return { price: order.price, amount, total: order.price * amount };
        });

        return tradeTx();
    }

    // --- 4. 获取流水 ---
    getTradeHistory(itemId) {
        return db.prepare(`
            SELECT price, amount, created_at 
            FROM trades 
            WHERE item_id = ? 
            ORDER BY created_at DESC 
            LIMIT 100
        `).all(itemId);
    }

    // --- 5. [修正后] 获取 K 线数据 ---
    getKlineData(itemId, resolution = 60) {
        const trades = db.prepare(`
            SELECT price, amount, created_at 
            FROM trades 
            WHERE item_id = ? 
            ORDER BY created_at ASC
        `).all(itemId);

        if (trades.length === 0) return [];

        const klines = [];
        let currentCandle = null;
        let lastBucketTime = 0; // 用于追踪当前聚合的时间段 (毫秒)
        
        const intervalMs = resolution * 60 * 1000;

        for (const trade of trades) {
            const tradeTime = new Date(trade.created_at).getTime();
            // 计算所属时间段 (毫秒)
            const bucketTime = Math.floor(tradeTime / intervalMs) * intervalMs;

            // 如果是新的时间段 (或者第一条数据)
            if (currentCandle === null || bucketTime !== lastBucketTime) {
                // 如果之前有蜡烛，先保存
                if (currentCandle) {
                    klines.push(currentCandle);
                }
                
                // 开启新蜡烛
                lastBucketTime = bucketTime;
                currentCandle = {
                    time: bucketTime / 1000, // 存给前端的是【秒】
                    open: trade.price,
                    high: trade.price,
                    low: trade.price,
                    close: trade.price,
                    volume: trade.amount
                };
            } else {
                // 在同一个时间段内，聚合数据
                currentCandle.high = Math.max(currentCandle.high, trade.price);
                currentCandle.low = Math.min(currentCandle.low, trade.price);
                currentCandle.close = trade.price; // 收盘价更新为最新一笔
                currentCandle.volume += trade.amount;
            }
        }

        // 循环结束后，别忘了推入最后一个蜡烛
        if (currentCandle) {
            klines.push(currentCandle);
        }

        return klines;
    }
}

module.exports = new MarketModule();