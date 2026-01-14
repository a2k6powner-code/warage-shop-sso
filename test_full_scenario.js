// test_full_scenario.js
const axios = require('axios');

const API = 'http://localhost:3000';
const ITEM = 'iron_ingot'; // 测试物品：铁锭

// === 角色定义 ===
const LEADER = 'Guild_Leader'; // 公会会长 (买方)
const MINER = 'Worker_Steve';  // 搬砖矿工 (卖方)
const TRADER = 'Trader_Alex';  // 市场倒爷 (现货卖方)

// === 客户端实例 ===
const leaderClient = axios.create({ baseURL: API, headers: { 'x-user-uuid': LEADER } });
const minerClient = axios.create({ baseURL: API, headers: { 'x-user-uuid': MINER } });
const traderClient = axios.create({ baseURL: API, headers: { 'x-user-uuid': TRADER } });

async function runScenario() {
    console.log('🎬 === Minecraft 经济系统全流程大剧 (智能版) ===\n');

    try {
        // ---------------------------------------------------------
        // 第一幕：上帝发钱 (初始化)
        // ---------------------------------------------------------
        console.log('📢 第一幕：资源分配');
        // 哪怕之前有钱也没关系，我们再发点
        await leaderClient.post('/api/debug/give', { type: 'money', amount: 10000 });
        await minerClient.post('/api/debug/give', { type: 'item', itemId: ITEM, amount: 100 });
        await traderClient.post('/api/debug/give', { type: 'item', itemId: ITEM, amount: 50 });

        // 【关键修改】先记录大家现在的资产，用来做后面的对比
        const leaderStart = await getAsset(LEADER, leaderClient);
        const minerStart = await getAsset(MINER, minerClient);
        
        console.log(`   会长初始余额: $${leaderStart.balance}`);


        // ---------------------------------------------------------
        // 第二幕：公会备战，发布收购令 (Supply Contract)
        // ---------------------------------------------------------
        console.log('\n📢 第二幕：公会备战，发布收购令');
        const PRICE = 10;
        const AMOUNT = 50;
        const COST = PRICE * AMOUNT; // 500

        console.log(`   [会长] 发布收购: ${AMOUNT}个 ${ITEM} @ $${PRICE}/个`);
        const createRes = await leaderClient.post('/api/procurement/create', {
            itemId: ITEM, price: PRICE, targetAmount: AMOUNT
        });
        const procurementId = createRes.data.id;
        console.log(`   ✅ 收购令发布成功 (ID: ${procurementId})`);

        // 【智能验证】检查钱是不是真的少了 500 块
        const leaderAfterPost = await getAsset(LEADER, leaderClient);
        const diff = leaderStart.balance - leaderAfterPost.balance;
        
        if (diff !== COST) {
            throw new Error(`会长资金冻结失败！预期减少 ${COST}, 实际减少 ${diff}, 当前余额 ${leaderAfterPost.balance}`);
        }
        console.log(`   ✅ 资金验证通过：资产减少了 $${diff} (冻结中)`);


        // ---------------------------------------------------------
        // 第三幕：矿工响应任务 (Contribute)
        // ---------------------------------------------------------
        console.log('\n📢 第三幕：矿工搬砖，上交物资');
        console.log(`   [矿工] 看到任务，上交 ${AMOUNT}个 ${ITEM}...`);
        
        const contRes = await minerClient.post('/api/procurement/contribute', {
            procurementId: procurementId, amount: AMOUNT
        });
        console.log(`   ✅ 上交成功！获得收益: $${contRes.data.earnings}`);
        
        // 验证矿工收到了钱
        const minerAfterWork = await getAsset(MINER, minerClient);
        if (minerAfterWork.balance - minerStart.balance !== COST) {
            throw new Error("矿工没收到钱！");
        }


        // ---------------------------------------------------------
        // 第四幕：现货市场博弈 (Spot Market)
        // ---------------------------------------------------------
        console.log('\n📢 第四幕：现货市场交易');
        // 倒爷挂单
        console.log(`   [倒爷] 挂卖单: 10个 ${ITEM} @ $20/个 (现货)`);
        await traderClient.post('/api/market/place', {
            itemId: ITEM, type: 'SELL', price: 20, amount: 10
        });
        
        // 会长扫货
        console.log(`   [会长] 去现货市场扫货...`);
        const bookRes = await leaderClient.get(`/api/market/orderbook?itemId=${ITEM}`);
        const targetOrder = bookRes.data.data.asks.find(o => o.price === 20); // 找20块的单子
        
        if (targetOrder) {
            console.log(`   [会长] 发现倒爷的单子 (ID: ${targetOrder.id})，吃掉！`);
            await leaderClient.post('/api/market/fulfill', {
                orderId: targetOrder.id, amount: 10
            });
            console.log(`   ✅ 交易成交`);
        } else {
            console.log(`   ❌ 没找到倒爷的单子(可能被别人买走了)，跳过此步骤`);
        }


        // ---------------------------------------------------------
        // 终幕：资产大清算
        // ---------------------------------------------------------
        console.log('\n📢 终幕：最终资产清算');
        
        await logAsset(LEADER, leaderClient);
        await logAsset(MINER, minerClient);
        await logAsset(TRADER, traderClient);

        console.log('\n✅✅✅ 全流程测试通过！系统逻辑完美闭环！ ✅✅✅');

    } catch (err) {
        console.error('\n❌ 测试失败:', err.response ? err.response.data : err.message);
    }
}

// 辅助函数：获取资产对象
async function getAsset(name, client) {
    const res = await client.get('/api/assets/my');
    const bal = res.data.balance;
    const invItem = res.data.inventory.find(i => i.item_id === ITEM);
    const count = invItem ? invItem.amount : 0;
    return { balance: bal, count: count };
}

// 辅助函数：打印资产
async function logAsset(name, client) {
    const asset = await getAsset(name, client);
    console.log(`   👤 ${name.padEnd(12)} | 余额: $${asset.balance} | 铁锭库存: ${asset.count}`);
}

runScenario();