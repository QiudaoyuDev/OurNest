const ledgerStore = require("../../services/ledger.store");
const dataRefresh = require("../../services/data-refresh.service");
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
    recordsMonth: "",
    recordDisabledReason: "noLedger",
    visitedTabs: { index: true },
    foreground: true,
  },

  onLoad(options = {}) {
    this.syncRecordAccess();
    this.onCurrentLedgerChanged = () => this.syncRecordAccess();
    on("ledger:current-changed", this.onCurrentLedgerChanged);
    const activeTab = TAB_TITLES.hasOwnProperty(options.tab) ? options.tab : "index";
    this.setData({
      activeTab,
      navbarTitle: TAB_TITLES[activeTab],
      recordsMonth: /^\d{4}-\d{2}$/.test(options.month || "") ? options.month : "",
      visitedTabs: { [activeTab]: true },
    });
    this.unsubscribeLedgerSync = ledgerStore.subscribeSync((result) => {
      this.syncRecordAccess();
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
    if (this.unsubscribeLedgerSync) this.unsubscribeLedgerSync();
    this.unsubscribeLedgerSync = null;
  },

  onShow() {
    this.syncRecordAccess();
    this.setData({ foreground: true });
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
    if (recordDisabledReason !== this.data.recordDisabledReason)
      this.setData({ recordDisabledReason });
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
    this.setData({
      activeTab: tab,
      navbarTitle: TAB_TITLES[tab],
      recordsMonth: "",
      visitedTabs,
    });
  },
});
