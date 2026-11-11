const app = getApp();
const categoryService = require("../../services/category.service");
const ledgerStore = require("../../services/ledger.store");
const feedback = require("../../services/feedback-ui");
const { resolveCategoryScheme } = require("../../utils/category-color");

function compareCategoryOrder(left, right) {
  if (left.isOther !== right.isOther) return left.isOther ? 1 : -1;
  return Number(left.sort || 0) - Number(right.sort || 0);
}

function groupCategories(categories, type) {
  return categories.filter((item) => item.type === type).sort(compareCategoryOrder);
}

function buildRows(groups, activeParentId, type = "expense") {
  const decoratedGroups = groups.map((item) => {
    const scheme = resolveCategoryScheme(item.name, type || item.type || "expense", item.icon);
    return {
      ...item,
      chipClass: scheme.chipClass,
      iconColor: scheme.iconColor,
      isProtected: Boolean(item.isOther),
    };
  });
  const rows = [];
  for (let index = 0; index < decoratedGroups.length; index += 4) {
    const items = decoratedGroups.slice(index, index + 4);
    rows.push({
      id: items.map((item) => item._id).join("_"),
      items,
      isActive: items.some((item) => item._id === activeParentId),
    });
  }
  return rows;
}

Page({
  data: {
    ledgerId: "",
    ledgerName: "分类管理",
    role: "",
    pageIndex: 0,
    type: "expense",
    expenseGroups: [],
    incomeGroups: [],
    expenseRows: [],
    incomeRows: [],
    currentRows: [],
    activeParentId: "",
    canCreate: false,

    // Sheet / Dialog state
    showEditor: false,
    editingItem: null,
    draftName: "",
    draftIcon: "",
    saving: false,

    deleteDialogVisible: false,
    deletingItem: null,
    deleting: false,
  },
  onLoad(options = {}) {
    const ledger = app.globalData.currentLedger || {};
    const ledgerId = options.ledgerId || ledger._id || "";
    const type = options.type === "income" ? "income" : "expense";
    this.setData({
      ledgerId,
      ledgerName: options.ledgerName
        ? decodeURIComponent(options.ledgerName)
        : ledger.name || "分类管理",
      type,
      pageIndex: type === "income" ? 1 : 0,
    });
  },
  onShow() {
    this.loadCategories();
  },
  async loadCategories() {
    const cachedLedgers = (await ledgerStore.getLedgers().catch(() => [])) || [];
    const currentGlobal = app.globalData.currentLedger || {};
    const targetId = this.data.ledgerId || currentGlobal._id || currentGlobal.id;
    if (!targetId) return;
    const ledger =
      cachedLedgers.find((item) => (item._id || item.id) === targetId) || currentGlobal;
    const ledgerId = ledger._id || ledger.id || targetId;
    const items = await categoryService.listCategories(ledgerId);
    const categories = items || [];
    const expenseGroups = groupCategories(categories, "expense");
    const incomeGroups = groupCategories(categories, "income");
    const type = this.data.type;
    const groups = type === "income" ? incomeGroups : expenseGroups;
    const activeParentId = groups.some((item) => item._id === this.data.activeParentId)
      ? this.data.activeParentId
      : (groups[0] && groups[0]._id) || "";
    const isReadonly = Boolean(ledger.readonly || ledger.role === "readonly");
    const role = ledger.role || (ledger.type === "shared" ? "member" : "owner");
    const canCreate = !isReadonly;
    const expenseRows = buildRows(expenseGroups, activeParentId, "expense");
    const incomeRows = buildRows(incomeGroups, activeParentId, "income");
    this.setData({
      ledgerId,
      role,
      expenseGroups,
      incomeGroups,
      expenseRows,
      incomeRows,
      currentRows: type === "income" ? incomeRows : expenseRows,
      activeParentId,
      canCreate,
    });
  },
  changePage(event) {
    const pageIndex = Number(event.currentTarget.dataset.index || 0);
    const type = pageIndex ? "income" : "expense";
    const groups = pageIndex ? this.data.incomeGroups : this.data.expenseGroups;
    const activeParentId = (groups[0] && groups[0]._id) || "";
    const currentRows = buildRows(groups, activeParentId, type);
    this.setData({
      pageIndex,
      type,
      activeParentId,
      currentRows,
    });
  },
  handleCategoryTap(event) {
    const item = event.currentTarget.dataset.item;
    if (!item) return;
    this.setData({
      showEditor: true,
      editingItem: item,
      draftName: item.name,
      draftIcon: item.icon,
    });
  },
  openCreate() {
    if (!this.data.canCreate) return;
    const defaultIcon = this.data.type === "income" ? "category-salary" : "category-food";
    this.setData({
      showEditor: true,
      editingItem: null,
      draftName: "",
      draftIcon: defaultIcon,
    });
  },
  closeEditor() {
    if (this.data.saving) return;
    this.setData({ showEditor: false });
  },
  bindNameInput(event) {
    const draftName = Array.from(event.detail.value || "")
      .slice(0, 6)
      .join("");
    this.setData({ draftName });
  },
  chooseIcon() {
    if (
      this.data.editingItem &&
      (this.data.editingItem.isProtected || this.data.role !== "owner")
    ) {
      return;
    }
    wx.navigateTo({
      url: `/pages/category-icon-picker/index?icon=${encodeURIComponent(this.data.draftIcon)}`,
    });
  },
  onIconSelected(icon) {
    this.setData({ draftIcon: icon });
  },
  async saveEditor() {
    if (this.data.saving) return;
    const name = String(this.data.draftName || "").trim();
    if (!name) {
      feedback.showToast({ type: "warning", message: "请输入分类名称" });
      return;
    }
    if (!this.data.draftIcon) {
      feedback.showToast({ type: "warning", message: "请选择图标" });
      return;
    }
    this.setData({ saving: true });
    try {
      await categoryService.saveCategory({
        ledgerId: this.data.ledgerId,
        categoryId: this.data.editingItem && this.data.editingItem._id,
        type: this.data.type,
        name,
        icon: this.data.draftIcon,
      });
      this.setData({ showEditor: false });
      await this.loadCategories();
      feedback.showToast({
        type: "success",
        message: this.data.editingItem ? "分类已更新" : "分类创建成功",
      });
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "保存失败" });
    } finally {
      this.setData({ saving: false });
    }
  },
  openDeleteDialog() {
    if (this.data.role !== "owner" || !this.data.editingItem || this.data.editingItem.isProtected)
      return;
    this.setData({
      deleteDialogVisible: true,
      deletingItem: this.data.editingItem,
      showEditor: false,
    });
  },
  closeDeleteDialog() {
    if (this.data.deleting) return;
    this.setData({
      deleteDialogVisible: false,
      deletingItem: null,
    });
  },
  async confirmDelete() {
    if (this.data.deleting || !this.data.deletingItem) return;
    this.setData({ deleting: true });
    try {
      await categoryService.removeCategory(this.data.deletingItem._id, this.data.ledgerId);
      this.setData({
        deleteDialogVisible: false,
        deletingItem: null,
      });
      await this.loadCategories();
      feedback.showToast({ type: "success", message: "分类已删除，记录已转入其他" });
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "删除未完成，请重试" });
    } finally {
      this.setData({ deleting: false });
    }
  },
});
