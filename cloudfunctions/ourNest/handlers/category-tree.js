const { db, now } = require("../shared/helpers");

function flatLedgerDefaults() {
  const icons = {
    餐饮: "category-food",
    购物: "category-shopping",
    日用: "category-daily",
    交通: "category-transport",
    蔬菜: "category-vegetable",
    水果: "category-fruit",
    零食: "category-snack",
    运动: "category-sport",
    娱乐: "category-entertainment",
    通讯: "category-phone",
    服饰: "category-clothes",
    美容: "category-beauty",
    住房: "category-house",
    居家: "category-home",
    孩子: "category-baby",
    长辈: "category-elder",
    社交: "category-social",
    旅行: "category-flight",
    烟酒: "category-alcohol",
    数码: "category-digital",
    汽车: "category-car",
    医疗: "category-medical",
    书籍: "category-book",
    学习: "category-study",
    宠物: "category-pet",
    礼金: "category-giftmoney",
    礼物: "category-gift",
    办公: "category-office",
    维修: "category-repair",
    捐赠: "category-donation",
    彩票: "category-lottery",
    亲友: "category-family",
    快递: "category-delivery",
    还款: "category-repayment",
    高铁动车: "category-train",
    其他: "category-other",
    工资: "category-salary",
    兼职: "category-parttime",
    理财: "category-investment",
    其它: "category-income-other",
  };
  const names = {
    expense: [
      "餐饮",
      "购物",
      "日用",
      "交通",
      "蔬菜",
      "水果",
      "零食",
      "运动",
      "娱乐",
      "通讯",
      "服饰",
      "美容",
      "住房",
      "居家",
      "孩子",
      "长辈",
      "社交",
      "旅行",
      "烟酒",
      "数码",
      "汽车",
      "医疗",
      "书籍",
      "学习",
      "宠物",
      "礼金",
      "礼物",
      "办公",
      "维修",
      "捐赠",
      "彩票",
      "亲友",
      "快递",
      "还款",
      "高铁动车",
      "其他",
    ],
    income: ["工资", "兼职", "理财", "礼金", "其它"],
  };
  return Object.entries(names).flatMap(([type, values]) =>
    values.map((name, index) => ({
      type,
      name,
      icon: icons[name],
      isOther: name === "其他" || name === "其它",
      ...(name === "高铁动车" ? { systemKey: "high_speed_rail" } : {}),
      sort: index,
    }))
  );
}

// Only existing flat categories satisfy a default. Legacy parent/child rows
// remain untouched so records that reference their IDs keep their identity.
function missingFlatDefaults(existing = []) {
  const keys = new Set(
    existing
      .filter((item) => item && !item.level && !item.parentId)
      .map((item) => JSON.stringify([item.type, item.name]))
  );
  return flatLedgerDefaults().filter((item) => !keys.has(JSON.stringify([item.type, item.name])));
}

async function createDefaultCategories(ledgerId, openid, transaction = db) {
  for (const category of flatLedgerDefaults()) {
    await transaction.collection("categories").add({
      data: {
        ...category,
        ledgerId,
        source: "system",
        createdBy: openid,
        createdAt: now(),
        updatedAt: now(),
      },
    });
  }
}

module.exports = { flatLedgerDefaults, missingFlatDefaults, createDefaultCategories };
