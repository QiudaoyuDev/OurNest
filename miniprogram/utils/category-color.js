/**
 * 莫兰迪分类色彩与图标高阶映射工具
 */

const CATEGORY_COLOR_SCHEMES = {
  food: {
    chipClass: "cat-chip-food",
    iconColor: "#e86a33",
    bgColor: "#fff1e6",
  },
  shopping: {
    chipClass: "cat-chip-shopping",
    iconColor: "#4f46e5",
    bgColor: "#eef2ff",
  },
  traffic: {
    chipClass: "cat-chip-traffic",
    iconColor: "#0284c7",
    bgColor: "#e0f2fe",
  },
  salary: {
    chipClass: "cat-chip-salary",
    iconColor: "#0ea569",
    bgColor: "#e8f8f0",
  },
  house: {
    chipClass: "cat-chip-house",
    iconColor: "#d97706",
    bgColor: "#fef3c7",
  },
  entertainment: {
    chipClass: "cat-chip-entertainment",
    iconColor: "#db2777",
    bgColor: "#fce7f3",
  },
  medical: {
    chipClass: "cat-chip-medical",
    iconColor: "#059669",
    bgColor: "#e8f8f0",
  },
  defaultExpense: {
    chipClass: "cat-chip-food",
    iconColor: "#f0442f",
    bgColor: "#fff0ea",
  },
  defaultIncome: {
    chipClass: "cat-chip-salary",
    iconColor: "#25a66a",
    bgColor: "#e8f8f0",
  },
};

function resolveCategoryScheme(name = "", type = "expense", iconName = "") {
  const text = (String(name) + " " + String(iconName)).toLowerCase();

  if (type === "income") {
    return CATEGORY_COLOR_SCHEMES.salary;
  }

  if (/(餐|吃|饭|菜|果|零食|咖啡|饮|奶茶|酒|外卖|food|snack|vegetable|fruit|alcohol)/.test(text)) {
    return CATEGORY_COLOR_SCHEMES.food;
  }
  if (
    /(购|买|日用|衣|服|数码|美妆|包|鞋|宠|母婴|shopping|clothes|beauty|digital|pet|baby)/.test(text)
  ) {
    return CATEGORY_COLOR_SCHEMES.shopping;
  }
  if (/(交通|行|车|打车|铁|机|油|汽|路|transport|car|train|flight)/.test(text)) {
    return CATEGORY_COLOR_SCHEMES.traffic;
  }
  if (/(房|租|水|电|煤|气|暖|物业|家|维修|house|home|repair)/.test(text)) {
    return CATEGORY_COLOR_SCHEMES.house;
  }
  if (/(玩|娱乐|电影|旅游|游|动|健身|乐|社交|social|sport|entertainment)/.test(text)) {
    return CATEGORY_COLOR_SCHEMES.entertainment;
  }
  if (/(医|药|病|健|诊|体检|medical)/.test(text)) {
    return CATEGORY_COLOR_SCHEMES.medical;
  }

  return CATEGORY_COLOR_SCHEMES.defaultExpense;
}

module.exports = {
  resolveCategoryScheme,
  CATEGORY_COLOR_SCHEMES,
};
