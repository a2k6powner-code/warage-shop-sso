const axios = require('axios');

const API_URL = 'http://localhost:3000';
const VALID_KEY = 'test_secret_key_123';
const PLAYER_UUID = 'hacker_steve';

const client = axios.create({ 
    baseURL: API_URL,
    validateStatus: () => true // 允许 axios 接收 4xx/5xx 响应而不抛出异常
});

async function runSecurityTest() {
    console.log('🔴 开始错误注入与安全测试...\n');

    // Case 1: 无 API Key 访问内部接口
    console.log('TEST 1: 无 API Key 访问内部接口');
    const noKeyRes = await client.post('/api/internal/generate-token', { uuid: PLAYER_UUID });
    checkResult(noKeyRes, 403, 'Forbidden: Invalid API Key');

    // Case 2: 错误 API Key 访问
    console.log('TEST 2: 错误 API Key 访问');
    const wrongKeyRes = await client.post('/api/internal/generate-token', 
        { uuid: PLAYER_UUID },
        { headers: { 'x-api-key': 'wrong_password' } }
    );
    checkResult(wrongKeyRes, 403, 'Forbidden: Invalid API Key');

    // Case 3: Token 重放攻击 (Replay Attack)
    console.log('TEST 3: Token 重放攻击 (尝试使用同一个 Token 登录两次)');
    // 3.1 先生成一个合法的
    const genRes = await client.post('/api/internal/generate-token', 
        { uuid: PLAYER_UUID }, 
        { headers: { 'x-api-key': VALID_KEY } }
    );
    const token = genRes.data.token;
    
    // 3.2 第一次登录 (应该成功)
    const login1 = await client.get(`/login?token=${token}`);
    if (login1.status === 200) console.log('   -> 第一次登录: 成功 (预期内)');
    else console.error('   -> 第一次登录失败 (非预期)');

    // 3.3 第二次登录 (应该失败，因为Token是一次性的)
    const login2 = await client.get(`/login?token=${token}`);
    if (login2.status === 403) console.log('✅ -> 第二次登录: 被拒绝 (防御成功)');
    else console.error('❌ -> 第二次登录: 竟然成功了 (漏洞! Token未销毁)');

    // Case 4: 暴力请求 (Rate Limiting)
    console.log('TEST 4: 速率限制测试 (尝试快速发送 110 次请求)');
    console.log('   -> 正在发送请求...');
    let successCount = 0;
    let blockCount = 0;
    
    // 我们之前的 server.js 设置了 windowMs: 15分钟, max: 100
    // 注意：如果你的 server.js 重启过，计数器会重置
    const promises = [];
    for (let i = 0; i < 110; i++) {
        promises.push(client.get('/login?token=fake_token')); // 故意用假接口刷量
    }
    
    const results = await Promise.all(promises);
    results.forEach(r => {
        if (r.status !== 429) successCount++;
        else blockCount++;
    });

    if (blockCount > 0) {
        console.log(`✅ 触发限流: ${blockCount} 个请求被拒绝 (429 Too Many Requests)`);
    } else {
        console.warn('⚠️ 未触发限流 (可能是测试数量不够或限流中间件配置未生效)');
    }

    // Case 5: SQL 注入尝试 (在 UUID 字段注入)
    console.log('TEST 5: SQL 注入尝试');
    // 尝试删除所有 Token 表的注入语句
    const sqlInjectionUuid = "steve'; DROP TABLE tokens; --"; 
    const injectionRes = await client.post('/api/internal/generate-token', 
        { uuid: sqlInjectionUuid },
        { headers: { 'x-api-key': VALID_KEY } }
    );
    
    // 如果注入成功，数据库表可能被删，或者 Token 生成的 UUID 变得奇怪
    // 如果防御成功，系统应该把它当做普通字符串处理
    if (injectionRes.status === 200) {
        console.log('   -> 服务器接受了输入，正在检查副作用...');
        // 尝试用正常 UUID 再请求一次，如果表被删了，这里会报错 500
        const verifyRes = await client.post('/api/internal/generate-token', 
            { uuid: 'check_alive' },
            { headers: { 'x-api-key': VALID_KEY } }
        );
        if (verifyRes.status === 200) {
            console.log('✅ 数据库存活，SQL注入无效 (参数化查询生效中)');
        } else {
            console.error('❌ 数据库似乎挂了，可能被注入成功');
        }
    }
}

function checkResult(res, expectedStatus, expectedMsgPart) {
    if (res.status === expectedStatus) {
        if (!expectedMsgPart || (res.data.error && res.data.error.includes(expectedMsgPart))) {
            console.log(`✅ 通过: 返回了 ${expectedStatus}`);
        } else {
            console.log(`⚠️ 状态码正确但消息不匹配: ${JSON.stringify(res.data)}`);
        }
    } else {
        console.error(`❌ 失败: 预期 ${expectedStatus}, 实际 ${res.status}`);
    }
}

runSecurityTest();