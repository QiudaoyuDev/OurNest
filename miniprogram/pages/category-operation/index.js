const feedback = require("../../services/feedback-ui");
const app = getApp();
const categoryService = require("../../services/category.service");
Page({
  data: {
    ledgerId: "",
    type: "expense",
    title: "分类管理",
    role: "",
    items: [],
    showEditor: false,
    saving: false,
    deleting: false,
    editingItem: null,
    draftName: "",
    draftIcon: "",
  },
  onLoad(o) {
    const ledger = app.globalData.currentLedger || {};
    this.setData({
      ledgerId: o.ledgerId || ledger._id || "",
      title: ledger.name || "分类管理",
      type: o.type === "income" ? "income" : "expense",
    });
    this.load();
  },
  onShow() {
    if (this.data.ledgerId) this.load();
  },
  async load() {
    const allItems = await categoryService.listCategories(this.data.ledgerId);
    const cs = allItems || [];
    const items = cs
      .filter((item) => item.type === this.data.type)
      .map((item) => ({
        ...item,
        isProtected: Boolean(item.isOther),
      }));
    const ledger = app.globalData.currentLedger || {};
    this.setData({ items, role: ledger.role || "" });
  },
  openCreate() {
    if (!["owner", "member"].includes(this.data.role)) return;
    this.setData({ showEditor: true, editingItem: null, draftName: "", draftIcon: "" });
  },
  openEdit(e) {
    if (this.data.role !== "owner" || this.data.deleting) return;
    const item = e.currentTarget.dataset.item;
    if (item.isProtected) return;
    this.setData({
      showEditor: true,
      editingItem: item,
      draftName: item.name,
      draftIcon: item.icon,
    });
  },
  closeEditor() {
    if (this.data.saving) return;
    this.setData({ showEditor: false });
  },
  noop() {},
  bindNameInput(e) {
    const draftName = Array.from(e.detail.value || "")
      .slice(0, 6)
      .join("");
    this.setData({ draftName });
  },
  chooseIcon() {
    wx.navigateTo({
      url: `/pages/category-icon-picker/index?icon=${encodeURIComponent(this.data.draftIcon)}`,
    });
  },
  onIconSelected(icon) {
    this.setData({ draftIcon: icon });
  },
  async saveEditor() {
    if (this.data.saving) return;
    const name = this.data.draftName.trim();
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
      await this.load();
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "保存失败" });
    } finally {
      this.setData({ saving: false });
    }
  },
  async remove(e) {
    if (this.data.role !== "owner" || this.data.deleting) return;
    const item = e.currentTarget.dataset.item;
    if (item.isProtected) return;
    const content = "关联记录会自动保留并转入其他分类";
    wx.showModal({
      title: "删除分类",
      content,
      success: async (r) => {
        if (!r.confirm) return;
        if (this.data.deleting) return;
        this.setData({ deleting: true });
        try {
          await categoryService.removeCategory(item._id, this.data.ledgerId);
          await this.load();
        } catch (_error) {
          feedback.showToast({ type: "error", message: "分类删除未完成，请再次删除以继续" });
        } finally {
          this.setData({ deleting: false });
        }
      },
    });
  },
});
