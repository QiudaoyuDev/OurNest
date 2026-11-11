const iconGroups = [
  {
    id: "categories",
    label: "常用分类",
    icons: [
      ["category-food", "餐饮", ""],
      ["category-shopping", "购物", ""],
      ["category-daily", "日用", ""],
      ["category-transport", "交通", ""],
      ["category-vegetable", "蔬菜", ""],
      ["category-fruit", "水果", ""],
      ["category-snack", "零食", ""],
      ["category-sport", "运动", ""],
      ["category-entertainment", "娱乐", ""],
      ["category-phone", "通讯", ""],
      ["category-clothes", "服饰", ""],
      ["category-beauty", "美容", ""],
      ["category-house", "住房", ""],
      ["category-home", "居家", ""],
      ["category-baby", "孩子", ""],
      ["category-elder", "长辈", ""],
      ["category-social", "社交", ""],
      ["category-flight", "旅行", ""],
      ["category-alcohol", "烟酒", ""],
      ["category-digital", "数码", ""],
      ["category-car", "汽车", ""],
      ["category-medical", "医疗", ""],
      ["category-book", "书籍", ""],
      ["category-study", "学习", ""],
      ["category-pet", "宠物", ""],
      ["category-giftmoney", "礼金", ""],
      ["category-gift", "礼物", ""],
      ["category-office", "办公", ""],
      ["category-repair", "维修", ""],
      ["category-donation", "捐赠", ""],
      ["category-lottery", "彩票", ""],
      ["category-family", "亲友", ""],
      ["category-delivery", "快递", ""],
      ["category-repayment", "还款", ""],
      ["category-train", "高铁动车", ""],
      ["category-other", "其他", ""],
      ["category-salary", "工资", ""],
      ["category-parttime", "兼职", ""],
      ["category-investment", "理财", ""],
      ["category-income-other", "其它", ""],
    ],
  },
].map((group) => ({
  ...group,
  icons: group.icons.map(([name, label, keywords]) => ({
    name,
    label,
    keywords,
    searchText: `${name} ${label} ${keywords}`.toLowerCase(),
  })),
}));

function getVisibleGroups(keyword) {
  const normalizedKeyword = String(keyword || "")
    .trim()
    .toLowerCase();
  return iconGroups
    .map((group) => ({
      ...group,
      icons: normalizedKeyword
        ? group.icons.filter((icon) => icon.searchText.includes(normalizedKeyword))
        : group.icons,
    }))
    .filter((group) => group.icons.length);
}

Page({
  data: {
    selected: "price-tag-3-line",
    keyword: "",
    visibleGroups: iconGroups,
  },

  onLoad(options) {
    this.setData({ selected: options.icon || this.data.selected });
  },

  onKeywordInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword, visibleGroups: getVisibleGroups(keyword) });
  },

  select(event) {
    const icon = event.currentTarget.dataset.icon;
    const pages = getCurrentPages();
    const previousPage = pages[pages.length - 2];
    if (previousPage && typeof previousPage.onIconSelected === "function") {
      previousPage.onIconSelected(icon);
    }
    wx.navigateBack();
  },
});
