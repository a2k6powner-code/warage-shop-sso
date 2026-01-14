// test_trade.js
const axios = require('axios');

const API_URL = 'http://localhost:3000';
const ITEM_ID = 'diamond_sword';
const SELLER_UUID = 'merchant_A'; // 卖家
const BUYER_UUID = 'rich_player_B'; // 买家 (Taker)

const client = axios.create({ baseURL: API_URL });

async function runTradeTest() {
    console.log('💰 开始 [挂单 -> 吃单] 全流程测试...\n');

    try {
        // 1. [卖家] 挂一个单子: 200块, 卖10个
        console.log('1. [卖家] 挂卖单: 200块 x 10个');
        const placeRes = await client.post('/api/market/place', {
            itemId: ITEM_ID,
            type: 'SELL',
            price: 200,
            amount: 10
        }, { headers: { 'x-user-uuid': SELLER_UUID } });
        console.log('   ✅ 挂单成功');

        // 2. 获取订单ID (为了测试吃单，我们需要知道刚才那个单子的ID)
        const bookRes = await client.get(`/api/market/orderbook?itemId=${ITEM_ID}`);
        // 找到刚才那个 200块的单子 (假设是第一个)
        const targetOrder = bookRes.data.data.asks.find(o => o.price === 200 && o.uuid === SELLER_UUID);
        
        if (!targetOrder) throw new Error('❌ 未找到刚才挂的单子，测试终止');
        console.log(`   ℹ️ 目标订单ID: ${targetOrder.id}, 当前数量: ${targetOrder.amount}`);

        // 3. [买家] 吃掉这个单子的一部分 (买3个)
        console.log(`\n2. [买家] 尝试购买 3个 (Taker操作)...`);
        const tradeRes = await client.post('/api/market/fulfill', {
            orderId: targetOrder.id,
            amount: 3
        }, { headers: { 'x-user-uuid': BUYER_UUID } });
        
        const tradeData = tradeRes.data.data;
        console.log(`   ✅ 交易成功! 花费: ${tradeData.total}, 获得数量: ${tradeData.amount}`);

        // 4. [验证] 再次检查订单簿，看数量是否减少
        console.log('\n3. [验证] 检查库存扣减...');
        const checkRes = await client.get(`/api/market/orderbook?itemId=${ITEM_ID}`);
        const updatedOrder = checkRes.data.data.asks.find(o => o.id === targetOrder.id);

        if (updatedOrder && updatedOrder.amount === 7) {
            console.log(`   ✅ 验证通过: 订单剩余数量正确 (10 - 3 = 7)`);
        } else {
            console.error(`   ❌ 验证失败: 订单剩余数量不对, 期望 7, 实际 ${updatedOrder ? updatedOrder.amount : '订单已消失'}`);
        }

    } catch (err) {
        console.error('❌ 测试失败:', err.response ? err.response.data : err.message);
    }
}

runTradeTest();