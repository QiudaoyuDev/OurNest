const feedback = require("../../services/feedback-ui");
const app = getApp();
const recordService = require("../../services/record.service");
const categoryService = require("../../services/category.service");
const categoryStore = require("../../services/category.store");
const { getId } = require("../../utils/mapper");
const ledgerService = require("../../services/ledger.service");
const { getPaymentAccounts } = require("../../services/payment-account.service");
const { markNavigation } = require("../../utils/navigation-timing");
const {
  evaluateAmountExpression,
  getAmountValidationMessage,
} = require("../../utils/amount-expression");

const ledgerMembersMemoryCache = {};

function today() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatRecordTimestamp(value) {
  if (!value) return "";
  const date =
    value instanceof Date ? value : new Date(value.$date || (value.seconds || 0) * 1000 || value);
  if (Number.isNaN(date.getTime())) return "";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day} ${hours}:${minutes}`;
}

const TRAIN_QUICK_AMOUNTS = [373.5, 356.5, 265, 432.5];
const DEFAULT_QUICK_AMOUNTS = [9.9, 20, 100, 200, 500];
const OTHER_INCOME_ICONS = { 红包: "red-packet-line", 退款: "refund-line", 礼金: "gift-line" };

function categoryDisplayIcon(child, parent) {
  if (
    child.type === "income" &&
    child.source === "system" &&
    parent.name === "其他" &&
    child.icon === "more-2-line" &&
    OTHER_INCOME_ICONS[child.name]
  )
    return OTHER_INCOME_ICONS[child.name];
  return child.icon || parent.icon || "price-tag-3-line";
}

function resolveQuickAmounts(ledger, systemKey) {
  if (!ledger || !ledger.quickAmountsEnabled) return [];
  if (systemKey === "high_speed_rail") {
    return TRAIN_QUICK_AMOUNTS;
  }
  if (
    ledger &&
    ledger.quickAmountsEnabled &&
    Array.isArray(ledger.quickAmounts) &&
    ledger.quickAmounts.length
  ) {
    return ledger.quickAmounts;
  }
  return DEFAULT_QUICK_AMOUNTS;
}

function quickNotesFor(type, category) {
  if (type === "income") return [category, "工资", "奖金", "报销", "红包"].filter(Boolean);
  return [category, "早餐", "午餐", "晚餐", "通勤", "买菜"].filter(Boolean);
}

function normalizeTags(input) {
  return String(input || "")
    .split(/[\s,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

Page({
  data: {
    recordLoading: false,
    recordLoadError: false,
    readonly: false,
    recordId: "",
    isEditing: false,
    type: "expense",
    typeLabel: "支出",
    typeIcon: "price-tag-3-line",
    categoryId: "",
    categoryName: "",
    categoryLabel: "请选择分类",
    categoryHeading: "",
    categoryIcon: "price-tag-3-line",
    parentCategory: "",
    parentIcon: "book-2-line",
    groups: [],
    flatCategories: [],
    expandedGroupId: "",
    categoryLoading: true,
    categoryError: false,
    amount: "",
    amountResult: "",
    showAmountResult: false,
    canSave: false,
    saving: false,
    deleting: false,
    keypadOpen: false,
    noteFocused: false,
    note: "",
    tagInput: "",
    tags: [],
    date: today(),

    ledgerName: "我家账本",
    ledgerId: "",
    accountIndex: 0,
    accounts: getPaymentAccounts(),
    quickAmounts: [],
    quickNotes: quickNotesFor("expense", ""),
    sourceText: "",
    sourceTransactionId: "",
    importBatchId: "",
    createdDate: "",
    updatedDate: "",
    syncVersion: 0,
    familyEnabled: false,
    familyLoading: false,
    familyError: false,
    familyMembers: [],
    familyConsumers: [],
    familyPayerIndex: 0,
    familyConsumerIndex: 0,
    familyKindIndex: 0,
    familyKinds: [
      { value: "unknown", label: "其他" },
      { value: "personal", label: "个人消费" },
      { value: "public", label: "公共消费（按记录人展示）" },
      { value: "multiple", label: "多人消费（按记录人展示）" },
    ],
  },

  onLoad(options = {}) {
    markNavigation("编辑页", "onLoad");
    const type = options.type === "income" ? "income" : "expense";
    // 新增不从缺省名称或路由元数据推断分类，必须由用户明确选择。
    const currentLedger = app.globalData.currentLedger || {};
    const ledgerId = options.ledgerId || currentLedger._id || "";
    const targetLedger =
      ledgerId === currentLedger._id
        ? currentLedger
        : (app.globalData.ledgers || []).find((ledger) => (ledger._id || ledger.id) === ledgerId) ||
          {};
    if (!options.id && (targetLedger.readonly || targetLedger.role === "readonly")) {
      this.setData({ readonly: true });
      feedback.showReadonlyToast();
      if (getCurrentPages().length > 1) wx.navigateBack();
      else wx.reLaunch({ url: "/pages/index/index" });
      return;
    }
    const isShared = targetLedger.type === "shared";
    const needFamily = !options.id && isShared && Boolean(ledgerId);
    const hasFamilyCache = needFamily && Boolean(ledgerMembersMemoryCache[ledgerId]);
    const cachedCategories =
      !options.id && ledgerId && typeof categoryStore.getCategoriesSync === "function"
        ? categoryStore.getCategoriesSync(ledgerId)
        : [];
    const hasCachedCategories = Array.isArray(cachedCategories) && cachedCategories.length > 0;
    const date = options.id ? this.data.date : today();
    this._currentLedger = targetLedger;
    this.setData({
      type,
      familyEnabled: needFamily,
      familyLoading: needFamily && !hasFamilyCache,
      typeLabel: type === "income" ? "收入" : "支出",
      typeIcon: type === "income" ? "funds-line" : "price-tag-3-line",
      ledgerName: targetLedger.name || "我家账本",
      ledgerId: options.ledgerId || currentLedger._id || "",
      accounts: getPaymentAccounts(targetLedger),
      quickAmounts: resolveQuickAmounts(targetLedger, "", ""),
      quickNotes: quickNotesFor(type, ""),
      date,
    });
    if (hasCachedCategories) {
      this.renderCategories(cachedCategories);
    }
    if (options.id) {
      this.setData({ recordId: decodeURIComponent(options.id), isEditing: true });
      this.loadRecord(this.data.recordId);
    } else if (needFamily) {
      this.loadFamilyContext(ledgerId);
    }
  },

  onShow() {
    if (this.data.isEditing || this.data.readonly) return;
    this.stopCategorySync();
    this._categoryUnsubscribe = categoryStore.subscribeSync((result) => {
      if (result.ledgerId !== this.data.ledgerId) return;
      if (result.invalidated) this.loadCategories();
      else this.renderCategories(result.items);
    });
    return this.loadCategories();
  },

  onHide() {
    this.stopCategorySync();
  },

  onUnload() {
    this.stopCategorySync();
  },

  stopCategorySync() {
    this._categoryRequest = (this._categoryRequest || 0) + 1;
    if (this._categoryUnsubscribe) this._categoryUnsubscribe();
    this._categoryUnsubscribe = null;
  },

  renderCategories(items = []) {
    this._categories = items;
    const flat = items.filter(
      (item) => item.type === this.data.type && !item.level && !item.parentId
    );
    if (flat.length) {
      const selected = flat.find((item) => getId(item) === this.data.categoryId);
      if (this.data.categoryId && !selected) this.clearCategorySelection();
      if (selected)
        this.applyCategorySelection({
          type: this.data.type,
          categoryId: getId(selected),
          categoryName: selected.name,
          categoryLabel: selected.name,
          categoryIcon: selected.icon || "price-tag-3-line",
          systemKey: selected.systemKey || "",
          parentCategory: "",
          parentIcon: "",
        });
      this.setData({
        groups: [],
        flatCategories: flat.map((item) => ({
          id: getId(item),
          name: item.name,
          icon: item.icon || "price-tag-3-line",
          parentHint: "",
        })),
        expandedGroupId: "",
        categoryLoading: false,
        categoryError: false,
      });
      return;
    }
    const parents = items.filter((item) => item.type === this.data.type && item.level === "parent");
    const groups = parents.map((parent) => ({
      ...parent,
      id: getId(parent),
      children: items.filter(
        (item) =>
          item.type === this.data.type && item.level === "child" && item.parentId === getId(parent)
      ),
    }));
    const selected = groups
      .flatMap((group) => group.children)
      .find((item) => getId(item) === this.data.categoryId);
    if (this.data.categoryId && !selected) this.clearCategorySelection();
    if (selected) {
      const parent = parents.find((item) => getId(item) === selected.parentId);
      this.applyCategorySelection({
        type: this.data.type,
        categoryId: getId(selected),
        categoryName: selected.name,
        categoryLabel: selected.name,
        categoryIcon: categoryDisplayIcon(selected, parent),
        parentCategory: parent.name,
        parentIcon: parent.icon,
      });
    }
    const children = groups.flatMap((group) =>
      group.children.map((child) => ({
        id: getId(child),
        name: child.name,
        icon: categoryDisplayIcon(child, group),
        parentName: group.name,
      }))
    );
    const counts = children.reduce((result, child) => {
      result[child.name] = (result[child.name] || 0) + 1;
      return result;
    }, Object.create(null));
    const flatCategories = children.map((child) => ({
      ...child,
      parentHint: counts[child.name] > 1 ? child.parentName : "",
    }));
    this.setData({
      groups,
      flatCategories,
      expandedGroupId: groups.some((group) => group.id === this.data.expandedGroupId)
        ? this.data.expandedGroupId
        : (groups[0] || {}).id || "",
      categoryLoading: false,
      categoryError: false,
    });
  },

  async loadCategories() {
    const request = (this._categoryRequest || 0) + 1;
    this._categoryRequest = request;
    const hasExisting = Array.isArray(this._categories) && this._categories.length > 0;
    if (!hasExisting) {
      this.setData({ categoryLoading: true, categoryError: false });
    }
    try {
      const items = await categoryService.listCategories(this.data.ledgerId);
      if (request === this._categoryRequest) this.renderCategories(items);
    } catch (_error) {
      if (request === this._categoryRequest)
        this.setData({ categoryLoading: false, categoryError: true });
    }
  },

  clearCategorySelection() {
    this.setData({
      categoryId: "",
      categoryName: "",
      categoryLabel: "请选择分类",
      categoryHeading: "",
      categoryIcon: "price-tag-3-line",
      parentCategory: "",
      parentIcon: "",
      quickAmounts: resolveQuickAmounts(this._currentLedger, "", ""),
      quickNotes: quickNotesFor(this.data.type, ""),
      canSave: false,
    });
  },

  switchType(event) {
    const type = event.currentTarget.dataset.type;
    if (this.data.isEditing || this.data.readonly || this.data.saving || type === this.data.type)
      return;
    this.setData({ type, typeLabel: type === "income" ? "收入" : "支出" });
    this.clearCategorySelection();
    const { categoryLoading, categoryError } = this.data;
    this.renderCategories(this._categories || []);
    this.setData({ categoryLoading, categoryError });
  },

  toggleGroup(event) {
    const id = event.detail.id;
    this.setData({ expandedGroupId: this.data.expandedGroupId === id ? "" : id });
  },

  chooseCategory(event) {
    if (this.data.readonly || this.data.saving) return;
    const categoryId = event.detail.categoryId || event.currentTarget.dataset.categoryId;
    const child = (this._categories || []).find(
      (item) =>
        getId(item) === categoryId &&
        item.type === this.data.type &&
        (item.level === "child" || (!item.level && !item.parentId))
    );
    if (!child) return;
    this.setData({ categoryId });
    this.renderCategories(this._categories);
  },

  handleEntryBack() {
    if (this.data.saving) return;
    const leave = () => {
      if (getCurrentPages().length > 1) wx.navigateBack();
      else wx.redirectTo({ url: "/pages/index/index" });
    };
    if (!this.data.amount && !this.data.note && !this.data.tagInput && !this.data.tags.length) {
      leave();
      return;
    }
    wx.showModal({
      title: "放弃本次记账？",
      content: "当前输入尚未保存，返回后将丢失。",
      confirmText: "放弃",
      success: (result) => {
        if (result.confirm) leave();
      },
    });
  },

  onNoteFocus() {
    this.setData({ noteFocused: true });
  },
  onNoteBlur() {
    this.setData({ noteFocused: false });
  },

  onReady() {
    markNavigation("编辑页", "onReady");
  },

  async loadRecord(recordId) {
    this.setData({ recordLoading: true, recordLoadError: false });
    try {
      const data = await recordService.getRecord(recordId);
      const record = data.record;
      const ledgerInfo = data.ledger || app.globalData.currentLedger || {};
      if (!record) throw new Error("记录加载失败");
      const readonly = Boolean(
        data.readonly || data.role === "readonly" || (data.canEdit !== undefined && !data.canEdit)
      );
      this.setData({ readonly });
      if (readonly) {
        await wx.redirectTo({
          url: `/pages/record-detail/index?id=${encodeURIComponent(recordId)}`,
        });
        return;
      }
      const recordType = record.type === "income" ? "income" : "expense";
      const recordAccounts = Array.from(
        new Set([...getPaymentAccounts(ledgerInfo), record.account].filter(Boolean))
      );
      const accountIndex = Math.max(0, recordAccounts.indexOf(record.account));
      this._currentLedger = ledgerInfo;
      this.setData({
        recordId,
        isEditing: true,
        familyEnabled: ledgerInfo.type === "shared",
        familyLoading: ledgerInfo.type === "shared",
        type: recordType,
        typeLabel: recordType === "income" ? "收入" : "支出",
        typeIcon: recordType === "income" ? "funds-line" : "price-tag-3-line",
        categoryId: record.categoryId || "",
        categoryName: record.categoryName || "其他",
        categoryLabel: record.categoryLabel || record.categoryName || "其他",
        categoryIcon: record.categoryIcon || "price-tag-3-line",
        parentCategory: record.parentCategory || "",
        parentIcon: record.parentIcon || "",
        amount: String(record.amount || ""),
        note: record.note || "",
        tags: Array.isArray(record.tags) ? record.tags : [],
        date: record.date || today(),
        ledgerId: record.ledgerId || "",
        ledgerName: (ledgerInfo && ledgerInfo.name) || "我的账本",
        accountIndex,
        quickAmounts: resolveQuickAmounts(ledgerInfo, ""),
        quickNotes: quickNotesFor(recordType, record.categoryName),
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
        createdDate: formatRecordTimestamp(record.createdAt),
        updatedDate: formatRecordTimestamp(record.updatedAt),
        syncVersion: Number(record.syncVersion || 0),
      });
      this.setAmountExpression(String(record.amount || ""));
      if (ledgerInfo.type === "shared") {
        await this.loadFamilyContext(
          record.ledgerId,
          record.familyAttribution,
          record.familyDisplay
        );
      }
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "记录加载失败" });
      this.setData({ recordLoadError: true });
    } finally {
      this.setData({ recordLoading: false });
    }
  },
  reloadRecord() {
    return this.loadRecord(this.data.recordId);
  },
  applyFamilyResult(result, existing, display = {}) {
    if (!result.ledger || result.ledger.type !== "shared") {
      this.setData({ familyEnabled: false, familyLoading: false });
      return;
    }
    this.setData({ familyEnabled: true });
    const eligibleMembers = (result.members || []).filter((item) =>
      ["owner", "member"].includes(item.role)
    );
    const payers = [{ openid: "", nickName: "其他" }, ...eligibleMembers];
    const consumers = [...eligibleMembers];
    const attribution = existing || {
      payerOpenid: app.globalData.openid || "",
      consumerKind: "personal",
      consumerOpenid: app.globalData.openid || "",
    };
    [
      [attribution.payerOpenid, display.payerName, payers],
      [attribution.consumerOpenid, display.consumerName, consumers],
    ].forEach(([id, name, list]) => {
      if (id && !list.some((item) => item.openid === id))
        list.push({ openid: id, nickName: name || "历史成员" });
    });
    const payerIndex = Math.max(
      0,
      payers.findIndex((item) => item.openid === (attribution.payerOpenid || ""))
    );
    const targetConsumerOpenid =
      attribution.consumerOpenid ||
      app.globalData.openid ||
      (consumers[0] && consumers[0].openid) ||
      "";
    const consumerIndex = Math.max(
      0,
      consumers.findIndex((item) => item.openid === targetConsumerOpenid)
    );
    const kindIndex = Math.max(
      0,
      this.data.familyKinds.findIndex((item) => item.value === attribution.consumerKind)
    );
    this.setData({
      familyMembers: payers,
      familyConsumers: consumers,
      familyPayerIndex: payerIndex,
      familyConsumerIndex: consumerIndex,
      familyKindIndex: kindIndex,
      familyLoading: false,
    });
  },
  async loadFamilyContext(ledgerId, existing, display = {}) {
    this.familyExisting = existing || null;
    this.familyDisplay = display || {};
    const cached = ledgerId && ledgerMembersMemoryCache[ledgerId];
    if (cached) {
      this.applyFamilyResult(cached, existing, display);
    } else {
      this.setData({ familyLoading: true, familyError: false });
    }
    try {
      const result = await ledgerService.getLedgerMembers(ledgerId);
      if (ledgerId) ledgerMembersMemoryCache[ledgerId] = result;
      this.applyFamilyResult(result, existing, display);
    } catch (_error) {
      if (!cached) {
        this.setData({ familyLoading: false, familyError: true });
      }
    }
  },
  retryFamilyContext() {
    if (this.data.ledgerId) delete ledgerMembersMemoryCache[this.data.ledgerId];
    return this.loadFamilyContext(this.data.ledgerId, this.familyExisting, this.familyDisplay);
  },
  changeFamilyPayer(event) {
    this.setData({ familyPayerIndex: Number(event.detail.value) });
  },
  changeFamilyKind(event) {
    this.setData({ familyKindIndex: Number(event.detail.value) });
  },
  changeFamilyConsumer(event) {
    this.setData({ familyConsumerIndex: Number(event.detail.value) });
  },

  applyCategorySelection(selection = {}) {
    const type = selection.type === "income" ? "income" : "expense";
    const categoryName = selection.categoryName || this.data.categoryName;
    const parentCategory =
      selection.parentCategory !== undefined ? selection.parentCategory : this.data.parentCategory;
    const categoryLabel = selection.categoryLabel || categoryName || this.data.categoryLabel;
    this.setData({
      type,
      typeLabel: type === "income" ? "收入" : "支出",
      typeIcon: type === "income" ? "funds-line" : "price-tag-3-line",
      categoryId: selection.categoryId || "",
      categoryName,
      categoryLabel,
      categoryHeading: categoryLabel,
      categoryIcon: selection.categoryIcon || this.data.categoryIcon,
      parentCategory,
      parentIcon: selection.parentIcon !== undefined ? selection.parentIcon : this.data.parentIcon,
      quickAmounts: resolveQuickAmounts(this._currentLedger, selection.systemKey || ""),
      quickNotes: quickNotesFor(type, categoryName),
      canSave:
        evaluateAmountExpression(this.data.amount).valid &&
        (this.data.isEditing || Boolean(selection.categoryId)),
    });
  },

  clearEntryAmount() {
    this.setAmountExpression("");
  },

  setQuickAmount(event) {
    const amount = String(event.detail.amount || event.currentTarget.dataset.amount);
    this.setAmountExpression(amount);
  },

  setQuickNote(event) {
    this.setData({ note: event.currentTarget.dataset.note });
  },

  setAmountExpression(amount) {
    const result = evaluateAmountExpression(amount);
    this.setData({
      amount,
      amountResult: result.text,
      showAmountResult: /[+-]/.test(amount) && result.valid,
      canSave: result.valid && (this.data.isEditing || Boolean(this.data.categoryId)),
    });
  },

  reselectCategory() {
    if (this.data.readonly || !this.data.isEditing) return;
    const params = [`type=${this.data.type}`, "mode=reselect"];
    if (this.data.ledgerId) params.push(`ledgerId=${encodeURIComponent(this.data.ledgerId)}`);
    wx.navigateTo({ url: `/pages/record-category/index?${params.join("&")}` });
  },

  onAmountInput(event) {
    this.setAmountExpression(event.detail.value);
  },
  onKeypadChange(event) {
    this.setData({ keypadOpen: Boolean(event.detail.open) });
  },
  onNoteInput(event) {
    this.setData({ note: String(event.detail.value || "").slice(0, 100) });
  },
  onDateChange(event) {
    this.setData({ date: event.detail.value });
  },
  onAccountChange(event) {
    this.setData({ accountIndex: Number(event.detail.value) });
  },
  onTagInput(event) {
    this.setData({ tagInput: event.detail.value });
  },

  addTag() {
    const incoming = normalizeTags(this.data.tagInput);
    if (!incoming.length) return;
    const tags = Array.from(new Set([...this.data.tags, ...incoming])).slice(0, 8);
    this.setData({ tags, tagInput: "" });
  },

  removeTag(event) {
    const index = Number(
      event.detail.index !== undefined ? event.detail.index : event.currentTarget.dataset.index
    );
    const tags = this.data.tags.filter((_, itemIndex) => itemIndex !== index);
    this.setData({ tags });
  },

  async deleteRecord() {
    if (this.data.readonly || this.data.recordLoading || this.data.recordLoadError) return;
    if (!this.data.isEditing || !this.data.recordId || this.data.saving || this.data.deleting)
      return;
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: "删除记录",
        content: "删除后无法恢复，确定删除这条记录吗？",
        confirmText: "删除",
        confirmColor: "#f0442f",
        success: (result) => resolve(Boolean(result.confirm)),
        fail: () => resolve(false),
      });
    });
    if (!confirmed) return;

    this.setData({ deleting: true });
    const recordId = this.data.recordId;
    const ledgerId = this.data.ledgerId;
    try {
      await recordService.deleteRecord({ recordId, ledgerId, syncVersion: this.data.syncVersion });
      feedback.showToast({ type: "success", message: "已删除" });
      wx.navigateBack();
    } catch (error) {
      this.setData({ deleting: false });
      feedback.showToast({
        type: "error",
        message:
          error.code === "RECORD_CONFLICT"
            ? "记录已被其他成员修改，请重新打开后操作"
            : "删除失败，请重试",
      });
    }
  },

  saveAndLeave() {
    return this.saveRecord({ continueRecording: false });
  },

  saveAndContinue() {
    return this.saveRecord({ continueRecording: true });
  },

  resetForNextRecord() {
    this.setData({
      amount: "",
      amountResult: "",
      showAmountResult: false,
      canSave: false,
      note: "",
      tagInput: "",
      tags: [],
      saving: false,
    });
  },

  async saveRecord({ continueRecording = false } = {}) {
    if (this.data.readonly) return;
    if (
      this.data.saving ||
      this.data.deleting ||
      this.data.recordLoading ||
      this.data.recordLoadError ||
      this.data.familyLoading ||
      this.data.familyError
    )
      return;
    if (!this.data.isEditing && !this.data.categoryId) {
      feedback.showToast({ type: "warning", message: "请选择分类" });
      return;
    }
    if (!this.data.isEditing && (this.data.categoryLoading || this.data.categoryError)) return;
    const finalTags = Array.from(
      new Set([...this.data.tags, ...normalizeTags(this.data.tagInput)])
    ).slice(0, 8);
    const result = evaluateAmountExpression(this.data.amount);
    if (!result.valid) {
      feedback.showToast({
        type: "warning",
        message: getAmountValidationMessage(this.data.type, result),
      });
      return;
    }

    let familyAttribution;
    if (this.data.familyEnabled && this.data.type === "expense") {
      const kind = this.data.familyKinds[this.data.familyKindIndex].value;
      const payer = this.data.familyMembers[this.data.familyPayerIndex] || {};
      const consumer = this.data.familyConsumers[this.data.familyConsumerIndex] || {};
      if (kind === "personal" && !consumer.openid) {
        feedback.showToast({ type: "warning", message: "请选择消费归属成员" });
        return;
      }
      familyAttribution = {
        payerOpenid: payer.openid || "",
        consumerKind: kind,
        consumerOpenid: kind === "personal" ? consumer.openid : "",
      };
    }

    this.setData({ saving: true });
    const ledgerId = this.data.ledgerId;
    const payload = {
      recordId: this.data.recordId,
      ledgerId,
      type: this.data.type,
      amount: result.value,
      note: this.data.note,
      tags: finalTags,
      date: this.data.date,
      categoryId: this.data.categoryId,
      categoryName: this.data.categoryName,
      categoryLabel: this.data.categoryLabel,
      categoryIcon: this.data.categoryIcon,
      parentCategory: this.data.parentCategory,
      parentIcon: this.data.parentIcon,
      account: this.data.accounts[this.data.accountIndex],
      syncVersion: this.data.syncVersion || 0,
      ...(familyAttribution ? { familyAttribution } : {}),
    };

    try {
      if (this.data.isEditing) {
        await recordService.updateRecord(payload);
        wx.navigateBack();
        return;
      }

      await recordService.createRecord(payload);
      if (continueRecording) {
        this.resetForNextRecord();
        return;
      }
      wx.navigateBack();
    } catch (error) {
      this.setData({ saving: false });
      feedback.showToast({
        type: "error",
        message:
          error.code === "RECORD_CONFLICT"
            ? "记录已被其他成员修改，输入已保留，请重新确认"
            : "保存失败，输入已保留，请重试",
      });
    }
  },
});
