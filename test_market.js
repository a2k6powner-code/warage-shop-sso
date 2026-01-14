const axios = require('axios');

const API_URL = 'http://localhost:3000';
// 模拟两个玩家
const SELLER_UUID = 'player_merchant_A';
const BUYER_UUID = 'player_rich_B';
const ITEM_ID = 'diamond_sword'; // 测试物品

const client = axios.create({ baseURL: API_URL });

async function runMarketTest() {
    console.log('📈 开始订单簿市场功能测试...\n');

    try {
        // --- 第一步：挂卖单 (Asks) ---
        console.log('1. [卖家] 开始挂单 (制造卖盘)...');
        
        // 挂一个贵一点的 (200块)
        await placeOrder(SELLER_UUID, 'SELL', 200, 1);
        // 挂一个便宜点的 (150块) -> 预期这个排前面
        await placeOrder(SELLER_UUID, 'SELL', 150, 5);
        // 挂一个更贵的 (300块)
        await placeOrder(SELLER_UUID, 'SELL', 300, 1);

        // --- 第二步：挂买单 (Bids) ---
        console.log('\n2. [买家] 开始挂单 (制造买盘)...');
        
        // 出价低 (80块)
        await placeOrder(BUYER_UUID, 'BUY', 80, 10);
        // 出价高 (120块) -> 预期这个排前面
        await placeOrder(BUYER_UUID, 'BUY', 120, 2);

        // --- 第三步：查看订单簿 ---
        console.log('\n3. [公共] 拉取订单簿数据 (验证排序)...');
        const res = await client.get(`/api/market/orderbook?itemId=${ITEM_ID}`);
        const book = res.data.data;

        console.log('\n=== 📊 订单簿快照 ===');
        
        console.log('🔴 卖单 (Asks) - 越便宜越靠前:');
        if (book.asks.length === 0) console.log('   (无数据)');
        book.asks.forEach((order, index) => {
            console.log(`   #${index+1} 价格: ${order.price} | 数量: ${order.amount}`);
        });

        console.log('🟢 买单 (Bids) - 越贵越靠前:');
        if (book.bids.length === 0) console.log('   (无数据)');
        book.bids.forEach((order, index) => {
            console.log(`   #${index+1} 价格: ${order.price} | 数量: ${order.amount}`);
        });

        // --- 验证逻辑 ---
        console.log('\n=== ✅ 验证结果 ===');
        const askCheck = book.asks[0].price === 150; // 最便宜的应该是150
        const bidCheck = book.bids[0].price === 120; // 最贵的应该是120
        
        if (askCheck && bidCheck) {
            console.log('SUCCESS: 订单排序逻辑正确！');
        } else {
            console.error('FAIL: 订单排序有误！');
            console.error(`预期卖单首位150，实际: ${book.asks[0]?.price}`);
            console.error(`预期买单首位120，实际: ${book.bids[0]?.price}`);
        }

    } catch (err) {
        console.error('❌ 测试失败:', err.response ? err.response.data : err.message);
    }
}

// 辅助函数：挂单
async function placeOrder(uuid, type, price, amount) {
    try {
        const res = await client.post('/api/market/place', {
            itemId: ITEM_ID,
            type,   // 'BUY' or 'SELL'
            price,
            amount
        }, {
            headers: { 'x-user-uuid': uuid } // 模拟登录用户
        });
        console.log(`   ✅ ${type} 挂单成功: 价格 ${price}, 数量 ${amount}`);
    } catch (err) {
        console.error(`   ❌ ${type} 挂单失败:`, err.response ? err.response.data : err.message);
    }
}

runMarketTest();