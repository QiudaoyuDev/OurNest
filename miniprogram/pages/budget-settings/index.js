const feedback = require("../../services/feedback-ui");
const app = getApp();
const ledgerStore = require("../../services/ledger.store");
const dataRefresh = require("../../services/data-refresh.service");
const { emit } = require("../../utils/event-bus");

function normalizeBudget(value) {
  const numberValue = Math.round(Number(value) * 100) / 100;
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function isValidBudget(value) {
  return (
    /^\d+(?:\.\d{1,2})?$/.test(String(value)) &&
    normalizeBudget(value) >= 1 &&
    normalizeBudget(value) <= 999999
  );
}

Page({
  data: {
    ledgerId: "",
    ledgerName: "我的账本",
    budgetEnabled: false,
    monthlyBudget: 3000,
    saving: false,
    readonly: false,
  },

  onLoad() {
    const ledger = app.globalData.currentLedger || {};
    this.setData({
      ledgerId: ledger._id || "",
      ledgerName: ledger.name || "我的账本",
      budgetEnabled: Boolean(ledger.budgetEnabled),
      monthlyBudget: String(ledger.monthlyBudget || 3000),
      readonly: Boolean(ledger.readonly),
    });
  },

  onEnableChange(event) {
    this.setData({ budgetEnabled: Boolean(event.detail.value) });
  },

  onBudgetInput(event) {
    this.setData({ monthlyBudget: event.detail.value });
  },

  async saveBudget() {
    if (this.data.readonly) {
      feedback.showReadonlyToast();
      return;
    }
    if (this.data.saving) return;
    if (this.data.budgetEnabled && !isValidBudget(this.data.monthlyBudget)) {
      feedback.showToast({ type: "warning", message: "预算金额需为 1-999999，最多两位小数" });
      return;
    }
    this.setData({ saving: true });
    try {
      const data = await ledgerStore.updateBudget({
        ledgerId: this.data.ledgerId,
        budgetEnabled: this.data.budgetEnabled,
        monthlyBudget: normalizeBudget(this.data.monthlyBudget),
      });
      const ledger = data.ledger;
      if (ledger) {
        app.globalData.currentLedger = {
          ...(app.globalData.currentLedger || {}),
          ...ledger,
        };
        app.persistAuthState();
      }
      const budgetPayload = {
        ledgerId: this.data.ledgerId,
        budgetEnabled: this.data.budgetEnabled,
        monthlyBudget: normalizeBudget(this.data.monthlyBudget),
      };
      const pages = getCurrentPages();
      const previousPage = pages[pages.length - 2];
      if (previousPage) {
        const home =
          typeof previousPage.selectComponent === "function" &&
          previousPage.selectComponent("#tab-home");
        if (home) {
          if (typeof home.applyBudgetUpdate === "function") {
            home.applyBudgetUpdate(budgetPayload);
          }
          if (typeof home.refreshDashboard === "function") {
            home.refreshDashboard({ silent: true });
          }
        }
      }
      emit("budget:changed", budgetPayload);
      emit("records:changed", { ledgerId: this.data.ledgerId, source: "budget-mutation" });
      dataRefresh.invalidate({ ledgerId: this.data.ledgerId, source: "budget-mutation" });
      wx.navigateBack();
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "保存失败" });
    } finally {
      this.setData({ saving: false });
    }
  },
});
