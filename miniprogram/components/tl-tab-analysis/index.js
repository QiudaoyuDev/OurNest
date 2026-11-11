import * as echarts from "../ec-canvas/echarts";
const app = getApp();
const recordService = require("../../services/record.service");
const { initialRatioPreview, createRatioMethods } = require("./ratio-preview");
const ledgerService = require("../../services/ledger.service");
const ledgerStore = require("../../services/ledger.store");
const feedback = require("../../services/feedback-ui");
const dataRefresh = require("../../services/data-refresh.service");
const { createChartController } = require("./chart-controller");
const { validateAnalysisResponse } = require("../../services/analysis-contract");
const { formatDisplayMoney, formatMoney } = require("../../utils/money");
const { resolveCategoryScheme } = require("../../utils/category-color");
const { makeDashboardView, dayAdd, categoryDisplayIcon } = require("./dashboard");
const {
  monthAnchor,
  dateAnchor,
  customRangeDefaults,
  shiftMonth,
  formatAnalysisRangeLabel,
} = require("./dates");
const {
  comparisonText,
  comparisonLabel,
  decorateRanking,
  getDetailRows,
  decorateTopExpenseRecords,
  decorate,
  toAnalysisViewData,
  getRanking,
} = require("./view-model");
const {
  CHART_META,
  defaultChartForMode,
  getChartOption,
  hasChartData,
} = require("./chart-options");

Component({
  properties: {
    active: {
      type: Boolean,
      value: false,
      observer() {
        this.updateAvailability();
      },
    },
    foreground: {
      type: Boolean,
      value: true,
      observer() {
        this.updateAvailability();
      },
    },
  },
  data: {
    ...initialRatioPreview(),
    ledgerId: "",
    ledgerName: "分析账本",
    ledgerType: "personal",
    ledgerOptions: [],
    mode: "month",
    analysisType: "expense",
    dashboardView: {},
    selectedCategory: null,
    categoryPreview: [],
    categoryPreviewStatus: "idle",
    selectedDay: "",
    dayRecords: [],
    dayStatus: "idle",
    dayCursor: null,
    dayHasMore: false,
    showAllCategories: false,
    compareCategories: false,
    calendarExpanded: true,
    showTrendDetails: false,
    activeSection: "summary",
    scrollTarget: "",
    scrollTop: 0,
    sectionEndSpace: 0,
    dashboardChartError: false,
    trendChartError: false,
    selectedTrend: null,
    trendRows: [],
    rangeCategories: [],
    canShiftNext: false,
    modeOptions: [
      { value: "week", label: "周度" },
      { value: "month", label: "月度" },
      { value: "year", label: "年度" },
      { value: "custom", label: "自定义" },
      { value: "all", label: "累计" },
    ],
    modeIndex: 1,
    modeLabel: "\u6708\u5ea6",
    isModeSheetVisible: false,
    anchor: "",
    customStart: "",
    customEnd: "",
    customToday: "",
    rangeLabel: "",
    trendCaption: "",
    activeChart: "monthTrend",
    chartTitle: CHART_META.monthTrend.title,
    chartSubtitle: CHART_META.monthTrend.subtitle,
    hasChartData: false,
    hasRecords: false,
    ec: { disableTouch: false },
    categoryChartHidden: false,
    categoryChartActivated: false,
    // Rendered onto every chart host so init callbacks carry the node lifetime
    // they originated from, rather than relying on the mutable component state.
    chartNodeGeneration: 0,
    chartHostGeneration: 0,
    // Keep first-ready state separate from whether the current ec host remains
    // mounted, so same-context refreshes can reuse the existing chart node.
    chartFirstReadyEver: false,
    chartHostMounted: false,
    loading: true,
    error: false,
    noLedger: false,
    isLedgerSwitcherVisible: false,
    isLoadingLedgers: false,
    ledgerLoadError: false,
    overview: {},
    comparison: { enabled: false },
    incomeCompareText: "",
    expenseCompareText: "",
    balanceCompareText: "",
    balanceComparisonText: "",
    comparisonLabel: "",
    budget: {},
    trend: [],
    categories: [],
    categoryChart: [],
    incomeCategories: [],
    incomeCategoryChart: [],
    accounts: [],
    members: [],
    activeRanking: [],
    activeDetailRows: [],
    hasDetailRows: false,
    hasInsights: false,
    insightGroups: { up: [], down: [], neutral: [] },
    insights: [],
    monthlyTopRecords: [],
    yearRankingType: "expense",
    yearRankingRows: [],
    isQuestionDialogVisible: false,
    questionDialogTitle: "",
    questionDialogContent: "",
  },

  lifetimes: {
    attached() {
      this.isAttached = true;
      this.chart = null;
      this.secondaryCharts = {};
      this.chartController = createChartController({
        canRender: () => this.isAttached && this.isActiveAndForeground() && !this.data.loading,
        createChart: (canvas, width, height, dpr) =>
          echarts.init(canvas, null, {
            width,
            height,
            devicePixelRatio: Math.min(Number(dpr || 1), 2),
          }),
        getOption: (key) => this.getChartOptionForKey(key),
        onChartEvent: (key, params) => this.handleChartEvent(key, params),
      });
      this.analysisRequestId = 0;
      this.analysisRefreshGeneration = 0;
      this.analysisLifecycleGeneration = 0;
      // Response generations reject late data; node generations only change when
      // the chart host/context is replaced, allowing same-context refresh reuse.
      this.analysisNodeGeneration = 0;
      this._analysisNodeContext = null;
      this._analysisDisplayedContext = null;
      this._analysisFlight = null;
      this._analysisRequestedContext = null;
      this.categoryRequestId = 0;
      this.dayRequestId = 0;
      this.dirty = true;
      this.isBootstrapped = false;
      this._unsubscribeRefresh = dataRefresh.subscribe((event) =>
        this.handleDataInvalidation(event)
      );
      this.updateAvailability();
    },
    detached() {
      this.clearRatioPreview();
      if (this._unsubscribeRefresh) this._unsubscribeRefresh();
      this._unsubscribeRefresh = null;
      this.isAttached = false;
      this.analysisRequestId += 1;
      this.analysisRefreshGeneration = (this.analysisRefreshGeneration || 0) + 1;
      this.analysisLifecycleGeneration = (this.analysisLifecycleGeneration || 0) + 1;
      this.bumpAnalysisNodeGeneration();
      this._analysisNodeContext = null;
      this._analysisDisplayedContext = null;
      this._analysisFlight = null;
      this._analysisRequestedContext = null;
      this.categoryRequestId += 1;
      this.dayRequestId += 1;
      this._sectionRequestId = (this._sectionRequestId || 0) + 1;
      this.disposeChart();
      this.disposeSecondaryCharts();
      if (this._chartObserver && typeof this._chartObserver.disconnect === "function") {
        this._chartObserver.disconnect();
        this._chartObserver = null;
      }
      this.chartController = null;
    },
  },

  methods: {
    ...createRatioMethods(recordService, (options) => wx.navigateTo(options)),
    getChartOptionForKey(key) {
      if (key !== "dashboardCategory")
        return getChartOption(this.data, key === "main" ? undefined : key);
      const rows = (this.data.dashboardView.categories || []).filter((item) => item.amount > 0);
      const visible = rows.slice(0, 5);
      const remainder = rows.slice(5).reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
      const categoryChart = remainder
        ? [...visible, { name: "其余分类", amount: remainder / 100 }]
        : visible;
      return getChartOption({ ...this.data, categoryChart }, "category");
    },

    handleChartEvent(key, params) {
      if (key === "dashboardCategory") {
        const visible = (this.data.dashboardView.categories || [])
          .filter((item) => item.amount > 0)
          .slice(0, 5);
        if (params.dataIndex >= visible.length) return this.setData({ showAllCategories: true });
        const index = (this.data.dashboardView.categories || []).findIndex(
          (item) => item.key === visible[params.dataIndex].key
        );
        if (index >= 0) this.selectDashboardCategory({ currentTarget: { dataset: { index } } });
        return;
      }
      if (key === "category" || ["monthRatio", "yearRatio"].includes(this.data.activeChart))
        return this.openRatioChartSelection(params);
      this.openTrendRecords(params);
    },

    isActiveAndForeground() {
      return this.data.active !== false && this.data.foreground !== false;
    },

    updateAvailability() {
      if (!this.isAttached) return;
      if (!this.isActiveAndForeground()) {
        this.dirty = true;
        this.analysisRefreshGeneration = (this.analysisRefreshGeneration || 0) + 1;
        this.analysisLifecycleGeneration = (this.analysisLifecycleGeneration || 0) + 1;
        this.analysisRequestId = (this.analysisRequestId || 0) + 1;
        return;
      }
      if (!this.isBootstrapped) {
        this.isBootstrapped = true;
        this.bootstrap();
      } else if (this.dirty) this.loadAnalysis();
      else if (!this.data.loading) this.remeasureCharts();
    },

    handleDataInvalidation(event = {}) {
      const ledgerIds = event.ledgerIds || [];
      const removedLedgerIds = event.removedLedgerIds || [];
      if (
        ledgerIds.length &&
        this.data.ledgerId &&
        !ledgerIds.includes(this.data.ledgerId) &&
        !removedLedgerIds.includes(this.data.ledgerId)
      )
        return;
      this.dirty = true;
      this.analysisRefreshGeneration = (this.analysisRefreshGeneration || 0) + 1;
      this.clearRatioPreview();
      if (this.isActiveAndForeground())
        this.refreshAnalysis({ removedLedgerIds, changedLedgerIds: ledgerIds });
    },
    changeAnalysisType(event) {
      const type = event.currentTarget.dataset.type;
      if (!["income", "expense"].includes(type) || type === this.data.analysisType) return;
      this.setData({ analysisType: type, showAllCategories: false, compareCategories: false });
      this.dirty = true;
      this.analysisRefreshGeneration = (this.analysisRefreshGeneration || 0) + 1;
      this.loadAnalysis();
    },

    goSection(event) {
      const section = event.currentTarget.dataset.section;
      if (!["summary", "category", "account", "family"].includes(section)) return;
      const requestId = (this._sectionRequestId || 0) + 1;
      this._sectionRequestId = requestId;
      const query = this.createSelectorQuery();
      query.select(".analysis-scroll").boundingClientRect();
      query.select(".dashboard-sections").boundingClientRect();
      query.select(`#analysis-${section}`).boundingClientRect();
      query.select(".analysis-scroll").scrollOffset();
      query.exec((rects) => {
        if (
          !this.isAttached ||
          requestId !== this._sectionRequestId ||
          !rects ||
          !rects[0] ||
          !rects[1] ||
          !rects[2]
        )
          return;
        const actualScrollTop =
          rects[3] && Number.isFinite(rects[3].scrollTop)
            ? rects[3].scrollTop
            : this._scrollTop || 0;
        const scrollTop = Math.max(
          0,
          actualScrollTop + rects[2].top - rects[0].top - rects[1].height
        );
        const maxScroll =
          rects[3] && Number.isFinite(rects[3].scrollHeight)
            ? Math.max(0, rects[3].scrollHeight - rects[0].height)
            : scrollTop;
        const sectionEndSpace = Math.max(
          this.data.sectionEndSpace || 0,
          (this.data.sectionEndSpace || 0) + Math.ceil(Math.max(0, scrollTop - maxScroll))
        );
        this.setData({ scrollTop: actualScrollTop, sectionEndSpace }, () => {
          if (this.isAttached && requestId === this._sectionRequestId)
            this.setData({ scrollTop, activeSection: section });
        });
      });
    },

    onAnalysisScroll(event) {
      this._scrollTop = Number((event.detail || {}).scrollTop || 0);
      if (this._sectionMeasurement || this.data.loading || !this.createSelectorQuery) return;
      this._sectionMeasurement = true;
      const query = this.createSelectorQuery();
      query.select(".dashboard-sections").boundingClientRect();
      ["summary", "category", "account", "family"].forEach((section) => {
        query.select(`#analysis-${section}`).boundingClientRect();
      });
      query.select("#dashboard-category-chart-wrap").boundingClientRect();
      query.select(".analysis-scroll").boundingClientRect();
      query.exec((rects) => {
        this._sectionMeasurement = false;
        if (!this.isAttached || !rects || !rects[0]) return;
        let active = "summary";
        ["summary", "category", "account", "family"].forEach((section, index) => {
          const rect = rects[index + 1];
          if (rect && rect.top <= rects[0].bottom + 8) active = section;
        });
        if (active !== this.data.activeSection) this.setData({ activeSection: active });

        const chartWrap = rects[5];
        const viewport = rects[6];
        if (
          chartWrap &&
          viewport &&
          chartWrap.bottom > viewport.top &&
          chartWrap.top < viewport.bottom
        ) {
          this.activateDashboardChart();
        }
        if (chartWrap) {
          const isOccluded = chartWrap.bottom <= rects[0].bottom;
          if (Boolean(this.data.categoryChartHidden) !== Boolean(isOccluded)) {
            this.setData({ categoryChartHidden: Boolean(isOccluded) });
          }
        }
      });
    },

    toggleCategories() {
      if (this.data.showAllCategories && this.data.selectedCategory) {
        const index = (this.data.dashboardView.categories || []).findIndex(
          (item) => item.key === this.data.selectedCategory.key
        );
        if (index >= 5) {
          this.categoryRequestId += 1;
          this.setData({
            selectedCategory: null,
            categoryPreviewStatus: "idle",
            categoryPreview: [],
          });
        }
      }
      this.setData({ showAllCategories: !this.data.showAllCategories });
    },

    toggleCategoryComparison() {
      this.setData({ compareCategories: !this.data.compareCategories });
    },

    toggleCalendar() {
      this.setData({ calendarExpanded: !this.data.calendarExpanded });
    },

    toggleTrendDetails() {
      this.setData({ showTrendDetails: !this.data.showTrendDetails });
    },

    openFiltered(query) {
      const range = this.data.range || {};
      if (!this.data.ledgerId || !range.start || !range.end) return;
      const params = {
        ledgerId: this.data.ledgerId,
        start: range.start,
        end: range.end,
        type: this.data.analysisType,
        ...query,
      };
      const text = Object.keys(params)
        .map((key) => `${key}=${encodeURIComponent(params[key])}`)
        .join("&");
      wx.navigateTo({ url: `/pages/record-filtered/index?${text}` });
    },

    openDashboardAccount(event) {
      const item = (this.data.dashboardView.accounts || [])[
        Number(event.currentTarget.dataset.index)
      ];
      if (!item) return;
      const filter = item.missing ? { kind: "missing" } : { kind: "name", name: item.name };
      this.openFiltered({ account: JSON.stringify(filter), name: `${item.name}明细` });
    },

    openDashboardRecord(event) {
      const id = (event.detail && event.detail.id) || event.currentTarget.dataset.id;
      if (id) wx.navigateTo({ url: `/pages/record-detail/index?id=${encodeURIComponent(id)}` });
    },

    openDashboardRecords() {
      this.openFiltered({ name: `${this.data.dashboardView.typeLabel}明细` });
    },

    selectDashboardBar(event) {
      const item = (this.data.dashboardView.bars || [])[Number(event.currentTarget.dataset.index)];
      if (!item || item.future) return;
      if (this.data.mode === "month") {
        this.setData({ anchor: item.key });
        return this.loadAnalysis();
      }
      if (this.data.mode === "week") {
        return this.openFiltered({
          start: item.key,
          end: dayAdd(item.key, 1),
          name: `${item.key}明细`,
        });
      }
      this.setData({ selectedBar: item });
    },

    openSelectedMonth() {
      const item = this.data.selectedBar;
      if (!item || !/^\d{4}-\d{2}$/.test(item.key)) return;
      this.setData({
        mode: "month",
        modeLabel: "月度",
        modeIndex: 1,
        anchor: item.key,
        activeChart: "monthTrend",
        selectedBar: null,
      });
      this.loadAnalysis();
    },

    async selectDashboardCategory(event) {
      const item = (this.data.dashboardView.categories || [])[
        Number(event.currentTarget.dataset.index)
      ];
      if (!item || !item.recordCount) return;
      if (this.data.selectedCategory && this.data.selectedCategory.key === item.key) {
        this.categoryRequestId += 1;
        this.setData({
          selectedCategory: null,
          categoryPreviewStatus: "idle",
          categoryPreview: [],
        });
        return;
      }
      const categoryFilter = item.categoryId
        ? { kind: "id", id: item.categoryId }
        : { kind: "legacy", parent: item.parentCategory || "", name: item.categoryName || "" };
      const id = ++this.categoryRequestId;
      const type = this.data.analysisType;
      const range = this.data.range;
      this.setData({
        selectedCategory: { ...item, categoryFilter },
        categoryPreviewStatus: "loading",
        categoryPreview: [],
      });
      try {
        const result = await recordService.listRecords({
          ledgerId: this.data.ledgerId,
          start: range.start,
          end: range.end,
          type,
          categoryFilter,
          summaryFiltered: true,
          pageSize: 3,
        });
        if (!this.isAttached || id !== this.categoryRequestId) return;
        if (
          Math.round(Number((result.rangeSummary || {})[type]) * 100) !==
            Math.round(Number(item.amount) * 100) ||
          result.rangeRecordCount !== item.recordCount
        ) {
          this.setData({ categoryPreviewStatus: "stale" });
          return;
        }
        this.setData({
          categoryPreviewStatus: "ready",
          categoryPreview: (result.records || []).map((record) => ({
            ...record,
            categoryIcon: item.displayIcon,
            amountText: formatDisplayMoney(record.amount),
          })),
        });
      } catch (_error) {
        if (this.isAttached && id === this.categoryRequestId)
          this.setData({ categoryPreviewStatus: "error" });
      }
    },

    openDashboardCategoryRecords() {
      const item = this.data.selectedCategory;
      if (!item || this.data.categoryPreviewStatus !== "ready") return;
      this.openFiltered({ filter: JSON.stringify(item.categoryFilter), name: `${item.name}明细` });
    },

    async selectDashboardDay(event) {
      const date = event.currentTarget.dataset.date;
      if (!date || date > dateAnchor()) return;
      const id = ++this.dayRequestId;
      this.setData({
        selectedDay: date,
        dayStatus: "loading",
        dayRecords: [],
        dayCursor: null,
        dayHasMore: false,
      });
      await this.fetchDashboardDay(id, false);
    },

    async fetchDashboardDay(id, append) {
      const date = this.data.selectedDay;
      try {
        const result = await recordService.listRecords({
          ledgerId: this.data.ledgerId,
          start: date,
          end: dayAdd(date, 1),
          type: this.data.analysisType,
          summaryFiltered: true,
          pageSize: 30,
          cursor: append ? this.data.dayCursor : null,
        });
        if (!this.isAttached || id !== this.dayRequestId) return;
        const rows = (result.records || []).map((record) => ({
          ...record,
          amountText: formatDisplayMoney(record.amount),
        }));
        this.setData({
          dayStatus: "ready",
          dayRecords: append ? [...this.data.dayRecords, ...rows] : rows,
          dayAmountText: formatMoney((result.rangeSummary || {})[this.data.analysisType]),
          dayCursor: result.nextCursor,
          dayHasMore: result.hasMore,
        });
      } catch (_error) {
        if (this.isAttached && id === this.dayRequestId) this.setData({ dayStatus: "error" });
      }
    },

    loadMoreDashboardDay() {
      if (!this.data.dayHasMore || this.data.dayStatus !== "ready") return;
      this.setData({ dayStatus: "loadingMore" });
      return this.fetchDashboardDay(this.dayRequestId, true);
    },

    retryDashboardDay() {
      if (this.data.selectedDay) return this.fetchDashboardDay(++this.dayRequestId, false);
    },
    refreshAnalysis(syncResult = {}) {
      const changedLedgerIds = syncResult.changedLedgerIds || [];
      const removedLedgerIds = syncResult.removedLedgerIds || [];
      if (removedLedgerIds.includes(this.data.ledgerId)) {
        const fallback = ledgerStore
          .getCachedLedgers()
          .find((ledger) => !removedLedgerIds.includes(ledger._id || ledger.id));
        if (!fallback) {
          this.clearRatioPreview();
          this.analysisRequestId += 1;
          this.disposeChart();
          this.disposeSecondaryCharts();
          this.bumpAnalysisNodeGeneration();
          this._analysisNodeContext = null;
          this._analysisDisplayedContext = null;
          this.setData({
            ledgerId: "",
            ledgerName: "分析账本",
            loading: false,
            noLedger: true,
            hasChartData: false,
            chartHostMounted: false,
          });
          return;
        }
        this.setData({
          ledgerId: fallback._id || fallback.id,
          ledgerName: fallback.name || "分析账本",
          ledgerType: fallback.type || "personal",
          anchor: this.data.anchor,
          activeChart:
            (fallback.type || "personal") === "shared" || this.data.activeChart !== "member"
              ? this.data.activeChart
              : "trend",
        });
        return this.loadAnalysis();
      }
      if (changedLedgerIds.length && !changedLedgerIds.includes(this.data.ledgerId)) return;
      return this.loadAnalysis();
    },

    async bootstrap() {
      if (!app.globalData.loggedIn) return wx.reLaunch({ url: "/pages/login/index" });
      try {
        await app.loginWithWechat();
      } catch (error) {
        if (this.isAttached) {
          console.warn("analysis bootstrap failed", error);
          this.setData({ loading: false, error: true });
        }
        return;
      }
      if (!this.isAttached) return;
      const ledger = app.globalData.currentLedger || {};
      this.setData({
        ledgerId: ledger._id || "",
        ledgerName: ledger.name || "分析账本",
        ledgerType: ledger.type || "personal",
        anchor: monthAnchor(),
        ...(() => {
          const range = customRangeDefaults();
          return { customStart: range.start, customEnd: range.end, customToday: dateAnchor() };
        })(),
        noLedger: !ledger._id,
      });
      if (ledger._id) return this.loadAnalysis();
      this.setData({ loading: false });
    },

    getAnalysisRequestContext() {
      return {
        ledgerId: this.data.ledgerId,
        mode: this.data.mode,
        anchor: this.data.anchor,
        customStart: this.data.customStart,
        customEnd: this.data.customEnd,
        analysisType: this.data.analysisType,
        analysisView: ["week", "month", "year"].includes(this.data.mode),
        autoTrend: this.data.mode === "all",
      };
    },

    sameAnalysisContext(left, right) {
      return (
        Boolean(left && right) &&
        ["ledgerId", "mode", "anchor", "customStart", "customEnd", "analysisType"].every(
          (key) => left[key] === right[key]
        )
      );
    },

    loadAnalysis() {
      if (!this.isActiveAndForeground()) {
        this.dirty = true;
        return;
      }
      const context = this.getAnalysisRequestContext();
      this.dirty = true;
      if (this._analysisFlight) {
        if (!this.sameAnalysisContext(this._analysisRequestedContext, context)) {
          this.analysisRefreshGeneration = (this.analysisRefreshGeneration || 0) + 1;
          // A replacement context may be selected while the previous request
          // is in flight. Dispose immediately; the late response is rejected
          // by analysisRequestId/refresh generation and cannot revive its node.
          if (!this.sameAnalysisContext(this._analysisNodeContext, context)) {
            this.bumpAnalysisNodeGeneration();
            this._analysisNodeContext = null;
            this.disposeChart();
            this.disposeSecondaryCharts();
          }
        }
        return this._analysisFlight;
      }
      if (!context.ledgerId) {
        this.dirty = false;
        this.disposeChart();
        this.disposeSecondaryCharts();
        this.bumpAnalysisNodeGeneration();
        this._analysisNodeContext = null;
        this._analysisDisplayedContext = null;
        this.setData({
          loading: false,
          noLedger: true,
          hasChartData: false,
          chartHostMounted: false,
        });
        return;
      }
      const requestGeneration = this.analysisRefreshGeneration || 0;
      const lifecycleGeneration = this.analysisLifecycleGeneration || 0;
      const requestId = (this.analysisRequestId || 0) + 1;
      const reuseChartNode = this.sameAnalysisContext(this._analysisNodeContext, context);
      if (!reuseChartNode) {
        this.bumpAnalysisNodeGeneration();
        this._analysisNodeContext = { ...context };
        this.disposeChart();
        this.disposeSecondaryCharts();
      }
      this.analysisRequestId = requestId;
      this._analysisRequestedContext = context;
      const request = {
        ...context,
        analysisView: ["week", "month", "year"].includes(context.mode),
      };
      this.clearRatioPreview();
      this._sectionRequestId = (this._sectionRequestId || 0) + 1;
      this._chartRetryCount = 0;
      if (this._chartObserver && typeof this._chartObserver.disconnect === "function") {
        this._chartObserver.disconnect();
        this._chartObserver = null;
      }
      if (this.secondaryCharts && this.secondaryCharts.dashboardCategory) {
        if (this.chartController) this.chartController.dispose("dashboardCategory");
        delete this.secondaryCharts.dashboardCategory;
      }
      this.categoryRequestId = (this.categoryRequestId || 0) + 1;
      this.dayRequestId = (this.dayRequestId || 0) + 1;
      this.setData({
        loading: true,
        error: false,
        noLedger: false,
        // Keep the old response and host during same-context refresh. A
        // context replacement disposed the old node above and unmounts it
        // before a new host can bind.
        hasChartData: reuseChartNode ? this.data.hasChartData : false,
        chartHostMounted: reuseChartNode ? this.data.chartHostMounted : false,
        selectedCategory: null,
        categoryPreviewStatus: "idle",
        selectedDay: "",
        dayStatus: "idle",
        selectedBar: null,
        scrollTarget: "",
        scrollTop: 0,
        sectionEndSpace: 0,
        dashboardChartError: false,
        categoryChartActivated: false,
        categoryChartHidden: false,
        activeSection: "summary",
      });

      const flight = (async () => {
        try {
          const rawResult = await ledgerService.getAnalysis(request);
          const current = () =>
            this.isAttached &&
            this.isActiveAndForeground() &&
            requestId === this.analysisRequestId &&
            lifecycleGeneration === (this.analysisLifecycleGeneration || 0) &&
            requestGeneration === (this.analysisRefreshGeneration || 0) &&
            this.sameAnalysisContext(request, this.getAnalysisRequestContext());
          if (!current()) return;
          if (!rawResult.noLedger && rawResult.ledger) validateAnalysisResponse(rawResult, request);
          const result = decorate(rawResult);
          if (!current()) return;
          if (result.noLedger || !result.ledger) {
            this.disposeChart();
            this.disposeSecondaryCharts();
            this.bumpAnalysisNodeGeneration();
            this._analysisNodeContext = null;
            this._analysisDisplayedContext = null;
            this.setData({
              loading: false,
              noLedger: true,
              hasChartData: false,
              chartHostMounted: false,
            });
            this.dirty = false;
            return;
          }
          if (request.analysisView && !result.dashboard) throw new Error("ANALYSIS_API_OUTDATED");
          if (request.autoTrend && !(result.trendMeta && result.trendMeta.granularity))
            throw new Error("ANALYSIS_API_OUTDATED");
          const chartType =
            this.data.activeChart === "member" && result.ledger.type !== "shared"
              ? "trend"
              : this.data.activeChart;
          const meta = CHART_META[chartType];
          const responseHasChartData = hasChartData(result, chartType);
          const activeDetailRows = getDetailRows(result, chartType);
          const analysisViewData = { ...toAnalysisViewData(result) };
          // This transport concurrency token is for the next request, not view state.
          delete analysisViewData.snapshotRevision;
          const nextData = {
            ...analysisViewData,
            dashboardView: makeDashboardView(
              result,
              request.mode,
              request.analysisType || "expense",
              dateAnchor()
            ),
            loading: false,
            ledgerName: result.ledger.name,
            ledgerType: result.ledger.type,
            canShiftNext: Boolean(
              result.range && result.range.end && result.range.end <= dateAnchor()
            ),
            rangeLabel: formatAnalysisRangeLabel(request.mode, request.anchor, result.range.label),
            activeChart: chartType,
            chartTitle: meta.title,
            chartSubtitle: meta.subtitle,
            hasRecords: Number(result.overview.recordCount || 0) > 0,
            hasChartData: responseHasChartData,
            chartFirstReadyEver: true,
            chartHostMounted: responseHasChartData,
            chartHostGeneration: responseHasChartData
              ? this.analysisNodeGeneration
              : this.data.chartHostGeneration,
            activeRanking: decorateRanking(
              ["category", "monthRatio", "yearRatio"].includes(chartType)
                ? result.categories
                : chartType === "income"
                  ? result.incomeCategories
                  : getRanking(result, chartType)
            ),
            incomeCompareText: comparisonText(result.comparison, "income"),
            expenseCompareText: comparisonText(result.comparison, "expense"),
            balanceCompareText: comparisonText(result.comparison, "balance"),
            balanceComparisonText: comparisonText(result.comparison, "balance")
              ? `· ${comparisonLabel(request.mode, request.anchor)} ${comparisonText(result.comparison, "balance")}`
              : "",
            comparisonLabel: comparisonLabel(request.mode, request.anchor),
            trendCaption:
              result.trendMeta && result.trendMeta.isPartial && result.trendMeta.asOf
                ? `截至${result.trendMeta.asOf}`
                : "",
            activeDetailRows,
            trendRows: getDetailRows(result, "trend"),
            rangeCategories: (request.analysisType === "income"
              ? result.incomeCategories
              : result.categories
            ).map((item) => {
              const icon = categoryDisplayIcon(item, request.analysisType || "expense");
              const scheme = resolveCategoryScheme(
                item.name,
                request.analysisType || "expense",
                icon
              );
              return {
                ...item,
                displayIcon: icon,
                chipClass: scheme.chipClass,
                iconColor: scheme.iconColor,
              };
            }),
            hasDetailRows: activeDetailRows.length > 0,
            hasInsights:
              Object.values(result.insightGroups || {}).some((items) => items.length) ||
              result.insights.length > 0,
            monthlyTopRecords: decorateTopExpenseRecords(result.topExpenseRecords || []),
            yearRankingRows:
              this.data.yearRankingType === "income" ? result.incomeCategories : result.categories,
          };
          this.dirty = false;
          this._analysisDisplayedContext = { ...request };
          this.setData(nextData, () => this.renderChart());
        } catch (error) {
          const current =
            this.isAttached &&
            this.isActiveAndForeground() &&
            requestId === this.analysisRequestId &&
            lifecycleGeneration === (this.analysisLifecycleGeneration || 0) &&
            requestGeneration === (this.analysisRefreshGeneration || 0) &&
            this.sameAnalysisContext(request, this.getAnalysisRequestContext());
          if (!current) return;
          console.warn("analysis load failed", error);
          this.dirty = true;
          // Error/empty states must not retain sensitive values or a usable
          // chart from the failed response.
          // Invalidate the rendered host generation before exposing the error
          // state. Init events already queued by the old host can otherwise
          // arrive after disposal and recreate a chart in a failed view.
          this.bumpAnalysisNodeGeneration();
          this.disposeChart();
          this.disposeSecondaryCharts();
          this._analysisNodeContext = null;
          this._analysisDisplayedContext = null;
          this.setData({
            loading: false,
            error: true,
            chartHostMounted: false,
            hasChartData: false,
            hasRecords: false,
            dashboardView: {},
            overview: {},
            comparison: { enabled: false },
            trend: [],
            categories: [],
            categoryChart: [],
            incomeCategories: [],
            incomeCategoryChart: [],
            accounts: [],
            members: [],
            activeRanking: [],
            activeDetailRows: [],
            monthlyTopRecords: [],
            yearRankingRows: [],
          });
        } finally {
          if (this._analysisFlight === flight) this._analysisFlight = null;
          const needsCatchUp =
            requestGeneration !== (this.analysisRefreshGeneration || 0) ||
            !this.sameAnalysisContext(request, this.getAnalysisRequestContext());
          if (this.isAttached && this.isActiveAndForeground() && needsCatchUp) this.loadAnalysis();
        }
      })();
      this._analysisFlight = flight;
      return flight;
    },

    async switchLedger() {
      if (this.data.isLoadingLedgers) return;
      this.setData({
        isLedgerSwitcherVisible: true,
        isLoadingLedgers: true,
        ledgerLoadError: false,
      });
      try {
        this.setData({ ledgerOptions: await ledgerStore.getLedgers() });
      } catch (_error) {
        this.setData({ ledgerLoadError: true });
      } finally {
        this.setData({ isLoadingLedgers: false });
      }
    },

    closeLedgerSwitcher() {
      this.setData({ isLedgerSwitcherVisible: false });
    },

    chooseViewLedger(event) {
      const id = event.detail.ledgerId;
      const ledger = this.data.ledgerOptions.find((item) => (item._id || item.id) === id);
      if (!ledger) return;
      this.setData({
        ledgerId: id,
        ledgerName: ledger.name,
        ledgerType: ledger.type || "personal",
        anchor: this.data.anchor,
        activeChart:
          (ledger.type || "personal") === "shared" || this.data.activeChart !== "member"
            ? this.data.activeChart
            : "trend",
        isLedgerSwitcherVisible: false,
      });
      this.loadAnalysis();
    },

    openModeSheet() {
      this.setData({ isModeSheetVisible: true });
    },

    closeModeSheet() {
      this.setData({ isModeSheetVisible: false });
    },

    openQuestionDialog(event) {
      const question = event.currentTarget.dataset.question;
      const contentByQuestion = {
        "month-chart": {
          title: "图表分析说明",
          content: "可切换查看本月每日消费走势，或各分类支出在本月消费中的占比。",
        },
        "month-top": {
          title: "本月消费 Top 5 说明",
          content: "按单笔支出金额从高到低展示本月金额最高的 5 笔消费记录。",
        },
        "year-chart": {
          title: "图表分析说明",
          content: "可切换查看全年月度收支、近年结余趋势，以及各分类支出在全年消费中的占比。",
        },
        "year-ranking": {
          title: "分类排名说明",
          content: "按分类汇总全年收入或支出并按金额排序；变化幅度用于对比上一年同期。",
        },
      };
      const dialog = contentByQuestion[question];
      if (!dialog) return;
      this.setData({
        isQuestionDialogVisible: true,
        questionDialogTitle: dialog.title,
        questionDialogContent: dialog.content,
      });
    },

    closeQuestionDialog() {
      this.setData({ isQuestionDialogVisible: false });
    },

    chooseMode(event) {
      const mode = event.currentTarget.dataset.mode;
      this.closeModeSheet();
      this.setAnalysisMode(mode);
    },

    switchMode(event) {
      const mode = event.currentTarget.dataset.mode;
      this.setAnalysisMode(mode);
    },

    selectMode(event) {
      const option = this.data.modeOptions[Number(event.detail.value)];
      if (!option) return;
      this.setAnalysisMode(option.value);
    },

    setAnalysisMode(mode) {
      if (!this.data.modeOptions.some((item) => item.value === mode) || mode === this.data.mode)
        return;
      const customRange = customRangeDefaults();
      const current = dateAnchor();
      const oldMode = this.data.mode;
      const oldAnchor = this.data.anchor || current;
      const reference =
        oldMode === "year"
          ? `${oldAnchor}-12-31`
          : oldMode === "month"
            ? `${oldAnchor}-01`
            : oldMode === "week" && this.data.range && this.data.range.start
              ? this.data.range.start
              : oldAnchor;
      const referenceYear = reference.slice(0, 4);
      const selectedMonth =
        referenceYear === current.slice(0, 4) && oldMode === "year"
          ? current.slice(0, 7)
          : oldMode === "year"
            ? `${referenceYear}-12`
            : reference.slice(0, 7);
      const monthEnd = new Date(
        Date.UTC(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0)
      )
        .toISOString()
        .slice(0, 10);
      const nextData = {
        mode,
        activeChart: defaultChartForMode(mode),
        modeIndex: this.data.modeOptions.findIndex((item) => item.value === mode),
        modeLabel: this.data.modeOptions.find((item) => item.value === mode).label,
        anchor:
          mode === "week"
            ? selectedMonth === current.slice(0, 7)
              ? current
              : monthEnd
            : mode === "month"
              ? selectedMonth
              : mode === "year"
                ? referenceYear
                : "",
      };
      if (mode === "custom") {
        nextData.customStart = this.data.customStart || customRange.start;
        nextData.customEnd = this.data.customEnd || customRange.end;
        nextData.customToday = dateAnchor();
      }
      this.setData(nextData);
      this.loadAnalysis();
    },

    changeCustomStart(event) {
      const customStart = event.detail.value;
      const customEnd = customStart > this.data.customEnd ? customStart : this.data.customEnd;
      if (
        (new Date(`${customEnd}T00:00:00Z`) - new Date(`${customStart}T00:00:00Z`)) / 86400000 >=
        366
      ) {
        feedback.showToast({ type: "warning", message: "自定义范围最多 366 天" });
        return;
      }
      this.setData({ customStart, customEnd });
      this.loadAnalysis();
    },

    changeCustomEnd(event) {
      const customEnd = event.detail.value;
      const customStart = customEnd < this.data.customStart ? customEnd : this.data.customStart;
      if (
        (new Date(`${customEnd}T00:00:00Z`) - new Date(`${customStart}T00:00:00Z`)) / 86400000 >=
        366
      ) {
        feedback.showToast({ type: "warning", message: "自定义范围最多 366 天" });
        return;
      }
      this.setData({ customStart, customEnd });
      this.loadAnalysis();
    },

    shift(event) {
      const delta = Number(event.currentTarget.dataset.delta);
      if (this.data.mode === "week") {
        const date = new Date(`${this.data.anchor}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + delta * 7);
        const anchor = date.toISOString().slice(0, 10);
        if (anchor > dateAnchor()) return;
        this.setData({ anchor });
      } else if (this.data.mode === "month") {
        const anchor = shiftMonth(this.data.anchor, delta);
        if (anchor > monthAnchor()) return;
        this.setData({ anchor });
      } else if (this.data.mode === "year") {
        const anchor = String(Number(this.data.anchor) + delta);
        if (anchor > dateAnchor().slice(0, 4)) return;
        this.setData({ anchor });
      }
      this.loadAnalysis();
    },

    chooseAnalysisDate(event) {
      const value = event.detail.value;
      const anchor =
        this.data.mode === "year"
          ? value.slice(0, 4)
          : this.data.mode === "month"
            ? value.slice(0, 7)
            : value;
      if (!anchor || anchor > dateAnchor().slice(0, anchor.length)) return;
      this.setData({ anchor });
      this.loadAnalysis();
    },

    switchYearRanking(event) {
      const type = event.currentTarget.dataset.type;
      if (!["expense", "income"].includes(type) || type === this.data.yearRankingType) return;
      this.setData({
        yearRankingType: type,
        yearRankingRows: type === "income" ? this.data.incomeCategories : this.data.categories,
      });
    },

    switchChart(event) {
      const activeChart = event.currentTarget.dataset.chart;
      if (!CHART_META[activeChart] || activeChart === this.data.activeChart) return;
      this.clearRatioPreview();
      const meta = CHART_META[activeChart];
      const nextData = { ...this.data, activeChart };
      const detailRows = getDetailRows(nextData, activeChart);
      const ranking = ["category", "monthRatio", "yearRatio"].includes(activeChart)
        ? nextData.categories
        : activeChart === "income"
          ? nextData.incomeCategories
          : getRanking(nextData, activeChart);
      this.setData(
        {
          activeChart,
          chartTitle: meta.title,
          chartSubtitle: meta.subtitle,
          hasChartData: hasChartData(nextData, activeChart),
          activeRanking: decorateRanking(ranking),
          activeDetailRows: detailRows,
          hasDetailRows: detailRows.length > 0,
        },
        () => this.renderChart()
      );
    },

    openCategoryRecords(event) {
      const source = event.currentTarget.dataset.source;
      if (
        ["monthRatio", "yearRatio"].includes(this.data.activeChart) &&
        !["year", "custom"].includes(source)
      ) {
        const row = (this.data.activeRanking || [])[Number(event.currentTarget.dataset.index)];
        return this.loadRatioPreview(row && row.key);
      }
      const rows =
        source === "year"
          ? this.data.yearRankingRows
          : source === "custom"
            ? this.data.categories
            : this.data.activeRanking;
      const item = rows[Number(event.currentTarget.dataset.index)];
      const range = this.data.range || {};
      if (!item || !range.start || !range.end || !this.data.ledgerId) return;
      const categoryFilter = item.categoryId
        ? { kind: "id", id: item.categoryId }
        : { kind: "legacy", name: item.categoryName || "", parent: item.parentCategory || "" };
      const type = source === "year" ? this.data.yearRankingType : "expense";
      const query = {
        ledgerId: this.data.ledgerId,
        start: range.start,
        end: range.end,
        type,
        filter: JSON.stringify(categoryFilter),
        name: item.name || "其他",
      };
      const params = Object.keys(query)
        .map((key) => `${key}=${encodeURIComponent(query[key])}`)
        .join("&");
      wx.navigateTo({ url: `/pages/record-filtered/index?${params}` });
    },

    openFamilyRecords(event) {
      const dimension = event.currentTarget.dataset.dimension;
      const family = this.data.family || {};
      const rows =
        dimension === "payer"
          ? family.payers
          : dimension === "consumer"
            ? family.consumers
            : this.data.members;
      const item = rows && rows[Number(event.currentTarget.dataset.index)];
      const range = this.data.range || {};
      if (
        !item ||
        !range.start ||
        !range.end ||
        !["payer", "consumer", "creator"].includes(dimension)
      )
        return;
      const query = {
        ledgerId: this.data.ledgerId,
        start: range.start,
        end: range.end,
        type: "expense",
        family: JSON.stringify({ dimension, openid: item.openid || "" }),
        name: `${item.name}明细`,
      };
      const categoryIndex = event.currentTarget.dataset.categoryIndex;
      if (categoryIndex !== undefined && categoryIndex !== "") {
        const category = (item.categories || [])[Number(categoryIndex)];
        if (!category) return;
        query.filter = JSON.stringify(
          category.categoryId
            ? { kind: "id", id: category.categoryId }
            : {
                kind: "legacy",
                name: category.categoryName || "",
                parent: category.parentCategory || "",
              }
        );
      }
      const params = Object.keys(query)
        .map((key) => `${key}=${encodeURIComponent(query[key])}`)
        .join("&");
      wx.navigateTo({ url: `/pages/record-filtered/index?${params}` });
    },

    openTrendRecords(params = {}) {
      const chart = this.data.activeChart;
      const rows = chart === "yearBalance" ? this.data.recentYearTrend : this.data.trend;
      if (
        !["yearCashflow", "yearBalance", "monthTrend", "trend"].includes(chart) ||
        !Array.isArray(rows) ||
        !params
      )
        return;
      let row;
      if (params.componentType === "markPoint") {
        // A markPoint dataIndex is the marker ordinal, not a trend row index.
        const bucketKey = params.data && params.data.bucketKey;
        if (typeof bucketKey !== "string" || !bucketKey) return;
        row = rows.find((item) => item.key === bucketKey);
      } else if (params.componentType === "series") {
        const index = params.dataIndex;
        if (!Number.isInteger(index) || index < 0 || index >= rows.length) return;
        row = rows[index];
      } else return;
      const key = row && String(row.key || "");
      if (!key || !/^(?:\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2})$/.test(key)) return;
      const start = key.length === 4 ? `${key}-01-01` : key.length === 7 ? `${key}-01` : key;
      const date = new Date(`${start}T00:00:00Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start) return;
      if (key.length === 4) date.setUTCFullYear(date.getUTCFullYear() + 1);
      else if (key.length === 7) date.setUTCMonth(date.getUTCMonth() + 1);
      else date.setUTCDate(date.getUTCDate() + 1);
      let end = date.toISOString().slice(0, 10);
      const range = this.data.range || {};
      if (range.end && start < range.end && end > range.end) end = range.end;
      const query = {
        ledgerId: this.data.ledgerId,
        start,
        end,
        type: chart === "monthTrend" ? "expense" : "all",
        name: `${row.label}明细`,
      };
      const paramsText = Object.keys(query)
        .map((name) => `${name}=${encodeURIComponent(query[name])}`)
        .join("&");
      wx.navigateTo({ url: `/pages/record-filtered/index?${paramsText}` });
    },

    openCategoryRecords(event) {
      const source = event.currentTarget.dataset.source;
      if (
        ["monthRatio", "yearRatio"].includes(this.data.activeChart) &&
        !["year", "custom"].includes(source)
      ) {
        const row = (this.data.activeRanking || [])[Number(event.currentTarget.dataset.index)];
        return this.loadRatioPreview(row && row.key);
      }
      const rows = source === "custom" ? this.data.categories : this.data.activeRanking;
      const item = rows[Number(event.currentTarget.dataset.index)];
      const range = this.data.range || {};
      if (!item || !range.start || !range.end || !this.data.ledgerId) return;
      const filter = item.categoryId
        ? { kind: "id", id: item.categoryId }
        : { kind: "legacy", name: item.categoryName || "", parent: item.parentCategory || "" };
      const query = {
        ledgerId: this.data.ledgerId,
        start: range.start,
        end: range.end,
        type: "expense",
        filter: JSON.stringify(filter),
        name: item.name || "其他",
      };
      wx.navigateTo({
        url: `/pages/record-filtered/index?${Object.keys(query)
          .map((key) => `${key}=${encodeURIComponent(query[key])}`)
          .join("&")}`,
      });
    },

    openRangeCategory(event) {
      const item = this.data.rangeCategories[Number(event.currentTarget.dataset.index)];
      const range = this.data.mode === "all" ? this.data.recordRange : this.data.range;
      if (!item || !range || !range.start || !range.end || !this.data.ledgerId) return;
      const filter = item.categoryId
        ? { kind: "id", id: item.categoryId }
        : { kind: "legacy", name: item.categoryName || "", parent: item.parentCategory || "" };
      const query = {
        ledgerId: this.data.ledgerId,
        start: range.start,
        end: range.end,
        type: this.data.analysisType,
        filter: JSON.stringify(filter),
        name: item.name || "其他",
      };
      wx.navigateTo({
        url: `/pages/record-filtered/index?${Object.keys(query)
          .map((key) => `${key}=${encodeURIComponent(query[key])}`)
          .join("&")}`,
      });
    },

    selectTrendPoint(params = {}) {
      if (params.componentType !== "series" || !Number.isInteger(params.dataIndex)) return;
      const row = (this.data.trendRows || [])[params.dataIndex];
      if (row) this.setData({ selectedTrend: row });
    },

    openTrendRow(event) {
      const index = Number(event.currentTarget.dataset.index);
      this.openTrendRecords({ componentType: "series", dataIndex: index });
    },

    openSelectedTrend() {
      const index = (this.data.trend || []).findIndex(
        (row) => this.data.selectedTrend && row.key === this.data.selectedTrend.key
      );
      if (index >= 0) this.openTrendRecords({ componentType: "series", dataIndex: index });
    },

    retryTrendChart() {
      this._chartInitRetries = {};
      this.setData({ trendChartError: false });
    },

    openTrendRecordsMerged(params = {}) {
      const chart = this.data.activeChart;
      const rows = chart === "yearBalance" ? this.data.recentYearTrend : this.data.trend;
      if (
        !["yearCashflow", "yearBalance", "monthTrend", "trend"].includes(chart) ||
        !Array.isArray(rows) ||
        !params
      )
        return;
      let row;
      if (params.componentType === "markPoint") {
        const bucketKey = params.data && params.data.bucketKey;
        if (typeof bucketKey !== "string" || !bucketKey) return;
        row = rows.find((item) => item.key === bucketKey);
      } else if (params.componentType === "series") {
        const index = params.dataIndex;
        if (!Number.isInteger(index) || index < 0 || index >= rows.length) return;
        row = rows[index];
      } else return;
      const key = row && String(row.key || "");
      if (!key || !/^(?:\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2})$/.test(key)) return;
      const start = key.length === 4 ? `${key}-01-01` : key.length === 7 ? `${key}-01` : key;
      const date = new Date(`${start}T00:00:00Z`);
      if (!Number.isFinite(date.getTime())) return;
      if (key.length === 4) date.setUTCFullYear(date.getUTCFullYear() + 1);
      else if (key.length === 7) date.setUTCMonth(date.getUTCMonth() + 1);
      else date.setUTCDate(date.getUTCDate() + 1);
      let end = date.toISOString().slice(0, 10);
      const range = this.data.mode === "all" ? this.data.recordRange || {} : this.data.range || {};
      if (!range.end) return;
      if (range.end && start < range.end && end > range.end) end = range.end;
      const query = {
        ledgerId: this.data.ledgerId,
        start,
        end,
        type: this.data.activeChart === "monthTrend" ? "expense" : "all",
        name: `${row.label}明细`,
      };
      wx.navigateTo({
        url: `/pages/record-filtered/index?${Object.keys(query)
          .map((name) => `${name}=${encodeURIComponent(query[name])}`)
          .join("&")}`,
      });
    },

    renderChart() {
      // A same-context refresh keeps the host mounted but hidden. Do not
      // initialize, update, or dispose its chart during that loading window.
      if (this.data.loading) return;
      if (!this.data.hasChartData || !this.isAttached || !this.isActiveAndForeground()) {
        this.disposeChart();
        if (!this.data.hasChartData) this.disposeSecondaryCharts();
        return;
      }
      if (this.chartController) {
        this.setupChartVisibilityObserver();
        this.onAnalysisScroll({ detail: { scrollTop: this._scrollTop || 0 } });
        this.chartController.update("main");
        // A preserved ec-canvas can finish its init while the analysis is
        // hidden/loading. Its init event is intentionally rejected by the
        // lifecycle gate, and ec-canvas does not emit that event again when
        // the gate opens. Re-init the still-mounted host explicitly, but only
        // when the controller has no entry (so this cannot create duplicates).
        this.ensureChartHostInitialized("main", "#analysis-chart");
        // Secondary hosts are kept alive by the same-context refresh path too;
        // update every mounted entry, not only the primary chart. Entries whose
        // host is no longer represented by the response must not retain stale
        // data or event handlers.
        const secondaryValidity = {
          dashboardCategory: Boolean(
            this.data.dashboardView && this.data.dashboardView.recordCount
          ),
          category: Array.isArray(this.data.categories) && this.data.categories.length > 0,
        };
        Object.keys(this.secondaryCharts || {}).forEach((key) => {
          if (!secondaryValidity[key]) {
            this.chartController.dispose(key);
            delete this.secondaryCharts[key];
            return;
          }
          this.chartController.update(key);
        });
        Object.keys(secondaryValidity).forEach((key) => {
          if (secondaryValidity[key])
            this.ensureChartHostInitialized(
              key,
              key === "dashboardCategory" ? "#dashboard-category-chart" : "#all-category-chart"
            );
        });
      } else if (this.chart) this.chart.setOption(getChartOption(this.data), true);
      this.remeasureCharts();
    },

    ensureChartHostInitialized(key, componentId) {
      if (key === "dashboardCategory" && !this.data.categoryChartActivated) return false;
      if (!this.canInitializeChartHost() || !this.chartController) return false;
      if (typeof this.chartController.get === "function" && this.chartController.get(key))
        return false;
      const component = this.selectComponent && this.selectComponent(componentId);
      if (!component || typeof component.init !== "function") return false;
      this.scheduleChartInitRetry(key, componentId, true);
      return true;
    },

    remeasureCharts() {
      if (
        !this.isAttached ||
        !this.isActiveAndForeground() ||
        this.data.loading ||
        !this.chartController ||
        typeof this.createSelectorQuery !== "function"
      )
        return;
      if (this._chartMeasurement) return;
      this._chartMeasurement = true;
      const query = this.createSelectorQuery();
      [
        ["main", "#analysis-chart"],
        ["dashboardCategory", "#dashboard-category-chart"],
        ["category", "#all-category-chart"],
      ].forEach(([, selector]) => query.select(selector).boundingClientRect());
      query.exec((rects) => {
        this._chartMeasurement = false;
        if (!this.isAttached || !this.isActiveAndForeground() || this.data.loading) return;
        const keys = ["main", "dashboardCategory", "category"];
        keys.forEach((key, index) => {
          const rect = rects && rects[index];
          if (!rect || !(rect.width > 0) || !(rect.height > 0)) return;
          this.chartController.resize(key, rect.width, rect.height);
        });
      });
    },

    bumpAnalysisNodeGeneration() {
      // Cancel retries owned by the old host generation. Otherwise a stale
      // timer can occupy the per-key slot and suppress the first retry for a
      // newly mounted host.
      Object.values(this._chartInitTimers || {}).forEach((timer) => clearTimeout(timer));
      this._chartInitTimers = {};
      this._chartInitRetries = {};
      if (this._chartObserver && typeof this._chartObserver.disconnect === "function") {
        this._chartObserver.disconnect();
        this._chartObserver = null;
      }
      const generation = (this.analysisNodeGeneration || 0) + 1;
      this.analysisNodeGeneration = generation;
      if (this.isAttached && typeof this.setData === "function") {
        this.setData({ chartNodeGeneration: generation });
      }
      return generation;
    },

    getChartInitMetadata(event) {
      const currentTarget = event && event.currentTarget;
      const dataset = currentTarget && currentTarget.dataset;
      if (!dataset || dataset.chartGeneration === undefined) return null;
      const generation = Number(dataset.chartGeneration);
      if (
        !Number.isInteger(generation) ||
        generation !== this.analysisNodeGeneration ||
        generation !==
          Number(
            this.data.chartHostGeneration && this.data.chartHostGeneration !== 0
              ? this.data.chartHostGeneration
              : this.data.chartNodeGeneration
          )
      )
        return null;
      return { dataset, generation };
    },

    canInitializeChartHost() {
      return Boolean(
        this.isAttached &&
        this.isActiveAndForeground() &&
        !this.data.loading &&
        !this.data.error &&
        !this.data.noLedger &&
        this.data.hasChartData
      );
    },

    onChartInit(event) {
      const detail = (event && event.detail) || {};
      const metadata = this.getChartInitMetadata(event);
      if (
        !metadata ||
        metadata.dataset.chartHost !== "main" ||
        !this.canInitializeChartHost() ||
        !this.chartController
      )
        return;
      const component = this.selectComponent("#analysis-chart");
      if (!component) return;
      const chart = this.chartController.mount("main", {
        canvas: detail.canvas,
        width: Number(detail.width || 0),
        height: Number(detail.height || 0),
        dpr: detail.dpr || detail.canvasDpr,
        component,
        generation: metadata.generation,
      });
      if (!chart) {
        this.scheduleChartInitRetry("main", "#analysis-chart");
        return;
      }
      this.chart = chart;
      if (this._chartInitRetries) this._chartInitRetries.main = 0;
      this.chartController.update("main");
    },

    onSecondaryChartInit(event) {
      const detail = (event && event.detail) || {};
      const metadata = this.getChartInitMetadata(event);
      const key = metadata && metadata.dataset.chartKey;
      if (
        !metadata ||
        !key ||
        !["dashboardCategory", "category"].includes(String(key)) ||
        !this.canInitializeChartHost() ||
        !this.chartController
      )
        return;
      const componentId =
        key === "dashboardCategory" ? "#dashboard-category-chart" : "#all-category-chart";
      const component = this.selectComponent(componentId);
      if (!component) return;
      const chart = this.chartController.mount(key, {
        canvas: detail.canvas,
        width: Number(detail.width || 0),
        height: Number(detail.height || 0),
        dpr: detail.dpr || detail.canvasDpr,
        component,
        generation: metadata.generation,
      });
      if (!chart) {
        this.scheduleChartInitRetry(key, componentId);
        return;
      }
      this.secondaryCharts = this.secondaryCharts || {};
      this.secondaryCharts[key] = chart;
      if (this._chartInitRetries) this._chartInitRetries[key] = 0;
      this.chartController.update(key);
    },

    activateDashboardChart() {
      if (this.data.categoryChartActivated || !this.canInitializeChartHost()) return;
      this.setData({ categoryChartActivated: true }, () => {
        this.ensureChartHostInitialized("dashboardCategory", "#dashboard-category-chart");
      });
    },

    setupChartVisibilityObserver() {
      if (this._chartObserver || !this.createIntersectionObserver) return;
      try {
        const observer = this.createIntersectionObserver({
          thresholds: [0, 0.05, 1],
        });
        this._chartObserver = observer;
        observer.relativeTo(".analysis-scroll").observe("#dashboard-category-chart-wrap", (res) => {
          if (!this.isAttached || this._chartObserver !== observer) return;
          if (res.intersectionRatio > 0) this.activateDashboardChart();
          const isOccluded =
            res.intersectionRatio <= 0 &&
            res.boundingClientRect &&
            res.relativeRect &&
            res.boundingClientRect.top < res.relativeRect.top;
          if (Boolean(this.data.categoryChartHidden) !== Boolean(isOccluded)) {
            this.setData({ categoryChartHidden: Boolean(isOccluded) });
          }
        });
      } catch (_err) {
        this._chartObserver = null;
        // Safe fallback to scroll measurement
      }
    },

    scheduleChartInitRetry(key, componentId, immediate = false) {
      if (!this.canInitializeChartHost()) return;
      this._chartInitRetries = this._chartInitRetries || {};
      this._chartInitTimers = this._chartInitTimers || {};
      if (this._chartInitTimers[key]) return;
      const attempts = this._chartInitRetries[key] || 0;
      if (attempts >= 3) return;
      this._chartInitRetries[key] = attempts + 1;
      const generation = this.analysisNodeGeneration;
      this._chartInitTimers[key] = setTimeout(
        () => {
          delete this._chartInitTimers[key];
          if (!this.canInitializeChartHost() || generation !== this.analysisNodeGeneration) return;
          if (
            this.chartController &&
            typeof this.chartController.get === "function" &&
            this.chartController.get(key)
          ) {
            this._chartInitRetries[key] = 0;
            return;
          }
          const component = this.selectComponent && this.selectComponent(componentId);
          if (component && typeof component.init === "function") component.init();
        },
        immediate ? 0 : 150
      );
    },

    onDashboardChartError() {
      if (this.isAttached && !this.data.loading) this.setData({ dashboardChartError: true });
    },

    disposeSecondaryCharts() {
      Object.keys(this.secondaryCharts || {}).forEach((key) => {
        if (this.chartController) this.chartController.dispose(key);
        else this.secondaryCharts[key].dispose();
      });
      this.secondaryCharts = {};
    },
    onChartInitError() {
      if (!this.canInitializeChartHost()) return;
      console.warn("analysis chart initialization failed");
      this.scheduleChartInitRetry("main", "#analysis-chart");
    },

    onSecondaryChartInitError(event) {
      const metadata = this.getChartInitMetadata(event);
      const key = metadata && metadata.dataset.chartKey;
      if (!metadata || !key || !this.canInitializeChartHost()) return;
      this.scheduleChartInitRetry(
        String(key),
        key === "dashboardCategory" ? "#dashboard-category-chart" : "#all-category-chart"
      );
    },

    disposeChart() {
      if (this.chartController) this.chartController.dispose("main");
      else if (this.chart) this.chart.dispose();
      this.chart = null;
    },

    reload() {
      this.loadAnalysis();
    },
  },
});
