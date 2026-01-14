const axios = require('axios');
const client = axios.create({ baseURL: 'http://localhost:3000', headers: { 'x-user-uuid': 'rich_player' } });

async function run() {
    console.log('💰 开始经济系统测试...');

    // 1. 先给自己发钱
    console.log('1. [作弊] 给自己发 1000 块钱...');
    await client.post('/api/debug/give', { type: 'money', amount: 1000 });
    
    // 2. 查余额
    let res = await client.get('/api/assets/my');
    console.log(`   余额: ${res.data.balance}`); // 预期 1000

    // 3. 挂个买单 (花 200)
    console.log('\n2. [挂单] 花 200 块买东西...');
    await client.post('/api/market/place', { itemId: 'diamond', type: 'BUY', price: 200, amount: 1 });

    // 4. 再查余额
    res = await client.get('/api/assets/my');
    console.log(`   余额: ${res.data.balance}`); // 预期 800 (冻结了200)

    // 5. 撤单
    console.log('\n3. [撤单] 不买了，退钱...');
    // 这里需要先获取订单ID，略过具体步骤，假设你知道ID
    // await client.post('/api/market/cancel', { orderId: ... });
    
    console.log('✅ 测试结束');
}
run();