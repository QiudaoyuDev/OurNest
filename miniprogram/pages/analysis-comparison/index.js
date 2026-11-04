const ledgerService = require("../../services/ledger.service");
const {
  recentPeriods,
  makeFamilyOptions,
  makeCategoryOptions,
  comparisonRows,
} = require("./view-model");

Page({
  data: {
    ledgerName: "账本",
    unit: "month",
    ledgerType: "personal",
    families: [{ label: "全部成员", value: "all" }],
    familyIndex: 0,
    selected: [],
    quick: "manual",
    categories: [{ label: "全部收支", value: "all" }],
    categoryIndex: 0,
    results: [],
    rows: [],
    loading: true,
    error: "",
  },
  onLoad(options = {}) {
    this.ledgerId = options.ledgerId || "";
    this.requestId = 0;
    this.setData({ selected: recentPeriods("month", 2) });
    if (this.ledgerId) this.load();
    else this.setData({ loading: false, error: "缺少账本信息" });
  },
  onUnload() {
    this.requestId += 1;
  },
  setQuick(event) {
    const quick = event.currentTarget.dataset.quick;
    const settings = {
      "6m": ["month", 6],
      "12m": ["month", 12],
      "3y": ["year", 3],
      "5y": ["year", 5],
      manual: ["month", 2],
    };
    if (!settings[quick]) return;
    const [unit, count] = settings[quick];
    this.setData({ quick, unit, selected: recentPeriods(unit, count) });
    this.load();
  },
  changeUnit(event) {
    const unit = event.currentTarget.dataset.unit;
    if (!["month", "year"].includes(unit)) return;
    this.setData({ quick: "manual", unit, selected: recentPeriods(unit, 2) });
    this.load();
  },
  changePeriod(event) {
    const index = Number(event.currentTarget.dataset.index);
    const selected = [...this.data.selected];
    selected[index] =
      this.data.unit === "year"
        ? String(event.detail.value).slice(0, 4)
        : String(event.detail.value).slice(0, 7);
    this.requestId += 1;
    this.setData({ selected, loading: false, results: [], rows: [], error: "请点击开始对比" });
  },
  addPeriod() {
    if (this.data.selected.length >= 5) return;
    this.requestId += 1;
    this.setData({
      selected: [...this.data.selected, this.data.selected[this.data.selected.length - 1]],
      loading: false,
      results: [],
      rows: [],
      error: "请选择新的周期",
    });
  },
  removePeriod(event) {
    if (this.data.selected.length <= 2) return;
    const index = Number(event.currentTarget.dataset.index);
    this.requestId += 1;
    this.setData({
      selected: this.data.selected.filter((_value, item) => item !== index),
      loading: false,
      results: [],
      rows: [],
      error: "请点击开始对比",
    });
  },
  async load() {
    const selected = [...this.data.selected];
    if (selected.length !== new Set(selected).size) {
      this.setData({ error: "请选择不同的自然周期" });
      return;
    }
    const requestId = ++this.requestId;
    this.setData({ loading: true, error: "", results: [], rows: [] });
    try {
      const result = await ledgerService.getPeriodComparison({
        ledgerId: this.ledgerId,
        unit: this.data.unit,
        periods: selected,
      });
      if (requestId !== this.requestId) return;
      const families = makeFamilyOptions(result.periods || []);
      const categories = makeCategoryOptions(result.periods || [], families[0]);
      this.setData({
        ledgerName: result.ledger.name,
        ledgerType: result.ledger.type || "personal",
        families,
        familyIndex: 0,
        results: result.periods || [],
        categories,
        categoryIndex: 0,
        rows: comparisonRows(result.periods || [], categories[0], families[0]),
        loading: false,
      });
    } catch (error) {
      if (requestId !== this.requestId) return;
      const messages = {
        INVALID_COMPARISON_PERIODS: "请选择十年内、尚未超过当前日期的不同周期",
        ANALYSIS_RECORD_LIMIT_EXCEEDED: "范围内记录超过 5000 条，请缩小范围",
      };
      this.setData({ loading: false, error: messages[error.message] || "对比加载失败，请重试" });
    }
  },
  changeCategory(event) {
    const categoryIndex = Number(event.detail.value);
    const category = this.data.categories[categoryIndex];
    if (!category) return;
    this.setData({
      categoryIndex,
      rows: comparisonRows(this.data.results, category, this.data.families[this.data.familyIndex]),
    });
  },
  changeFamily(event) {
    const familyIndex = Number(event.detail.value);
    const family = this.data.families[familyIndex];
    if (!family) return;
    const categories = makeCategoryOptions(this.data.results, family);
    this.setData({
      familyIndex,
      categories,
      categoryIndex: 0,
      rows: comparisonRows(this.data.results, categories[0], family),
    });
  },
  openChartPeriod(event) {
    return this.openPeriod({ currentTarget: { dataset: { index: event.detail.index } } });
  },
  openPeriod(event) {
    const row = this.data.rows[Number(event.currentTarget.dataset.index)];
    const category = this.data.categories[this.data.categoryIndex];
    const family = this.data.families[this.data.familyIndex];
    if (!row || !category || !family) return;
    const query = {
      ledgerId: this.ledgerId,
      start: row.start,
      end: row.end,
      type: family.value !== "all" ? "expense" : category.type || "all",
      name: `${row.key}明细`,
    };
    if (category.categoryFilter) query.filter = JSON.stringify(category.categoryFilter);
    if (family.value !== "all")
      query.family = JSON.stringify({ dimension: family.dimension, openid: family.openid });
    const params = Object.keys(query)
      .map((key) => `${key}=${encodeURIComponent(query[key])}`)
      .join("&");
    wx.navigateTo({ url: `/pages/record-filtered/index?${params}` });
  },
});
