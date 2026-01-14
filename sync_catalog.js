const fs = require('fs');
const yaml = require('js-yaml'); // 需要 npm install js-yaml
const db = require('./db');
const catalog = require('./catalog');

// 配置文件路径
const CONFIG_PATH = './catalog.config.yaml';

async function syncCatalog() {
    console.log('🔄 开始同步分类目录...');

    try {
        // 1. 读取 YAML 配置文件
        if (!fs.existsSync(CONFIG_PATH)) {
            throw new Error(`找不到配置文件: ${CONFIG_PATH}`);
        }
        const fileContents = fs.readFileSync(CONFIG_PATH, 'utf8');
        const configData = yaml.load(fileContents);

        // 2. 开启事务 (确保 清空+写入 要么全成功，要么全失败)
        const syncTx = db.transaction(() => {
            console.log('🗑️  正在清空旧目录数据...');
            
            // 清空 categories 表 (因为设置了 CASCADE，items 表里的数据也会自动被删除)
            db.prepare('DELETE FROM categories').run();
            // 重置自增 ID 计数器 (可选，为了好看)
            db.prepare("DELETE FROM sqlite_sequence WHERE name='categories' OR name='items'").run();

            // 3. 递归写入新数据
            console.log('📝 正在写入新目录结构...');
            
            // 递归函数
            function processNodes(nodes, parentId) {
                if (!nodes || nodes.length === 0) return;

                for (const node of nodes) {
                    // 创建分类
                    // node.sort || 0 : 如果没写 sort，默认为 0
                    const result = catalog.createCategory(parentId, node.name, node.sort || 0);
                    const currentId = result.id;
                    
                    console.log(`   + 分类: ${node.name} (ID: ${currentId})`);

                    // 如果有物品，绑定物品
                    if (node.items && node.items.length > 0) {
                        for (const item of node.items) {
                            catalog.addItemToCategory(currentId, item.id, item.name, item.icon);
                            console.log(`     - 物品: ${item.name}`);
                        }
                    }

                    // 如果有子分类，递归处理
                    if (node.children) {
                        processNodes(node.children, currentId);
                    }
                }
            }

            // 从根节点开始处理 (parentId = null)
            processNodes(configData, null);
        });

        // 执行事务
        syncTx();

        console.log('\n✅ 同步完成！现在数据库已与 catalog.config.yaml 一致。');

    } catch (err) {
        console.error('\n❌ 同步失败:', err.message);
        process.exit(1);
    }
}

syncCatalog();