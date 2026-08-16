// Prisma Client（环境变量由 Prisma CLI 自动加载 .env）
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============ 1. 定义默认任务类别 ============
const defaultCategories = [
  { code: 'DELIVERY', name: '跑腿送货', icon: '🛵', sort: 1, isActive: true },
  { code: 'SHOPPING', name: '代买代办', icon: '🛒', sort: 2, isActive: true },
  { code: 'CLEANING', name: '家政保洁', icon: '🧹', sort: 3, isActive: true },
  { code: 'REPAIR', name: '家电维修', icon: '🔧', sort: 4, isActive: true },
  { code: 'TUTORING', name: '学业辅导', icon: '📚', sort: 5, isActive: true },
  { code: 'PET_CARE', name: '宠物照看', icon: '🐶', sort: 6, isActive: true },
  { code: 'MOVING', name: '搬家协助', icon: '📦', sort: 7, isActive: true },
  { code: 'OTHER', name: '其他服务', icon: '❓', sort: 8, isActive: true },
];

// ============ 2. 定义默认分账规则 ============
// 注意：平台抽成 + 接单者分成 = 1.0
// 这里简单统一设置为 10% 平台 / 90% 接单者
const DEFAULT_PLATFORM_RATE = 0.1;
const DEFAULT_HELPER_RATE = 0.9;

async function main() {
  console.log('🌱 开始执行 Seed 脚本...');

  try {
    // 开启事务
    await prisma.$transaction(async (tx) => {
      // 1. 清理旧数据（可选：确保脚本可重复执行）
      console.log('🗑️ 清理旧数据...');
      // 由于外键约束，先清理规则，再清理类别
      await tx.profitSharingRule.deleteMany({});
      await tx.taskCategory.deleteMany({});

      // 2. 创建任务类别
      console.log('📂 插入任务类别数据...');
      const createdCategories = [];
      for (const cat of defaultCategories) {
        const created = await tx.taskCategory.create({
          data: cat,
        });
        createdCategories.push(created);
        console.log(`  ✅ 类别: ${cat.name} (${cat.code})`);
      }

      // 3. 创建全局默认分账规则
      console.log('📜 插入全局默认分账规则...');
      await tx.profitSharingRule.create({
        data: {
          name: '全局默认规则',
          categoryId: null, // null 表示全局适用
          platformRate: DEFAULT_PLATFORM_RATE,
          helperRate: DEFAULT_HELPER_RATE,
          isActive: true,
          priority: 0,
        },
      });
      console.log(`  ✅ 默认: 平台 ${DEFAULT_PLATFORM_RATE * 100}% / 接单者 ${DEFAULT_HELPER_RATE * 100}%`);

      // 4. 为每个类别创建专属分账规则（可选：初期使用全局规则即可，这里暂时只设全局规则）
      // 如果需要针对不同类别设置不同抽成，可以在这里添加
      // for (const cat of createdCategories) {
      //   await tx.profitSharingRule.create({
      //     data: {
      //       name: `${cat.name}专属规则`,
      //       categoryId: cat.id,
      //       platformRate: 0.15, // 例如清洁类抽 15%
      //       helperRate: 0.85,
      //       isActive: true,
      //       priority: 1,
      //     },
      //   });
      // }

      console.log('🎉 Seed 数据插入完成！');
    });
  } catch (e) {
    console.error('❌ Seed 脚本执行失败:', e);
    throw e;
  } finally {
    await prisma.$disconnect();
  }
}

main();
