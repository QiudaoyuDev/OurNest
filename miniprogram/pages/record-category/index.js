const app = getApp();
const feedback = require("../../services/feedback-ui");
const { getId } = require("../../utils/mapper");
const categoryService = require("../../services/category.service");
const categoryStore = require("../../services/category.store");
const { startNavigation, markNavigation } = require("../../utils/navigation-timing");
Page({
  data: {
    type: "expense",
    categories: [],
    ledgerId: "",
    mode: "create",
    ledgerName: "选择分类",
  },
  onLoad(options = {}) {
    markNavigation("分类页", "onLoad");
    const ledger = app.globalData.currentLedger || {};
    this.setData({
      type: options.type === "income" ? "income" : "expense",
      ledgerId: options.ledgerId || ledger._id || "",
      mode: options.mode === "reselect" ? "reselect" : "create",
      ledgerName: options.ledgerName
        ? decodeURIComponent(options.ledgerName)
        : ledger.name || "选择分类",
    });
  },
  onReady() {
    markNavigation("分类页", "onReady");
  },
  onShow() {
    this.renderFromCache();
    this._unsubscribe = categoryStore.subscribeSync((result) => {
      if (result.ledgerId !== this.data.ledgerId) return;
      if (result.invalidated) this.loadCategories();
      else this.renderCategories(result.items);
    });
    this.loadCategories();
  },
  onHide() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  },
  onUnload() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  },
  renderFromCache() {
    const cached = categoryStore.getCategoriesSync(this.data.ledgerId);
    this.renderCategories(cached);
  },
  renderCategories(categories) {
    this.setData({
      categories: (categories || [])
        .filter((item) => item.type === this.data.type)
        .map((item) => ({ ...item, id: getId(item) })),
    });
  },
  async loadCategories() {
    try {
      const items = await categoryService.listCategories(this.data.ledgerId);
      this.renderCategories(items);
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "分类加载失败，请重试" });
    }
  },
  switchType(event) {
    this.setData({ type: event.currentTarget.dataset.type });
    this.renderFromCache();
  },
  chooseCategory(event) {
    const selected = this.data.categories.find(
      (item) => item.id === event.currentTarget.dataset.id
    );
    if (!selected) return;
    const { id: categoryId, name: category, icon: categoryIcon, systemKey } = selected;
    const categoryLabel = category;
    const parent = "";
    const parentIcon = "";
    if (this.data.mode === "reselect") {
      const previous = getCurrentPages().slice(-2)[0];
      if (previous && previous.applyCategorySelection)
        previous.applyCategorySelection({
          type: this.data.type,
          categoryId: categoryId || "",
          categoryName: category,
          categoryLabel,
          categoryIcon,
          systemKey,
          parentCategory: parent,
          parentIcon,
        });
      wx.navigateBack();
      return;
    }
    const params = [
      `type=${this.data.type}`,
      `categoryId=${encodeURIComponent(categoryId || "")}`,
      `category=${encodeURIComponent(category)}`,
      `categoryLabel=${encodeURIComponent(categoryLabel)}`,
      `categoryIcon=${encodeURIComponent(categoryIcon)}`,
      `parentCategory=${encodeURIComponent(parent)}`,
      `parentIcon=${encodeURIComponent(parentIcon)}`,
      this.data.ledgerId ? `ledgerId=${encodeURIComponent(this.data.ledgerId)}` : "",
    ];
    startNavigation("分类页", "编辑页");
    wx.redirectTo({ url: `/pages/record-edit/index?${params.filter(Boolean).join("&")}` });
  },
});
