const db = require('./db');

// 模拟向过去插入数据
function fakeHistory() {
    console.log('正在生成模拟 K 线数据...');
    const itemId = 'diamond_sword';
    let price = 100;
    
    // 从 24 小时前开始，每小时生成几笔交易
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    const tx = db.transaction(() => {
        for (let i = 24; i >= 0; i--) {
            const timeBase = now - (i * oneHour);
            
            // 这一小时内发生了 3 笔交易，价格随机波动
            for (let j = 0; j < 3; j++) {
                // 价格波动 -5 到 +5
                const change = Math.floor(Math.random() * 11) - 5;
                price += change;
                if (price < 10) price = 10;

                const tradeTime = new Date(timeBase + j * 60000).toISOString();
                
                db.prepare(`
                    INSERT INTO trades (item_id, price, amount, created_at)
                    VALUES (?, ?, ?, ?)
                `).run(itemId, price, Math.floor(Math.random() * 10) + 1, tradeTime);
            }
        }
    });

    tx();
    console.log('✅ 模拟数据生成完毕！请打开 test_chart.html 查看效果。');
}

fakeHistory();