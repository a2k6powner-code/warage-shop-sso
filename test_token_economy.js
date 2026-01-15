const axios = require('axios');

const API = 'http://localhost:3000';
const INTERNAL_KEY = 'sk_live_123456'; // 对应 .env 里的 INTERNAL_API_KEY
const UUID = 'Player_Steve';           // 测试玩家
const ITEM = 'diamond';

// === 客户端工厂 ===
// 1. 内部客户端 (模拟游戏插件，用 API Key)
const gameClient = axios.create({
    baseURL: API,
    headers: { 'x-api-key': INTERNAL_KEY }
});

// 2. 网页客户端 (模拟浏览器，用 Token)
const createWebClient = (token) => {
    return axios.create({
        baseURL: API,
        headers: { 'Authorization': `Bearer ${token}` }
    });
};

async function runTest() {
    console.log('🧪 === Minecraft 多钱包/多Token 机制全流程测试 ===\n');

    try {
        // =================================================================
        // 第一幕：创建两个平行宇宙 (两个独立钱包)
        // =================================================================
        console.log('📢 第一幕：生成 Token (模拟在两台电脑上登录)');
        
        // 1. 生成 Token A (比如在手机上)
        const resA = await gameClient.post('/api/internal/generate-token', { uuid: UUID });
        const tokenA = resA.data.token;
        const clientA = createWebClient(tokenA);
        console.log(`   ✅ 钱包 A 创建成功 (Token: ${tokenA.substring(0, 8)}...)`);

        // 2. 生成 Token B (比如在网吧)
        const resB = await gameClient.post('/api/internal/generate-token', { uuid: UUID });
        const tokenB = resB.data.token;
        const clientB = createWebClient(tokenB);
        console.log(`   ✅ 钱包 B 创建成功 (Token: ${tokenB.substring(0, 8)}...)`);

        // 验证：初始余额都应该是 0
        const assetA = (await clientA.get('/api/assets/my')).data;
        const assetB = (await clientB.get('/api/assets/my')).data;
        console.log(`   🧐 钱包A 余额: $${assetA.balance} | 钱包B 余额: $${assetB.balance}`);


        // =================================================================
        // 第二幕：充值与认领 (The Claim Flow)
        // =================================================================
        console.log('\n📢 第二幕：游戏充值 & 钱包认领');

        // 1. 游戏里充值 1000 块 (只认 UUID，不认钱包)
        console.log(`   [游戏插件] 玩家 Steve 充值 $1000...`);
        await gameClient.post('/api/internal/deposit', {
            uuid: UUID, type: 'money', amount: 1000
        });

        // 2. 钱包 A 查看待领资产
        const checkA = (await clientA.get('/api/assets/my')).data;
        console.log(`   [钱包 A] 发现待领列表: ${JSON.stringify(checkA.pending)}`);
        
        if (checkA.pending.length === 0) throw new Error("待领资产未显示！");
        const depositId = checkA.pending[0].id;

        // 3. 钱包 A 认领这笔钱
        console.log(`   [钱包 A] 点击“认领”...`);
        await clientA.post('/api/assets/claim', { depositId });
        
        // 4. 再次验证：A 有钱了，B 应该还是穷光蛋
        const finalA = (await clientA.get('/api/assets/my')).data;
        const finalB = (await clientB.get('/api/assets/my')).data;
        
        console.log(`   💰 钱包A 余额: $${finalA.balance} (预期: 1000)`);
        console.log(`   💸 钱包B 余额: $${finalB.balance} (预期: 0)`);

        if (finalA.balance !== 1000 || finalB.balance !== 0) {
            throw new Error("资产隔离失败！钱包 B 不应该有钱，或者 钱包 A 没收到钱。");
        }
        console.log(`   ✅ 资产隔离验证通过：钱进了 A 口袋，B 看着眼馋。`);


        // =================================================================
        // 第三幕：钱包 B 自力更生 (存物品)
        // =================================================================
        console.log('\n📢 第三幕：钱包 B 存入钻石');
        
        // 1. 游戏里存入 10 个钻石
        await gameClient.post('/api/internal/deposit', {
            uuid: UUID, type: 'item', itemId: ITEM, amount: 10
        });

        // 2. 钱包 B 认领
        const checkB = (await clientB.get('/api/assets/my')).data;
        const itemDepositId = checkB.pending[0].id;
        await clientB.post('/api/assets/claim', { depositId: itemDepositId });
        console.log(`   [钱包 B] 认领了 10 个钻石。`);

        // 3. 钱包 B 挂单卖出 (卖给系统/或者单纯挂单测试)
        // 这里我们简单测试一下挂单，证明 B 确实有库存
        console.log(`   [钱包 B] 挂卖单: 5个钻石 @ $100...`);
        await clientB.post('/api/market/place', {
            itemId: ITEM, type: 'SELL', price: 100, amount: 5
        });

        // 4. 检查库存扣除
        const afterTradeB = (await clientB.get('/api/assets/my')).data;
        const invItem = afterTradeB.inventory.find(i => i.item_id === ITEM);
        console.log(`   📦 钱包B 剩余库存: ${invItem ? invItem.amount : 0} (预期: 5)`);


        // =================================================================
        // 第四幕：提现回游戏 (Withdraw)
        // =================================================================
        console.log('\n📢 第四幕：提现回游戏');
        
        // 钱包 B 把剩下的 5 个钻石提现
        console.log(`   [钱包 B] 申请提现 5 个钻石...`);
        await clientB.post('/api/assets/withdraw', {
            itemId: ITEM, amount: 5
        });

        // 验证 B 的库存应该是 0 了
        const finalInvB = (await clientB.get('/api/assets/my')).data.inventory.find(i => i.item_id === ITEM);
        if (finalInvB && finalInvB.amount > 0) throw new Error("提现后库存未扣除！");

        // 验证游戏插件是否收到了发货任务
        const pluginRes = await gameClient.get('/api/internal/fetch-purchases');
        const tasks = pluginRes.data.orders;
        const myTask = tasks.find(t => t.uuid === UUID && t.item_id === ITEM);
        
        if (myTask) {
            console.log(`   ✅ 游戏插件收到发货请求: 给 ${myTask.uuid} 发 ${ITEM}`);
        } else {
            throw new Error("游戏插件未收到提现任务！");
        }

        console.log('\n🎉🎉🎉 测试全部通过！多钱包系统运行完美！ 🎉🎉🎉');

    } catch (err) {
        console.error('\n❌ 测试失败:', err.response ? err.response.data : err.message);
    }
}

runTest();