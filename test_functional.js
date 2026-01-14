const axios = require('axios');

// 配置
const API_URL = 'http://localhost:3000';
const API_KEY = 'test_secret_key_123'; // 必须与 .env 一致
const PLAYER_UUID = 'steve_functional_test';

const client = axios.create({ baseURL: API_URL });

async function runTest() {
    console.log('🔵 开始功能流程测试...');

    try {
        // 1. [模拟插件] 生成 Token
        console.log('\n1. [插件] 请求生成 Token...');
        const tokenRes = await client.post('/api/internal/generate-token', 
            { uuid: PLAYER_UUID },
            { headers: { 'x-api-key': API_KEY } }
        );
        
        const { token, loginUrl } = tokenRes.data;
        console.log(`✅ Token生成成功: ${token.substring(0, 10)}...`);
        console.log(`   Login URL: ${loginUrl}`);

        // 2. [模拟玩家] 使用 Token 登录
        console.log('\n2. [玩家] 点击链接登录...');
        const loginRes = await client.get(`/login?token=${token}`);
        if (loginRes.status === 200 && loginRes.data.includes('登录成功')) {
            console.log('✅ 登录成功 (服务器验证并通过了 Token)');
        } else {
            throw new Error('登录失败');
        }

        // 3. [模拟玩家] 购买物品
        // 注意：实际项目中登录后会由前端保存 Session/JWT，这里我们在 Header 中模拟已登录状态
        console.log('\n3. [玩家] 购买一把钻石剑...');
        const buyRes = await client.post('/api/shop/purchase', 
            { itemId: 'diamond_sword' },
            { headers: { 'x-user-uuid': PLAYER_UUID } }
        );
        console.log('✅ 下单成功:', buyRes.data.order.orderId);

        // 4. [模拟插件] 拉取发货清单
        console.log('\n4. [插件] 轮询获取待发货物品...');
        const fetchRes = await client.get('/api/internal/fetch-purchases', {
            headers: { 'x-api-key': API_KEY }
        });
        
        const orders = fetchRes.data.orders;
        const myOrder = orders.find(o => o.uuid === PLAYER_UUID && o.item_id === 'diamond_sword');
        
        if (myOrder) {
            console.log(`✅ 插件成功获取到订单! OrderID: ${myOrder.order_id}`);
        } else {
            throw new Error('插件未拉取到刚才的订单');
        }

        // 5. [模拟插件] 再次拉取 (测试防重复领取)
        console.log('\n5. [插件] 再次拉取 (验证是否被标记/删除)...');
        const fetchAgainRes = await client.get('/api/internal/fetch-purchases', {
            headers: { 'x-api-key': API_KEY }
        });
        if (fetchAgainRes.data.orders.length === 0) {
            console.log('✅ 验证通过: 订单已被处理，未重复返回。');
        } else {
            console.error('❌ 验证失败: 订单重复返回了！');
        }

    } catch (err) {
        console.error('❌ 测试失败:', err.response ? err.response.data : err.message);
    }
}

runTest();