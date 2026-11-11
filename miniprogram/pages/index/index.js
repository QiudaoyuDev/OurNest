const ledgerStore = require("../../services/ledger.store");
const dataRefresh = require("../../services/data-refresh.service");
const feedback = require("../../services/feedback-ui");
const { on, off } = require("../../utils/event-bus");

const TAB_TITLES = {
  index: "",
  records: "\u660e\u7ec6",
  analysis: "\u5206\u6790",
  profile: "\u6211\u7684",
};

Page({
  data: {
    activeTab: "index",
    navbarTitle: TAB_TITLES.index,
    currentLedgerName: "",
    showNavbarLedger: false,
    recordsMonth: "",
    recordDisabledReason: "noLedger",
    visitedTabs: { index: true },
    foreground: true,
  },

  onLoad(options = {}) {
    this.syncRecordAccess();
    this.onCurrentLedgerChanged = () => this.syncRecordAccess();
    on("ledger:current-changed", this.onCurrentLedgerChanged);
    this.onLedgerSyncFailed = () =>
      feedback.showToast({ type: "warning", message: "账本同步失败，请稍后手动同步" });
    on("ledger:sync-failed", this.onLedgerSyncFailed);
    const activeTab = TAB_TITLES.hasOwnProperty(options.tab) ? options.tab : "index";
    const currentLedger = (getApp().globalData || {}).currentLedger;
    const currentLedgerName = (currentLedger && currentLedger.name) || "";
    const showNavbarLedger =
      (activeTab === "records" || activeTab === "analysis") && !!currentLedgerName;
    this.setData({
      activeTab,
      navbarTitle: TAB_TITLES[activeTab],
      currentLedgerName,
      showNavbarLedger,
      recordsMonth: /^\d{4}-\d{2}$/.test(options.month || "") ? options.month : "",
      visitedTabs: { [activeTab]: true },
    });
    this.unsubscribeLedgerSync = ledgerStore.subscribeSync((result) => {
      this.syncRecordAccess();
      const profile = this.selectComponent("#tab-profile");
      if (profile && typeof profile.refreshSyncTime === "function") profile.refreshSyncTime();
      if ((result.removedLedgerIds || []).length) {
        feedback.showToast({ type: "info", message: "账本访问权限已变化" });
      }
      if (result.changed) {
        dataRefresh.invalidate({
          ledgerIds: result.changedLedgerIds,
          removedLedgerIds: result.removedLedgerIds,
          mutationId: result.mutationId,
          source: "ledger-sync",
        });
      }
    });
  },

  onUnload() {
    if (this.onCurrentLedgerChanged) off("ledger:current-changed", this.onCurrentLedgerChanged);
    if (this.onLedgerSyncFailed) off("ledger:sync-failed", this.onLedgerSyncFailed);
    if (this.unsubscribeLedgerSync) this.unsubscribeLedgerSync();
    this.unsubscribeLedgerSync = null;
  },

  onShow() {
    this.syncRecordAccess();
    this.setData({ foreground: true });
    const profile =
      typeof this.selectComponent === "function" && this.selectComponent("#tab-profile");
    if (profile && typeof profile.syncAuthState === "function") profile.syncAuthState();
    const home = typeof this.selectComponent === "function" && this.selectComponent("#tab-home");
    const currentLedgerId = (getApp().globalData.currentLedger || {})._id || "";
    if (
      home &&
      home.data &&
      (home.data.ledgerId || "") !== currentLedgerId &&
      typeof home.refreshDashboard === "function"
    ) {
      home.refreshDashboard();
    }
    ledgerStore.syncLedgers().catch((error) => console.warn("page ledger sync failed", error));
  },

  onHide() {
    this.setData({ foreground: false });
  },

  syncRecordAccess() {
    const ledger = getApp().globalData.currentLedger;
    const recordDisabledReason =
      !ledger || !ledger._id
        ? "noLedger"
        : ledger.readonly || ledger.role === "readonly"
          ? "readonly"
          : "";
    const currentLedgerName = (ledger && ledger.name) || "";
    const showNavbarLedger =
      (this.data.activeTab === "records" || this.data.activeTab === "analysis") &&
      !!currentLedgerName;
    const patch = {};
    if (recordDisabledReason !== this.data.recordDisabledReason) {
      patch.recordDisabledReason = recordDisabledReason;
    }
    if (currentLedgerName !== this.data.currentLedgerName) {
      patch.currentLedgerName = currentLedgerName;
    }
    if (showNavbarLedger !== this.data.showNavbarLedger) {
      patch.showNavbarLedger = showNavbarLedger;
    }
    if (Object.keys(patch).length > 0) {
      this.setData(patch);
    }
  },

  onNavbarSwitchLedger() {
    const targets = {
      records: "#tab-records",
      analysis: "#tab-analysis",
    };
    const selector = targets[this.data.activeTab];
    if (!selector) return;
    const component = typeof this.selectComponent === "function" && this.selectComponent(selector);
    if (component && typeof component.switchLedger === "function") {
      component.switchLedger();
    }
  },

  refreshActiveTab(syncResult) {
    const targets = {
      index: ["#tab-home", "refreshDashboard"],
      records: ["#tab-records", "refreshRecords"],
      analysis: ["#tab-analysis", "refreshAnalysis"],
      profile: ["#tab-profile", "refreshAfterSync"],
    };
    const target = targets[this.data.activeTab];
    if (!target) return;
    const component = this.selectComponent(target[0]);
    if (component && typeof component[target[1]] === "function") component[target[1]](syncResult);
  },

  switchTab(event) {
    const tab = event.detail.tab || event.detail.key;
    if (!TAB_TITLES.hasOwnProperty(tab) || tab === this.data.activeTab) return;
    const visitedTabs = { ...this.data.visitedTabs, [tab]: true };
    const currentLedger = (getApp().globalData || {}).currentLedger;
    const currentLedgerName =
      (currentLedger && currentLedger.name) || this.data.currentLedgerName || "";
    const showNavbarLedger = (tab === "records" || tab === "analysis") && !!currentLedgerName;
    this.setData({
      activeTab: tab,
      navbarTitle: TAB_TITLES[tab],
      currentLedgerName,
      showNavbarLedger,
      recordsMonth: "",
      visitedTabs,
    });
  },
});
