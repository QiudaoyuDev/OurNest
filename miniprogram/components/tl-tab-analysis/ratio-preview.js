const { formatDisplayMoney } = require("../../utils/money");

function initialRatioPreview() {
  return {
    ratioSelection: null,
    ratioPreviewStatus: "idle",
    ratioPreviewRecords: [],
    ratioPreviewAmountText: "",
    ratioPreviewCount: 0,
    ratioPreviewRangeLabel: "",
    ratioPreviewStale: false,
    ratioPreviewError: "",
    ratioPreviewReadonly: true,
    ratioRemainderVisible: false,
    ratioRemainderOptions: [],
  };
}

function categoryFilterForKey(key) {
  try {
    const parts = JSON.parse(key);
    if (parts[0] === "id" && parts.length === 2 && typeof parts[1] === "string" && parts[1]) {
      return { kind: "id", id: parts[1] };
    }
    if (
      parts[0] === "legacy" &&
      parts.length === 3 &&
      typeof parts[1] === "string" &&
      typeof parts[2] === "string"
    ) {
      return { kind: "legacy", parent: parts[1], name: parts[2] };
    }
  } catch (_error) {
    // Only server-issued category identities can become a query.
  }
  return null;
}

function ratioContext(page) {
  const data = page.data;
  return JSON.stringify([
    page.analysisRequestId,
    data.ledgerId,
    data.mode,
    data.activeChart,
    data.anchor,
    data.customStart,
    data.customEnd,
    data.range && data.range.start,
    data.range && data.range.end,
  ]);
}

function canPreview(page) {
  const data = page.data;
  const range = data.range || {};
  return (
    page.isAttached &&
    !data.loading &&
    !data.error &&
    !data.noLedger &&
    !!data.ledgerId &&
    ((data.mode === "month" && data.activeChart === "monthRatio") ||
      (data.mode === "year" && data.activeChart === "yearRatio")) &&
    /^\d{4}-\d{2}-\d{2}$/.test(range.start || "") &&
    /^\d{4}-\d{2}-\d{2}$/.test(range.end || "") &&
    range.start < range.end
  );
}

function eventKey(event, rows) {
  const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
  if (typeof dataset.key === "string") return dataset.key;
  const index = dataset.index;
  if (typeof index !== "number" && typeof index !== "string") return null;
  if (typeof index === "string" && !/^\d+$/.test(index)) return null;
  const ordinal = Number(index);
  return Number.isInteger(ordinal) && ordinal >= 0 && rows[ordinal] ? rows[ordinal].key : null;
}

function createRatioMethods(recordService, navigateTo) {
  return {
    clearRatioPreview() {
      this.ratioRequestId = (this.ratioRequestId || 0) + 1;
      this._ratioContext = null;
      this._ratioQuery = null;
      this.syncRatioChartSelection(null);
      this.setData(initialRatioPreview());
    },

    syncRatioChartSelection(key) {
      if (!this.chart || typeof this.chart.dispatchAction !== "function") return;
      if (!["monthRatio", "yearRatio"].includes(this.data.activeChart)) return;
      this.chart.dispatchAction({ type: "unselect", seriesIndex: 0 });
      const slices = this.data.categoryChart || [];
      let index = slices.findIndex((row) => row.key && row.key === key);
      if (
        index < 0 &&
        (key === "ratio-remainder" || (this.data.categories || []).some((row) => row.key === key))
      ) {
        index = slices.findIndex((row) => !row.key);
      }
      if (index >= 0)
        this.chart.dispatchAction({ type: "select", seriesIndex: 0, dataIndex: index });
    },

    openRatioChartSelection(params = {}) {
      if (
        !params ||
        !canPreview(this) ||
        params.componentType !== "series" ||
        params.seriesType !== "pie"
      )
        return;
      const item = params.data || {};
      if (item.ratioKey) {
        if (!(this.data.categoryChart || []).some((row) => row.key === item.ratioKey)) return;
        return this.loadRatioPreview(item.ratioKey);
      }
      if (!item.ratioRemainder || !(this.data.categoryChart || []).some((row) => !row.key)) return;
      const shownKeys = new Set(
        (this.data.categoryChart || []).filter((row) => row.key).map((row) => row.key)
      );
      const options = (this.data.categories || []).filter(
        (row) => !shownKeys.has(row.key) && categoryFilterForKey(row.key)
      );
      this.clearRatioPreview();
      this.setData({
        ratioRemainderVisible: true,
        ratioRemainderOptions: options.map((row) => ({
          ...row,
          amountText: formatDisplayMoney(row.amount),
        })),
      });
      this.syncRatioChartSelection("ratio-remainder");
    },

    selectRatioCategory(event) {
      return this.loadRatioPreview(eventKey(event, this.data.categories || []));
    },

    chooseRatioRemainder(event) {
      if (!this.data.ratioRemainderVisible) return;
      const key = eventKey(event, this.data.ratioRemainderOptions || []);
      if (!(this.data.ratioRemainderOptions || []).some((row) => row.key === key)) return;
      return this.loadRatioPreview(key);
    },

    closeRatioRemainder() {
      this.setData({ ratioRemainderVisible: false });
    },

    async loadRatioPreview(key) {
      if (!canPreview(this)) return;
      const row = (this.data.categories || []).find((item) => item.key === key);
      const categoryFilter = categoryFilterForKey(key);
      if (!row || !categoryFilter || !Number.isFinite(Number(row.amount))) return;
      const context = ratioContext(this);
      const requestId = (this.ratioRequestId || 0) + 1;
      this.ratioRequestId = requestId;
      this._ratioContext = context;
      const query = {
        ledgerId: this.data.ledgerId,
        start: this.data.range.start,
        end: this.data.range.end,
        type: "expense",
        categoryFilter,
        summaryFiltered: true,
      };
      this._ratioQuery = query;
      const selection = {
        key,
        name: row.name || row.categoryName || "其他",
        parentCategory: row.parentCategory || "",
        amount: Number(row.amount),
        categoryFilter,
      };
      this.setData({
        ...initialRatioPreview(),
        ratioSelection: selection,
        ratioPreviewStatus: "loading",
        ratioPreviewRangeLabel: `${query.start} 起至 ${query.end} 前`,
      });
      this.syncRatioChartSelection(key);
      const isCurrent = () =>
        canPreview(this) &&
        requestId === this.ratioRequestId &&
        context === ratioContext(this) &&
        this._ratioContext === context;
      try {
        const result = await recordService.listRecords({ ...query, pageSize: 3, cursor: null });
        if (!isCurrent()) return;
        const expense = result.rangeSummary && result.rangeSummary.expense;
        const count = result.rangeRecordCount;
        if (
          !Number.isFinite(expense) ||
          !Number.isInteger(count) ||
          count < 0 ||
          Math.round(expense * 100) !== Math.round(selection.amount * 100)
        ) {
          this.setData({
            ratioPreviewStatus: "error",
            ratioPreviewStale: true,
            ratioPreviewError: "数据已变化，请刷新分析后重试",
          });
          return;
        }
        const records = (result.records || []).slice(0, 3).map((record) => ({
          ...record,
          id: record._id || record.id,
          amountText: formatDisplayMoney(record.amount),
        }));
        this.setData({
          ratioPreviewStatus: count === 0 ? "empty" : "ready",
          ratioPreviewRecords: records,
          ratioPreviewAmountText: formatDisplayMoney(expense),
          ratioPreviewCount: count,
        });
      } catch (_error) {
        if (!isCurrent()) return;
        this.setData({ ratioPreviewStatus: "error", ratioPreviewError: "明细加载失败，请重试" });
      }
    },

    retryRatioPreview() {
      if (
        this.data.ratioPreviewStatus !== "error" ||
        this.data.ratioPreviewStale ||
        this._ratioContext !== ratioContext(this)
      )
        return;
      return this.loadRatioPreview(this.data.ratioSelection && this.data.ratioSelection.key);
    },

    refreshRatioAnalysis() {
      if (!this.isAttached || this.data.loading) return;
      return this.loadAnalysis();
    },

    openRatioRecords() {
      if (
        !canPreview(this) ||
        !["ready", "empty"].includes(this.data.ratioPreviewStatus) ||
        this.data.ratioPreviewStale ||
        this._ratioContext !== ratioContext(this) ||
        !this._ratioQuery
      )
        return;
      const query = {
        ledgerId: this._ratioQuery.ledgerId,
        start: this._ratioQuery.start,
        end: this._ratioQuery.end,
        type: this._ratioQuery.type,
        filter: JSON.stringify(this._ratioQuery.categoryFilter),
        name: this.data.ratioSelection.name,
      };
      const params = Object.keys(query)
        .map((key) => `${key}=${encodeURIComponent(query[key])}`)
        .join("&");
      navigateTo({ url: `/pages/record-filtered/index?${params}` });
    },
  };
}

module.exports = { initialRatioPreview, createRatioMethods };
