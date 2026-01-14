// market.js
const db = require('./db');

class MarketModule {

    // ==========================================
    // A. 资产基础操作 (内部/外部通用)
    // ==========================================
    
    // 查询余额
    getBalance(uuid) {
        const row = db.prepare('SELECT balance FROM wallets WHERE uuid = ?').get(uuid);
        return row ? row.balance : 0;
    }

    // 查询某物品库存
    getItemAmount(uuid, itemId) {
        const row = db.prepare('SELECT amount FROM inventories WHERE uuid = ? AND item_id = ?').get(uuid, itemId);
        return row ? row.amount : 0;
    }

    // 变动余额 (支持正负)
    _updateBalance(uuid, delta) {
        db.prepare(`
            INSERT INTO wallets (uuid, balance) VALUES (?, ?)
            ON CONFLICT(uuid) DO UPDATE SET balance = balance + ?
        `).run(uuid, delta, delta);
    }

    // 变动库存 (支持正负)
    _updateInventory(uuid, itemId, delta) {
        db.prepare(`
            INSERT INTO inventories (uuid, item_id, amount) VALUES (?, ?, ?)
            ON CONFLICT(uuid, item_id) DO UPDATE SET amount = amount + ?
        `).run(uuid, itemId, delta, delta);
    }

    // ==========================================
    // B. 现货交易市场 (Order Book)
    // ==========================================

    // 1. 获取订单簿
    getOrderBook(itemId) {
        const asks = db.prepare(`SELECT id, uuid, price, amount, created_at FROM orders WHERE item_id = ? AND type = 'SELL' AND status = 'OPEN' ORDER BY price ASC LIMIT 50`).all(itemId);
        const bids = db.prepare(`SELECT id, uuid, price, amount, created_at FROM orders WHERE item_id = ? AND type = 'BUY' AND status = 'OPEN' ORDER BY price DESC LIMIT 50`).all(itemId);
        return { itemId, asks, bids };
    }

    // 2. 挂单 (Maker) - 冻结资产
    placeOrder(uuid, itemId, type, price, amount) {
        if (amount <= 0 || price <= 0) throw new Error("数值必须大于0");
        if (!['BUY', 'SELL'].includes(type)) throw new Error("类型错误");

        const tx = db.transaction(() => {
            const time = new Date().toISOString();
            
            if (type === 'BUY') {
                const totalCost = price * amount;
                const balance = this.getBalance(uuid);
                if (balance < totalCost) throw new Error(`余额不足 (需 ${totalCost}, 剩 ${balance})`);
                this._updateBalance(uuid, -totalCost);
            } else {
                const inv = this.getItemAmount(uuid, itemId);
                if (inv < amount) throw new Error(`库存不足 (需 ${amount}, 剩 ${inv})`);
                this._updateInventory(uuid, itemId, -amount);
            }

            db.prepare(`
                INSERT INTO orders (uuid, item_id, type, price, amount, initial_amount, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(uuid, itemId, type, price, amount, amount, time, time);
        });

        tx();
        return { success: true, msg: "挂单成功" };
    }

    // 3. 吃单 (Taker) - 撮合交易
    fulfillOrder(takerUuid, orderId, amount) {
        if (amount <= 0) throw new Error("数量必须大于0");

        const tx = db.transaction(() => {
            const order = db.prepare(`SELECT * FROM orders WHERE id = ? AND status = 'OPEN'`).get(orderId);
            
            if (!order) throw new Error("订单不存在或已成交");
            if (order.uuid === takerUuid) throw new Error("不能交易自己的订单"); 
            if (order.amount < amount) throw new Error(`订单剩余不足 (剩 ${order.amount})`);

            const makerUuid = order.uuid;
            const itemId = order.item_id;
            const price = order.price;
            const totalMoney = price * amount;

            if (order.type === 'SELL') {
                // 目标是卖单。我是买家，我出钱。
                const myBalance = this.getBalance(takerUuid);
                if (myBalance < totalMoney) throw new Error(`余额不足 (需 ${totalMoney})`);
                
                this._updateBalance(takerUuid, -totalMoney); // 扣我钱
                this._updateBalance(makerUuid, totalMoney);  // 给卖家钱
                this._updateInventory(takerUuid, itemId, amount); // 给我货
            } else {
                // 目标是买单。我是卖家，我出货。
                const myInv = this.getItemAmount(takerUuid, itemId);
                if (myInv < amount) throw new Error(`库存不足 (需 ${amount})`);

                this._updateInventory(takerUuid, itemId, -amount); // 扣我货
                this._updateInventory(makerUuid, itemId, amount);  // 给买家货
                this._updateBalance(takerUuid, totalMoney); // 给我钱
            }

            // 更新订单状态
            const newAmount = order.amount - amount;
            const newStatus = newAmount === 0 ? 'FILLED' : 'OPEN';
            const time = new Date().toISOString();
            
            db.prepare(`UPDATE orders SET amount = ?, status = ?, updated_at = ? WHERE id = ?`)
              .run(newAmount, newStatus, time, orderId);

            // 记录 K 线数据源
            db.prepare(`
                INSERT INTO trades (buy_order_id, sell_order_id, item_id, price, amount, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(order.type === 'BUY' ? order.id : null, order.type === 'SELL' ? order.id : null, itemId, price, amount, time);

            return { price, amount, total: totalMoney };
        });

        return tx();
    }

    // 4. 撤单 - 退还资产
    cancelOrder(uuid, orderId) {
        const tx = db.transaction(() => {
            const order = db.prepare(`SELECT * FROM orders WHERE id = ? AND uuid = ? AND status = 'OPEN'`).get(orderId, uuid);
            if (!order) throw new Error("订单无法撤销");

            if (order.type === 'BUY') {
                const refund = order.price * order.amount;
                this._updateBalance(uuid, refund);
            } else {
                this._updateInventory(uuid, order.item_id, order.amount);
            }

            db.prepare(`UPDATE orders SET status = 'CANCELLED', updated_at = ? WHERE id = ?`)
              .run(new Date().toISOString(), orderId);
        });
        tx();
        return { success: true };
    }

    // ==========================================
    // C. 物资筹集令 (公会收购系统)
    // ==========================================

    // 5. 获取筹集令列表
    getProcurementList(status = 'OPEN') {
        return db.prepare(`SELECT * FROM procurements WHERE status = ? ORDER BY created_at DESC`).all(status);
    }

    // 6. 发布筹集令 (全款冻结)
    createProcurement(uuid, itemId, price, targetAmount) {
        if (price <= 0 || targetAmount <= 0) throw new Error("价格和数量必须大于0");
        
        return db.transaction(() => {
            const totalCost = price * targetAmount;
            const balance = this.getBalance(uuid);
            if (balance < totalCost) throw new Error(`余额不足以支付收购保证金 (需 ${totalCost})`);
            
            this._updateBalance(uuid, -totalCost);

            const info = db.prepare(`
                INSERT INTO procurements (uuid, item_id, price_per_unit, target_amount, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(uuid, itemId, price, targetAmount, new Date().toISOString());

            return { success: true, id: info.lastInsertRowid, msg: "收购令发布成功" };
        })();
    }

    // 7. 散人交货 (立刻拿钱)
    contributeProcurement(contributorUuid, procurementId, amount) {
        if (amount <= 0) throw new Error("数量必须大于0");

        return db.transaction(() => {
            // --- 修复点：双引号 "OPEN" 改为单引号 'OPEN' ---
            const order = db.prepare("SELECT * FROM procurements WHERE id = ? AND status = 'OPEN'").get(procurementId);
            
            if (!order) throw new Error("订单不存在或已结束");

            const remaining = order.target_amount - order.filled_amount;
            if (amount > remaining) throw new Error(`收购溢出，当前只收 ${remaining} 个`);

            const inv = this.getItemAmount(contributorUuid, order.item_id);
            if (inv < amount) throw new Error("背包货不足");

            // 1. 扣散人货
            this._updateInventory(contributorUuid, order.item_id, -amount);
            
            // 2. 给散人钱
            const earnings = order.price_per_unit * amount;
            this._updateBalance(contributorUuid, earnings);

            // 3. 货直接存入发起人仓库
            this._updateInventory(order.uuid, order.item_id, amount);

            // 4. 更新进度
            const newFilled = order.filled_amount + amount;
            const newStatus = newFilled >= order.target_amount ? 'FILLED' : 'OPEN';
            db.prepare("UPDATE procurements SET filled_amount = ?, status = ? WHERE id = ?")
              .run(newFilled, newStatus, procurementId);

            // 5. 记录日志
            db.prepare(`
                INSERT INTO procurement_records (procurement_id, contributor_uuid, amount, earnings, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(procurementId, contributorUuid, amount, earnings, new Date().toISOString());

            return { success: true, earnings };
        })();
    }

    // 8. 撤销筹集令 (退还剩余资金)
    cancelProcurement(uuid, procurementId) {
        return db.transaction(() => {
            // --- 修复点：双引号 "OPEN" 改为单引号 'OPEN' ---
            const order = db.prepare("SELECT * FROM procurements WHERE id = ? AND uuid = ? AND status = 'OPEN'").get(procurementId, uuid);
            
            if (!order) throw new Error("无法撤销");

            // 计算应退款项
            const remaining = order.target_amount - order.filled_amount;
            if (remaining > 0) {
                const refund = remaining * order.price_per_unit;
                this._updateBalance(uuid, refund);
            }

            // --- 修复点：双引号 "CANCELLED" 改为单引号 'CANCELLED' ---
            db.prepare("UPDATE procurements SET status = 'CANCELLED' WHERE id = ?").run(procurementId);
            return { success: true, msg: "撤销成功，剩余资金已退回" };
        })();
    }

    // ==========================================
    // D. 数据图表 (K线)
    // ==========================================

    getTradeHistory(itemId) {
        return db.prepare(`SELECT price, amount, created_at FROM trades WHERE item_id = ? ORDER BY created_at DESC LIMIT 100`).all(itemId);
    }

    getKlineData(itemId, resolution = 60) {
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
                currentCandle = {
                    time: bucketTime / 1000,
                    open: trade.price, high: trade.price, low: trade.price, close: trade.price, volume: trade.amount
                };
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