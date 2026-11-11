const categories = [
  {
    key: '["id","food"]',
    categoryId: "food",
    name: "餐饮美食",
    categoryName: "餐饮美食",
    categoryIcon: "restaurant-line",
    amount: 1268.5,
    previousAmount: 980,
    rate: 58,
    recordCount: 3,
  },
  {
    key: '["id","travel"]',
    categoryId: "travel",
    name: "交通出行",
    categoryName: "交通出行",
    categoryIcon: "bus-line",
    amount: 900,
    previousAmount: 600,
    rate: 42,
    recordCount: 1,
  },
];
const records = [
  {
    _id: "fixture-1",
    type: "expense",
    date: "2025-11-06",
    categoryName: "餐饮美食",
    categoryIcon: "restaurant-line",
    account: "微信",
    amount: 268.5,
  },
  {
    _id: "fixture-2",
    type: "expense",
    date: "2025-11-03",
    categoryName: "交通出行",
    categoryIcon: "bus-line",
    account: "银行卡",
    amount: 900,
  },
];
module.exports = {
  async getAnalysis() {
    return {
      ledger: { _id: "fixture", name: "我们的小家", type: "personal" },
      range: { start: "2025-11-01", end: "2025-12-01", label: "2025年11月" },
      overview: { income: 6000, expense: 2168.5, balance: 3831.5, recordCount: 4 },
      comparison: { enabled: true, expense: { delta: 588.5 } },
      trendMeta: { isPartial: false },
      recentMonths: [
        { key: "2025-06", label: "6月", expense: 1600 },
        { key: "2025-07", label: "7月", expense: 2200 },
        { key: "2025-08", label: "8月", expense: 1800 },
        { key: "2025-09", label: "9月", expense: 2500 },
        { key: "2025-10", label: "10月", expense: 1580 },
        { key: "2025-11", label: "11月", expense: 2168.5 },
      ],
      dashboard: {
        type: "expense",
        total: 2168.5,
        recordCount: 4,
        dailyAverage: 72.28,
        categories,
        accounts: [
          { name: "微信", amount: 1268.5, rate: 58, recordCount: 3 },
          { name: "银行卡", amount: 900, rate: 42, recordCount: 1 },
        ],
        daily: [
          { date: "2025-11-03", expense: 900 },
          { date: "2025-11-06", expense: 1268.5 },
        ],
        topRecords: records,
      },
    };
  },
};
