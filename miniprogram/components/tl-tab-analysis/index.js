import * as echarts from "../ec-canvas/echarts";
const app = getApp();
const recordService = require("../../services/record.service");
const { initialRatioPreview, createRatioMethods } = require("./ratio-preview");
const ledgerService = require("../../services/ledger.service");
const ledgerStore = require("../../services/ledger.store");
const feedback = require("../../services/feedback-ui");
const dataRefresh = require("../../services/data-refresh.service");
const { formatDisplayMoney, formatMoney } = require("../../utils/money");
const { makeDashboardView, dayAdd } = require("./dashboard");
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
      this.analysisRequestId = 0;
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
      this.categoryRequestId += 1;
      this.dayRequestId += 1;
      this._sectionRequestId = (this._sectionRequestId || 0) + 1;
      this.disposeChart();
      this.disposeSecondaryCharts();
    },
  },

  methods: {
    ...createRatioMethods(recordService, (options) => wx.navigateTo(options)),
    isActiveAndForeground() {
      return this.data.active !== false && this.data.foreground !== false;
    },

    updateAvailability() {
      if (!this.isAttached) return;
      if (!this.isActiveAndForeground()) {
        this.dirty = true;
        this.analysisRequestId = (this.analysisRequestId || 0) + 1;
        return;
      }
      if (!this.isBootstrapped) {
        this.isBootstrapped = true;
        this.bootstrap();
      } else if (this.dirty) this.loadAnalysis();
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
      this.clearRatioPreview();
      if (this.isActiveAndForeground())
        this.refreshAnalysis({ removedLedgerIds, changedLedgerIds: ledgerIds });
    },
    changeAnalysisType(event) {
      const type = event.currentTarget.dataset.type;
      if (!["income", "expense"].includes(type) || type === this.data.analysisType) return;
      this.setData({ analysisType: type, showAllCategories: false, compareCategories: false });
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
      query.exec((rects) => {
        this._sectionMeasurement = false;
        if (!this.isAttached || !rects || !rects[0]) return;
        let active = "summary";
        ["summary", "category", "account", "family"].forEach((section, index) => {
          const rect = rects[index + 1];
          if (rect && rect.top <= rects[0].bottom + 8) active = section;
        });
        if (active !== this.data.activeSection) this.setData({ activeSection: active });
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
          this.setData({
            ledgerId: "",
            ledgerName: "分析账本",
            loading: false,
            noLedger: true,
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

    async loadAnalysis() {
      if (!this.isActiveAndForeground()) {
        this.dirty = true;
        return;
      }
      this.clearRatioPreview();
      if (!this.data.ledgerId) {
        this.dirty = false;
        return this.setData({ loading: false, noLedger: true });
      }
      this._sectionRequestId = (this._sectionRequestId || 0) + 1;
      this._chartRetryCount = 0;
      const requestId = ++this.analysisRequestId;
      this.categoryRequestId = (this.categoryRequestId || 0) + 1;
      this.dayRequestId = (this.dayRequestId || 0) + 1;
      const request = {
        ledgerId: this.data.ledgerId,
        mode: this.data.mode,
        anchor: this.data.anchor,
        customStart: this.data.customStart,
        customEnd: this.data.customEnd,
        analysisType: this.data.analysisType,
        analysisView: ["week", "month", "year"].includes(this.data.mode),
      };
      this.disposeChart();
      this.disposeSecondaryCharts();
      this.setData({
        loading: true,
        error: false,
        noLedger: false,
        hasChartData: false,
        selectedCategory: null,
        categoryPreviewStatus: "idle",
        selectedDay: "",
        dayStatus: "idle",
        selectedBar: null,
        scrollTarget: "",
        scrollTop: 0,
        sectionEndSpace: 0,
        dashboardChartError: false,
        activeSection: "summary",
      });
      try {
        const result = decorate(await ledgerService.getAnalysis(request));
        if (!this.isAttached || requestId !== this.analysisRequestId) return;
        if (result.noLedger || !result.ledger) {
          this.setData({ loading: false, noLedger: true });
          return;
        }
        if (request.analysisView && !result.dashboard) throw new Error("ANALYSIS_API_OUTDATED");
        const chartType =
          this.data.activeChart === "member" && result.ledger.type !== "shared"
            ? "trend"
            : this.data.activeChart;
        const meta = CHART_META[chartType];
        const activeDetailRows = getDetailRows(result, chartType);
        const nextData = {
          ...result,
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
          hasChartData: hasChartData(result, chartType),
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
          hasDetailRows: activeDetailRows.length > 0,
          hasInsights:
            Object.values(result.insightGroups || {}).some((items) => items.length) ||
            result.insights.length > 0,
          monthlyTopRecords: decorateTopExpenseRecords(result.topExpenseRecords || []),
          yearRankingRows:
            this.data.yearRankingType === "income" ? result.incomeCategories : result.categories,
        };
        this.dirty = false;
        this.setData(nextData, () => this.renderChart());
      } catch (error) {
        if (!this.isAttached || requestId !== this.analysisRequestId) return;
        console.warn("analysis load failed", error);
        this.setData({ loading: false, error: true });
      }
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

    renderChart() {
      if (!this.data.hasChartData || !this.isAttached || !this.isActiveAndForeground()) {
        this.disposeChart();
        return;
      }
      if (this.chart) {
        this.chart.setOption(getChartOption(this.data), true);
      }
    },

    onChartInit(event) {
      const detail = event.detail || {};
      const canvas = detail.canvas;
      const width = Number(detail.width || 0);
      const height = Number(detail.height || 0);
      if (
        !this.isAttached ||
        !this.isActiveAndForeground() ||
        this.data.loading ||
        !this.data.hasChartData ||
        !canvas ||
        !width ||
        !height
      )
        return;
      this.disposeChart();
      const chart = echarts.init(canvas, null, {
        width,
        height,
        devicePixelRatio: Math.min(Number(detail.dpr || detail.canvasDpr || 1), 2),
      });
      canvas.setChart(chart);
      chart.setOption(getChartOption(this.data), true);
      chart.on("click", (params) => {
        if (["monthRatio", "yearRatio"].includes(this.data.activeChart)) {
          this.openRatioChartSelection(params);
        } else this.openTrendRecords(params);
      });
      this.chart = chart;
      const component = this.selectComponent("#analysis-chart");
      if (component && typeof component.setChart === "function") component.setChart(chart);
    },

    onSecondaryChartInit(event) {
      const detail = event.detail || {};
      const key = event.currentTarget.dataset.chartKey;
      const canvas = detail.canvas;
      const width = Number(detail.width || 0);
      const height = Number(detail.height || 0);
      if (
        !this.isAttached ||
        !this.isActiveAndForeground() ||
        this.data.loading ||
        !key ||
        !canvas ||
        !width ||
        !height
      )
        return;
      this.secondaryCharts = this.secondaryCharts || {};
      if (this.secondaryCharts[key]) this.secondaryCharts[key].dispose();
      const chart = echarts.init(canvas, null, {
        width,
        height,
        devicePixelRatio: Math.min(Number(detail.dpr || detail.canvasDpr || 1), 2),
      });
      canvas.setChart(chart);
      if (key === "dashboardCategory") {
        const rows = (this.data.dashboardView.categories || []).filter((item) => item.amount > 0);
        const visible = rows.slice(0, 5);
        const remainder = rows
          .slice(5)
          .reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
        const chartRows = remainder
          ? [...visible, { name: "其余分类", amount: remainder / 100 }]
          : visible;
        chart.setOption(
          getChartOption({ ...this.data, categoryChart: chartRows }, "category"),
          true
        );
        chart.on("click", (params) => {
          if (params.dataIndex >= visible.length) return this.setData({ showAllCategories: true });
          const index = (this.data.dashboardView.categories || []).findIndex(
            (item) => item.key === visible[params.dataIndex].key
          );
          if (index >= 0) this.selectDashboardCategory({ currentTarget: { dataset: { index } } });
        });
      } else chart.setOption(getChartOption(this.data, key), true);
      this.secondaryCharts[key] = chart;
    },

    onDashboardChartError() {
      if (this.isAttached && !this.data.loading) this.setData({ dashboardChartError: true });
    },

    disposeSecondaryCharts() {
      Object.values(this.secondaryCharts || {}).forEach((chart) => chart.dispose());
      this.secondaryCharts = {};
    },
    onChartInitError() {
      if (!this.isAttached || !this.isActiveAndForeground() || this.data.loading) return;
      console.warn("analysis chart initialization failed");
      this._chartRetryCount = (this._chartRetryCount || 0) + 1;
      if (this._chartRetryCount <= 1) {
        setTimeout(() => {
          if (!this.isAttached || !this.isActiveAndForeground() || this.data.loading) return;
          const component = this.selectComponent("#analysis-chart");
          if (component && typeof component.init === "function") {
            component.init();
          }
        }, 150);
      } else {
        this._chartRetryCount = 0;
      }
    },

    disposeChart() {
      if (this.chart) this.chart.dispose();
      this.chart = null;
      if (this.isAttached) {
        const component = this.selectComponent("#analysis-chart");
        if (component && typeof component.setChart === "function") component.setChart(null);
      }
    },

    reload() {
      this.loadAnalysis();
    },
  },
});
