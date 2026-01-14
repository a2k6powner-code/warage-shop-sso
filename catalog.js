// catalog.js
const db = require('./db');

class CatalogModule {

    // --- 1. 获取完整的分类树 (公共接口) ---
    getCategoryTree() {
        // 取出所有分类，按排序字段排列
        const allCats = db.prepare(`SELECT * FROM categories ORDER BY sort_order ASC, id ASC`).all();
        
        // 取出所有已归档的物品
        const allItems = db.prepare(`SELECT * FROM items`).all();

        // 辅助函数：构建树
        const buildTree = (parentId) => {
            return allCats
                .filter(cat => cat.parent_id === parentId) // 找当前层级的子节点
                .map(cat => ({
                    ...cat,
                    // 递归找子分类
                    children: buildTree(cat.id),
                    // 找该分类下的物品
                    items: allItems.filter(item => item.category_id === cat.id)
                }));
        };

        // 从顶级节点 (parent_id 为 null) 开始构建
        return buildTree(null);
    }

    // --- 2. 创建分类 (管理员) ---
    createCategory(parentId, name, sortOrder = 0) {
        if (!name) throw new Error("分类名称不能为空");
        
        // 验证 parentId 是否存在 (如果不是顶级)
        if (parentId) {
            const parent = db.prepare(`SELECT id FROM categories WHERE id = ?`).get(parentId);
            if (!parent) throw new Error("父分类不存在");
        }

        const info = db.prepare(`
            INSERT INTO categories (parent_id, name, sort_order, created_at)
            VALUES (?, ?, ?, ?)
        `).run(parentId || null, name, sortOrder, new Date().toISOString());

        return { id: info.lastInsertRowid, name };
    }

    // --- 3. 删除分类 (管理员) ---
    deleteCategory(id) {
        // 专业做法：如果有子分类或子物品，禁止删除，防止数据孤儿
        const hasChildren = db.prepare(`SELECT id FROM categories WHERE parent_id = ?`).get(id);
        const hasItems = db.prepare(`SELECT id FROM items WHERE category_id = ?`).get(id);

        if (hasChildren || hasItems) {
            throw new Error("该分类下还有子分类或物品，无法删除。请先清空。");
        }

        db.prepare(`DELETE FROM categories WHERE id = ?`).run(id);
        return { success: true };
    }

    // --- 4. 添加/绑定物品到分类 (管理员) ---
    addItemToCategory(categoryId, itemId, displayName, iconUrl = null) {
        // 检查分类是否存在
        const cat = db.prepare(`SELECT id FROM categories WHERE id = ?`).get(categoryId);
        if (!cat) throw new Error("分类不存在");

        // 插入或更新 (如果物品已存在，更新它的分类和名称)
        // 使用 UPSERT 语法 (SQLite 3.24+)
        db.prepare(`
            INSERT INTO items (category_id, item_id, display_name, icon_url, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(item_id) DO UPDATE SET
                category_id = excluded.category_id,
                display_name = excluded.display_name,
                icon_url = excluded.icon_url
        `).run(categoryId, itemId, displayName, iconUrl, new Date().toISOString());

        return { success: true };
    }
}

module.exports = new CatalogModule();