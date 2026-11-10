const app = getApp();
const ledgerService = require("../../services/ledger.service");
const ledgerStore = require("../../services/ledger.store");
const feedback = require("../../services/feedback-ui");

Page({
  data: { code: "", preview: null, status: "input", busy: false, ledgerId: "" },
  onInput(event) {
    this.setData({ code: event.detail.value, preview: null, status: "input" });
  },
  async previewInvite() {
    if (this.data.busy) return;
    const code = String(this.data.code || "")
      .toUpperCase()
      .replace(/[\s-]/g, "");
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
      feedback.showToast({ type: "warning", message: "请输入正确的 8 位邀请码" });
      return;
    }
    wx.hideKeyboard();
    this.setData({ code });
    this.setData({ busy: true });
    try {
      const preview = await ledgerService.previewLedgerInvite(code);
      this.setData({ preview, status: "preview" });
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "无法查看邀请" });
    } finally {
      this.setData({ busy: false });
    }
  },
  editCode() {
    if (!this.data.busy) this.setData({ status: "input", preview: null });
  },
  async join() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const hasCurrent = Boolean(app.globalData.user && app.globalData.user.currentLedgerId);
      const result = await ledgerStore.joinLedgerByInviteToken(this.data.code);
      this.setData({ status: "success", ledgerId: result.ledgerId, already: result.already });
      if (!hasCurrent) await this.openLedger();
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "加入失败，请重试" });
    } finally {
      this.setData({ busy: false });
    }
  },
  async openLedger() {
    if (this.data.opening) return;
    this.setData({ opening: true });
    try {
      const result = await ledgerService.setCurrentLedger(this.data.ledgerId);
      await ledgerStore.refreshLedgers({ force: true });
      app.globalData.currentLedger = result.ledger;
      app.globalData.readonly = result.role === "readonly";
      if (app.globalData.user) app.globalData.user.currentLedgerId = this.data.ledgerId;
      app.persistAuthState();
      wx.reLaunch({ url: "/pages/index/index" });
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "切换账本失败，请重试" });
    } finally {
      this.setData({ opening: false });
    }
  },
  goBack() {
    wx.navigateBack();
  },
});
