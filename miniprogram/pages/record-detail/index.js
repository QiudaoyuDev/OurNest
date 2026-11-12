const recordService = require("../../services/record.service");
const app = getApp();
const { formatDisplayMoney } = require("../../utils/money");
const { formatDateTime } = require("../../utils/date");
const { getId } = require("../../utils/mapper");
const { resolveAvatarUrls } = require("../../utils/avatar");
const { resolveCategoryScheme } = require("../../utils/category-color");
const ICON_GLYPHS = require("../../components/tl-icon/glyphs");
const CATEGORY_ICONS = require("../../components/tl-icon/category-icons");

function getLedgerTypeText(type) {
  return type === "shared" ? "共享账本" : "个人账本";
}

function getTypeText(type) {
  return type === "income" ? "收入" : "支出";
}

function normalizeRecord(record = {}, ledger = {}) {
  const type = record.type === "income" ? "income" : "expense";
  const selectedTimeText = formatDateTime(record.date, record.time);
  const tags = Array.isArray(record.tags) ? record.tags : [];
  const categoryText = record.categoryName || record.categoryLabel || "其他";
  const icon = record.categoryIcon;
  const categoryIcon =
    typeof icon === "string" &&
    (Object.prototype.hasOwnProperty.call(ICON_GLYPHS, icon) ||
      Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, icon))
      ? icon
      : type === "income"
        ? "funds-line"
        : "price-tag-3-line";
  const categoryScheme = resolveCategoryScheme(categoryText, type, categoryIcon);
  return {
    ...record,
    id: getId(record),
    type,
    typeText: getTypeText(type),
    typeIcon: type === "income" ? "funds-line" : "price-tag-3-line",
    typeIconColor: type === "income" ? "#25a66a" : "#f0442f",
    amountText: formatDisplayMoney(record.amount),
    sign: type === "income" ? "+" : "-",
    categoryText,
    categoryDisplayIcon: categoryIcon,
    categoryIconColor: categoryScheme.iconColor,
    categoryChipClass: categoryScheme.chipClass,
    parentCategoryText:
      record.parentCategory &&
      record.parentCategory !== (record.categoryName || record.categoryLabel)
        ? record.parentCategory
        : "",
    selectedTimeText,
    ledgerName: ledger.name || "我的账本",
    ledgerTypeText: getLedgerTypeText(ledger.type),
    incomeRecipientText: record.incomeOwnerOpenid ? record.incomeOwnerName || "历史成员" : "未指定",
    memberName: record.memberName || "我",
    memberAvatar: record.memberAvatar || "/images/brand/our-nest-logo-256-transparent.png",
    accountText: record.account || "未选择账户",
    sourceText:
      record.source === "wechat"
        ? "微信支付"
        : record.source === "alipay"
          ? "支付宝"
          : record.importBatchId
            ? "模板导入"
            : "",
    sourceTransactionId: record.sourceTransactionId || "",
    importBatchId: record.importBatchId || "",
    noteText: record.note || "未填写备注",
    tags,
    hasTags: tags.length > 0,
  };
}

Page({
  data: {
    loading: true,
    isError: false,
    recordId: "",
    record: null,
    readonly: false,
  },

  onLoad(options = {}) {
    const recordId = options.id ? decodeURIComponent(options.id) : "";
    this.setData({ recordId });
    this.loadRecord(recordId);
  },

  async loadRecord(recordId) {
    if (!recordId) {
      this.setData({ loading: false, isError: true });
      return;
    }

    this.setData({ loading: true, isError: false });
    try {
      const data = await recordService.getRecord(recordId);
      const record = data.record;
      const ledgerInfo = data.ledger || app.globalData.currentLedger || {};
      if (!record) throw new Error("记录加载失败");

      const [resolved] = await resolveAvatarUrls([record], "memberAvatar");
      this.setData({
        loading: false,
        readonly: Boolean(data.readonly),
        record: normalizeRecord(resolved, ledgerInfo),
      });
    } catch (error) {
      console.warn("load record detail failed", error);
      this.setData({ loading: false, isError: true });
    }
  },

  reload() {
    this.loadRecord(this.data.recordId);
  },
});
