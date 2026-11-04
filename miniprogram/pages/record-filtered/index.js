const recordService = require("../../services/record.service");
const { formatDisplayMoney } = require("../../utils/money");

function decode(value) {
  try {
    return decodeURIComponent(value || "");
  } catch (_error) {
    return value || "";
  }
}

Page({
  data: {
    title: "分类明细",
    rangeLabel: "",
    records: [],
    loading: true,
    loadingMore: false,
    error: false,
    hasMore: false,
    nextCursor: null,
    incomeText: "0",
    expenseText: "0",
    count: 0,
    readonly: true,
  },
  onLoad(options = {}) {
    try {
      const filter = options.filter ? JSON.parse(decode(options.filter)) : null;
      const familyFilter = options.family ? JSON.parse(decode(options.family)) : null;
      if (
        !options.ledgerId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(options.start || "") ||
        !/^\d{4}-\d{2}-\d{2}$/.test(options.end || "") ||
        !["all", "income", "expense"].includes(options.type) ||
        (filter && (!["id", "legacy"].includes(filter.kind) || options.type === "all")) ||
        (familyFilter &&
          (!["payer", "consumer", "creator"].includes(familyFilter.dimension) ||
            options.type !== "expense"))
      ) {
        throw new Error("INVALID_FILTER");
      }
      this.query = {
        ledgerId: options.ledgerId,
        start: options.start,
        end: options.end,
        type: options.type,
        summaryFiltered: true,
        ...(filter ? { categoryFilter: filter } : {}),
        ...(familyFilter ? { familyFilter } : {}),
      };
      this.requestId = 0;
      this.setData({
        title: decode(options.name || "分类明细"),
        rangeLabel: `${options.start} 起至 ${options.end} 前`,
      });
      this.loadRecords();
    } catch (_error) {
      this.setData({ loading: false, error: true });
    }
  },
  onUnload() {
    this.requestId += 1;
  },
  async loadRecords(append = false) {
    if (
      !this.query ||
      (append && (this.data.loading || this.data.loadingMore || !this.data.hasMore))
    )
      return;
    const requestId = ++this.requestId;
    this.setData(append ? { loadingMore: true } : { loading: true, error: false });
    try {
      const result = await recordService.listRecords({
        ...this.query,
        cursor: append ? this.data.nextCursor : null,
        pageSize: 30,
      });
      if (requestId !== this.requestId) return;
      const rows = (result.records || []).map((record) => ({
        ...record,
        id: record._id || record.id,
        amountText: formatDisplayMoney(record.amount),
      }));
      this.setData({
        records: append ? [...this.data.records, ...rows] : rows,
        loading: false,
        loadingMore: false,
        error: false,
        readonly: Boolean(result.readonly),
        hasMore: Boolean(result.hasMore),
        nextCursor: result.nextCursor || null,
        incomeText: formatDisplayMoney((result.rangeSummary || {}).income),
        expenseText: formatDisplayMoney((result.rangeSummary || {}).expense),
        count: Number(result.rangeRecordCount || 0),
      });
    } catch (_error) {
      if (requestId !== this.requestId) return;
      this.setData({ loading: false, loadingMore: false, error: true });
    }
  },
  loadMore() {
    return this.loadRecords(true);
  },
  reload() {
    return this.loadRecords(false);
  },
  openRecord(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    const page = this.data.readonly ? "record-detail" : "record-edit";
    wx.navigateTo({ url: `/pages/${page}/index?id=${encodeURIComponent(id)}` });
  },
});
