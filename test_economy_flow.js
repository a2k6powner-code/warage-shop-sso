const axios = require('axios');

const API_URL = 'http://localhost:3000';
const ITEM_ID = 'diamond_sword'; // 测试物品

// 模拟两个玩家
const SELLER_UUID = 'player_merchant'; // 卖家
const BUYER_UUID = 'player_rich';      // 买家

// 创建两个客户端，分别代表两个玩家
const sellerClient = axios.create({ baseURL: API_URL, headers: { 'x-user-uuid': SELLER_UUID } });
const buyerClient = axios.create({ baseURL: API_URL, headers: { 'x-user-uuid': BUYER_UUID } });

async function runEconomyTest() {
    console.log('💰 === 开始真实经济系统全流程测试 ===\n');

    try {
        // --- 第一步：上帝发钱/发货 (初始化资产) ---
        console.log('1. [初始化] 上帝正在分配资产...');
        
        // 给卖家发 1 把剑 (没钱)
        await sellerClient.post('/api/debug/give', { type: 'item', itemId: ITEM_ID, amount: 1 });
        // 给买家发 1000 块钱 (没货)
        await buyerClient.post('/api/debug/give', { type: 'money', amount: 1000 });

        // 验证初始状态
        const sellerAsset = (await sellerClient.get('/api/assets/my')).data;
        const buyerAsset = (await buyerClient.get('/api/assets/my')).data;
        console.log(`   卖家初始: 余额 ${sellerAsset.balance}, 库存剑 ${getItemAmount(sellerAsset.inventory, ITEM_ID)} (预期: 0, 1)`);
        console.log(`   买家初始: 余额 ${buyerAsset.balance}, 库存剑 ${getItemAmount(buyerAsset.inventory, ITEM_ID)} (预期: 1000, 0)`);


        // --- 第二步：卖家挂单 (预扣库存) ---
        console.log('\n2. [卖家] 挂单出售: 200块卖1把剑...');
        await sellerClient.post('/api/market/place', {
            itemId: ITEM_ID, type: 'SELL', price: 200, amount: 1
        });
        console.log('   ✅ 挂单成功');

        // 检查卖家库存 (剑应该被锁定了，看不到了，或者变为0)
        const sellerAssetAfterPlace = (await sellerClient.get('/api/assets/my')).data;
        console.log(`   [验证] 卖家挂单后库存: ${getItemAmount(sellerAssetAfterPlace.inventory, ITEM_ID)} (预期: 0, 因为被冻结在订单里了)`);


        // --- 第三步：买家寻找订单 ---
        console.log('\n3. [买家] 浏览市场...');
        const bookRes = await buyerClient.get(`/api/market/orderbook?itemId=${ITEM_ID}`);
        // 找到那个 200块的卖单
        const targetOrder = bookRes.data.data.asks.find(o => o.price === 200 && o.uuid === SELLER_UUID);
        
        if (!targetOrder) throw new Error("❌ 没找到刚才挂的单子！测试失败");
        console.log(`   ✅ 找到了目标订单 ID: ${targetOrder.id}, 价格: ${targetOrder.price}`);


        // --- 第四步：买家吃单 (一手交钱一手交货) ---
        console.log('\n4. [买家] 购买订单 (花费 200)...');
        const tradeRes = await buyerClient.post('/api/market/fulfill', {
            orderId: targetOrder.id,
            amount: 1
        });
        console.log(`   ✅ 交易完成! 总花费: ${tradeRes.data.data.total}`);


        // --- 第五步：最终资产清算 ---
        console.log('\n5. [最终结算] 检查双方钱包...');
        
        const sellerFinal = (await sellerClient.get('/api/assets/my')).data;
        const buyerFinal = (await buyerClient.get('/api/assets/my')).data;

        console.log(`   👨‍💼 卖家最终: 余额 ${sellerFinal.balance} (预期: 0 -> 200)`);
        console.log(`   🤴 买家最终: 余额 ${buyerFinal.balance} (预期: 1000 -> 800)`);
        console.log(`   🗡️ 买家最终库存: ${getItemAmount(buyerFinal.inventory, ITEM_ID)} (预期: 1)`);

        // 自动判定结果
        if (sellerFinal.balance === 200 && buyerFinal.balance === 800 && getItemAmount(buyerFinal.inventory, ITEM_ID) === 1) {
            console.log('\n🎉🎉🎉 测试通过！完美闭环！ 🎉🎉🎉');
        } else {
            console.error('\n❌ 测试未通过，资产数据不对劲。');
        }

    } catch (err) {
        console.error('\n❌ 测试失败:', err.response ? err.response.data : err.message);
    }
}

// 辅助函数：从 inventory 数组里找数量
function getItemAmount(inventory, itemId) {
    const item = inventory.find(i => i.item_id === itemId);
    return item ? item.amount : 0;
}

runEconomyTest();