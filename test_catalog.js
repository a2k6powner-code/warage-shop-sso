const axios = require('axios');

const API_URL = 'http://localhost:3000';
// 必须与 .env 里的 ADMIN_UUIDS 一致，否则测试会报 403
const ADMIN_UUID = 'admin_uuid_001'; 
const NORMAL_USER_UUID = 'player_steve_no_power';

const client = axios.create({ baseURL: API_URL });

async function runCatalogTest() {
    console.log('📚 开始分类目录系统测试...\n');

    try {
        // --- 场景 1: 权限测试 ---
        console.log('1. [普通用户] 尝试创建 "黑客分类" (预期被拒绝)...');
        try {
            await client.post('/api/admin/category', { 
                name: '黑客分类' 
            }, { 
                headers: { 'x-user-uuid': NORMAL_USER_UUID } 
            });
            console.error('   ❌ 严重错误: 普通用户竟然创建成功了！权限失效！');
        } catch (err) {
            if (err.response && err.response.status === 403) {
                console.log('   ✅ 权限验证通过: 服务器拒绝了普通用户的请求 (403 Forbidden)');
            } else {
                console.error('   ❌ 未知错误:', err.message);
            }
        }

        // --- 场景 2: 管理员创建层级结构 ---
        console.log('\n2. [管理员] 创建顶级分类 "战斗舰船"...');
        const rootRes = await client.post('/api/admin/category', {
            parentId: null,
            name: '战斗舰船',
            sortOrder: 1
        }, { headers: { 'x-user-uuid': ADMIN_UUID } });
        
        const rootId = rootRes.data.data.id;
        console.log(`   ✅ 顶级分类创建成功 (ID: ${rootId})`);

        console.log('\n3. [管理员] 在 "战斗舰船" 下创建子分类 "巡洋舰"...');
        const subRes = await client.post('/api/admin/category', {
            parentId: rootId,  // 指向上一级
            name: '巡洋舰',
            sortOrder: 1
        }, { headers: { 'x-user-uuid': ADMIN_UUID } });
        
        const subId = subRes.data.data.id;
        console.log(`   ✅ 子分类创建成功 (ID: ${subId})`);

        // --- 场景 3: 绑定物品 ---
        console.log('\n4. [管理员] 将物品 "cruiser_thorax" 放入 "巡洋舰" 分类...');
        await client.post('/api/admin/item', {
            categoryId: subId,
            itemId: 'cruiser_thorax',
            displayName: '托勒克斯级巡洋舰',
            iconUrl: 'http://example.com/icon.png'
        }, { headers: { 'x-user-uuid': ADMIN_UUID } });
        console.log('   ✅ 物品绑定成功');

        // --- 场景 4: 公共读取 (验证树结构) ---
        console.log('\n5. [公共] 拉取完整的分类树 (验证嵌套结构)...');
        const treeRes = await client.get('/api/catalog/tree');
        const tree = treeRes.data.data;

        // 打印树结构摘要
        console.log('   📊 接收到的树结构:');
        
        // 简单遍历查找刚才创建的节点
        const combatShipCat = tree.find(c => c.id === rootId);
        if (combatShipCat) {
            console.log(`   - 顶级: ${combatShipCat.name}`);
            const cruiserCat = combatShipCat.children.find(c => c.id === subId);
            if (cruiserCat) {
                console.log(`     └─ 子级: ${cruiserCat.name}`);
                const item = cruiserCat.items.find(i => i.item_id === 'cruiser_thorax');
                if (item) {
                    console.log(`        └─ 物品: ${item.display_name} [${item.item_id}]`);
                    console.log('\n🎉 测试通过！目录结构逻辑完美运行。');
                } else {
                    console.error('❌ 错误: 物品未出现在子分类中');
                }
            } else {
                console.error('❌ 错误: 子分类未出现在顶级分类下');
            }
        } else {
            console.error('❌ 错误: 顶级分类未找到 (可能被旧数据淹没)');
        }

    } catch (err) {
        console.error('❌ 测试中断:', err.response ? err.response.data : err.message);
    }
}

runCatalogTest();