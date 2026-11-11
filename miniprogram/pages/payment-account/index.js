const feedback = require("../../services/feedback-ui");
const app = getApp();
const ledgerStore = require("../../services/ledger.store");
const { getPaymentAccounts } = require("../../services/payment-account.service");

Page({
  data: {
    ledgerId: "",
    ledgerName: "我的账本",
    accounts: [],
    readonly: false,
    saving: false,
    addDialogVisible: false,
    accountDraft: "",
    deleteDialogVisible: false,
    deletingIndex: -1,
    deletingAccount: "",
  },
  onShow() {
    this.loadCurrentLedger();
  },
  async loadCurrentLedger() {
    if (this.loading) return;
    this.loading = true;
    try {
      const auth = await app.loginWithWechat({ force: true });
      const ledger = auth.currentLedger || {};
      this.setData({
        ledgerId: ledger._id || "",
        ledgerName: ledger.name || "我的账本",
        accounts: getPaymentAccounts(ledger),
        readonly: Boolean(ledger.readonly),
      });
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "账户加载失败" });
    } finally {
      this.loading = false;
    }
  },
  async saveAccounts(accounts) {
    if (this.data.saving) return false;
    this.setData({ saving: true });
    try {
      const data = await ledgerStore.updateAccounts({
        ledgerId: this.data.ledgerId,
        accounts,
      });
      app.globalData.currentLedger = {
        ...(app.globalData.currentLedger || {}),
        ...(data.ledger || {}),
      };
      app.persistAuthState();
      this.setData({ accounts });
      return true;
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "保存失败" });
      return false;
    } finally {
      this.setData({ saving: false });
    }
  },
  openDeleteDialog(event) {
    if (this.data.readonly || this.data.saving) return;
    const index = Number(event.currentTarget.dataset.index);
    const account = this.data.accounts[index];
    if (!account) return;
    if (this.data.accounts.length <= 1) {
      feedback.showToast({ type: "warning", message: "请至少保留一个账户" });
      return;
    }
    this.setData({
      deleteDialogVisible: true,
      deletingIndex: index,
      deletingAccount: account,
    });
  },
  closeDeleteDialog() {
    if (this.data.saving) return;
    this.setData({
      deleteDialogVisible: false,
      deletingIndex: -1,
      deletingAccount: "",
    });
  },
  async confirmDeleteAccount() {
    const index = this.data.deletingIndex;
    if (index < 0 || index >= this.data.accounts.length) return;
    const nextAccounts = this.data.accounts.filter((_, itemIndex) => itemIndex !== index);
    const ok = await this.saveAccounts(nextAccounts);
    if (ok) {
      this.setData({
        deleteDialogVisible: false,
        deletingIndex: -1,
        deletingAccount: "",
      });
      feedback.showToast({ type: "success", message: "账户已删除" });
    }
  },
  openAddDialog() {
    if (this.data.readonly || this.data.saving) return;
    this.setData({
      addDialogVisible: true,
      accountDraft: "",
    });
  },
  closeAddDialog() {
    if (this.data.saving) return;
    this.setData({
      addDialogVisible: false,
      accountDraft: "",
    });
  },
  onDraftInput(event) {
    const value = String(event.detail.value || "");
    const accountDraft = Array.from(value).slice(0, 12).join("");
    this.setData({ accountDraft });
  },
  clearDraft() {
    this.setData({ accountDraft: "" });
  },
  async confirmAddAccount() {
    if (this.data.readonly || this.data.saving) return;
    const name = String(this.data.accountDraft || "").trim();
    if (!name) {
      feedback.showToast({ type: "warning", message: "请输入账户名称" });
      return;
    }
    if (Array.from(name).length > 12) {
      feedback.showToast({ type: "warning", message: "账户名称最多 12 个字符" });
      return;
    }
    if (this.data.accounts.includes(name)) {
      feedback.showToast({ type: "warning", message: "该账户已存在" });
      return;
    }
    const ok = await this.saveAccounts([...this.data.accounts, name]);
    if (ok) {
      this.setData({
        addDialogVisible: false,
        accountDraft: "",
      });
      feedback.showToast({ type: "success", message: "账户添加成功" });
    }
  },
});
