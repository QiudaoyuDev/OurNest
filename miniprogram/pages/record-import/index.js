const app = getApp();
const recordService = require("../../services/record.service");
const categoryService = require("../../services/category.service");
const feedback = require("../../services/feedback-ui");
const { getPaymentAccounts } = require("../../services/payment-account.service");
Page({
  data: {
    ledgerName: "当前账本",
    ledgerId: "",
    accounts: getPaymentAccounts(),
    accountIndex: 0,
    uploading: false,
    previewVisible: false,
    previewRows: [],
    hasCategoryChoices: false,
    categoryOptions: { income: [], expense: [] },
    previewErrors: [],
    duplicatesIncomplete: false,
    previewFileId: "",
    previewFileHash: "",
    previewBatchId: "",
    pendingImport: null,
    pendingCleanup: [],
    cleaning: false,
    serverCleanupPending: false,
    abandonedPreviewIds: [],
    previewAccount: "",
    resultVisible: false,
    result: { imported: 0, skipped: 0, errors: [] },
    resultDateText: "",
  },
  onLoad() {
    const ledger = app.globalData.currentLedger || {};
    if (!app.globalData.loggedIn) return wx.reLaunch({ url: "/pages/login/index" });
    if (ledger.readonly) {
      feedback.showReadonlyToast();
      setTimeout(() => wx.navigateBack(), 300);
      return;
    }
    const environment = app.globalData.environment || {};
    this.importStorageKey = `recordImport:${environment.id || ""}:${app.globalData.openid}:${ledger._id || ""}`;
    this.cleanupStorageKey = `recordImportCleanup:${environment.id || ""}:${app.globalData.openid}:${ledger._id || ""}`;
    const pendingImport = wx.getStorageSync(this.importStorageKey) || null;
    const storedCleanup = wx.getStorageSync(this.cleanupStorageKey);
    const pendingCleanup = Array.isArray(storedCleanup) ? storedCleanup : [];
    this.setData({
      pendingImport,
      pendingCleanup,
      ledgerId: ledger._id || "",
      ledgerName: ledger.name || "当前账本",
      accounts: getPaymentAccounts(ledger),
    });
    if (pendingCleanup.length || typeof recordService.sweepImportFileCleanup === "function")
      this.retryPendingCleanup();
    if (typeof recordService.listImportPreviews === "function") this.refreshAbandonedPreviews();
  },
  onShow() {
    if (!this.data.uploading) {
      this.setData({
        resultVisible: false,
        result: { imported: 0, skipped: 0, errors: [], startDate: "" },
        resultDateText: "",
      });
    }
  },
  onAccountChange(event) {
    this.setData({ accountIndex: Number(event.detail.value) });
  },
  async downloadTemplate() {
    const loadingId = feedback.showLoading({ message: "正在准备模板…" });
    try {
      const data = await recordService.getImportTemplate();
      feedback.updateLoading(loadingId, { message: "正在下载模板…" });
      const download = await wx.downloadFile({ url: data.url });
      if (download.statusCode !== 200) throw new Error("模板下载失败");
      await wx.openDocument({ filePath: download.tempFilePath, fileType: "xlsx", showMenu: true });
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "模板下载失败" });
    } finally {
      feedback.hideLoading(loadingId);
    }
  },
  async chooseAndImport() {
    if (this.data.uploading || !this.data.ledgerId) return;
    this.setData({ uploading: true });
    let ticket;
    let uploaded;
    let previewBatchId = "";
    try {
      let selected;
      try {
        selected = await wx.chooseMessageFile({
          count: 1,
          type: "file",
          extension: ["xls", "xlsx", "csv"],
        });
      } catch (error) {
        if (String(error.errMsg || error.message || "").includes("cancel")) return;
        throw error;
      }
      const file = selected.tempFiles && selected.tempFiles[0];
      if (!file || !file.path) return;
      if (file.size && file.size > 5 * 1024 * 1024) {
        feedback.showToast({ type: "error", message: "文件不能超过 5 MB" });
        return;
      }
      const extension = /\.(xls|xlsx|csv)$/i.exec(String(file.name || ""));
      if (!extension) {
        feedback.showToast({ type: "error", message: "请选择 xls、xlsx 或 csv 文件" });
        return;
      }
      ticket = await recordService.createImportUpload({
        ledgerId: this.data.ledgerId,
        extension: extension[1].toLowerCase(),
      });
      uploaded = await wx.cloud.uploadFile({
        cloudPath: ticket.cloudPath,
        filePath: file.path,
      });
      const account = this.data.accounts[this.data.accountIndex];
      const result = await recordService.previewImport({
        fileId: uploaded.fileID,
        ticketId: ticket.ticketId,
        ledgerId: this.data.ledgerId,
        defaultAccount: account,
      });
      previewBatchId = result.batchId || "";
      const needsCategories = (result.rows || []).some((row) => row.categoryChoiceRequired);
      const categories = needsCategories
        ? await categoryService.listCategories(this.data.ledgerId)
        : [];
      const parents = new Map(
        categories
          .filter((item) => item.level === "parent")
          .map((item) => [item._id || item.id, item])
      );
      const categoryOptions = {
        income: [{ id: "", label: "其他（未关联）" }],
        expense: [{ id: "", label: "其他（未关联）" }],
      };
      categories
        .filter((item) => item.level === "child" && categoryOptions[item.type])
        .forEach((item) => {
          const parent = parents.get(item.parentId);
          if (parent)
            categoryOptions[item.type].push({
              id: item._id || item.id,
              label: `${parent.name} / ${item.name}`,
            });
        });
      this.setData({
        categoryOptions,
        hasCategoryChoices: needsCategories,
        previewVisible: true,
        previewRows: (result.rows || []).map((row) => ({
          ...row,
          selected: !row.excluded && !row.needsReview && !row.confirmedDuplicate,
          manualType: "",
          categoryConfirmed: !row.categoryChoiceRequired,
          categoryId: "",
          categoryIndex: 0,
          categoryOptions: categoryOptions[row.type] || categoryOptions.expense,
        })),
        previewErrors: result.errors || [],
        duplicatesIncomplete: Boolean(result.duplicatesIncomplete),
        previewFileId: uploaded.fileID,
        previewFileHash: result.fileHash,
        previewBatchId: result.batchId,
        previewAccount: account,
      });
    } catch (error) {
      try {
        let cleanup;
        if (previewBatchId) {
          cleanup = await recordService.cancelImportPreview({ batchId: previewBatchId });
          if (cleanup.cleanupStatus === "pending") this.rememberPendingCleanup(previewBatchId);
        } else if (ticket && uploaded && uploaded.fileID) {
          cleanup = await recordService.abandonImportUpload({
            ticketId: ticket.ticketId,
            fileId: uploaded.fileID,
          });
        }
        if (cleanup && cleanup.cleanupStatus === "pending")
          this.setData({ serverCleanupPending: true });
      } catch (_cleanupError) {
        if (typeof recordService.listImportPreviews === "function") this.refreshAbandonedPreviews();
        this.setData({ serverCleanupPending: true });
      }
      feedback.showToast({ type: "error", message: error.message || "预览失败" });
    } finally {
      this.setData({ uploading: false });
    }
  },
  togglePreviewRow(event) {
    const rowNumber = Number(event.currentTarget.dataset.row);
    this.setData({
      previewRows: this.data.previewRows.map((row) =>
        row.rowNumber === rowNumber && !row.excluded && (!row.needsReview || row.manualType)
          ? { ...row, selected: !row.selected }
          : row
      ),
    });
  },
  chooseReviewType(event) {
    const rowNumber = Number(event.currentTarget.dataset.row);
    const type = event.currentTarget.dataset.type;
    if (!["income", "expense"].includes(type)) return;
    this.setData({
      previewRows: this.data.previewRows.map((row) =>
        row.rowNumber === rowNumber && row.needsReview && !row.excluded
          ? {
              ...row,
              selected: true,
              manualType: type,
              categoryConfirmed: false,
              categoryId: "",
              categoryIndex: 0,
              categoryOptions: this.data.categoryOptions[type],
            }
          : row
      ),
    });
  },
  stopPreviewTap() {},
  choosePreviewCategory(event) {
    const rowNumber = Number(event.currentTarget.dataset.row);
    const index = Number(event.detail.value);
    this.setData({
      previewRows: this.data.previewRows.map((row) => {
        if (row.rowNumber !== rowNumber || !row.categoryOptions[index]) return row;
        return {
          ...row,
          categoryIndex: index,
          categoryId: row.categoryOptions[index].id,
          categoryConfirmed: true,
        };
      }),
    });
  },
  confirmUnmappedCategories() {
    this.setData({
      previewRows: this.data.previewRows.map((row) =>
        row.categoryChoiceRequired && !row.categoryConfirmed
          ? { ...row, categoryConfirmed: true, categoryId: "", categoryIndex: 0 }
          : row
      ),
    });
  },
  async cancelPreview() {
    if (this.data.uploading) return;
    this.setData({ uploading: true });
    try {
      if (this.data.previewBatchId) {
        const result = await recordService.cancelImportPreview({
          batchId: this.data.previewBatchId,
        });
        if (
          result.cleanupStatus === "pending" &&
          !this.rememberPendingCleanup(this.data.previewBatchId)
        ) {
          feedback.showToast({ type: "error", message: "无法保存清理进度，请重试" });
          return;
        }
        if (result.cleanupStatus === "unmanaged")
          feedback.showToast({ type: "warning", message: "历史批次临时文件需要管理员清理" });
      }
    } catch (_error) {
      feedback.showToast({ type: "error", message: "取消预览未完成，请重试" });
      return;
    } finally {
      this.setData({ uploading: false });
    }
    this.setData({
      previewVisible: false,
      previewRows: [],
      previewErrors: [],
      previewFileId: "",
      previewFileHash: "",
      previewBatchId: "",
    });
  },
  async confirmImport() {
    if (this.data.uploading || !this.data.previewVisible) return;
    const selectedRows = this.data.previewRows
      .filter((row) => row.selected)
      .map((row) => row.rowNumber);
    if (!selectedRows.length) {
      feedback.showToast({ type: "warning", message: "请选择需要导入的记录" });
      return;
    }
    if (
      this.data.previewRows.some(
        (row) => row.selected && row.categoryChoiceRequired && !row.categoryConfirmed
      )
    ) {
      feedback.showToast({ type: "warning", message: "请确认所选记录的分类" });
      return;
    }
    const categoryChoices = {};
    this.data.previewRows
      .filter((row) => row.selected && row.categoryChoiceRequired)
      .forEach((row) => {
        categoryChoices[row.rowNumber] = row.categoryId || "";
      });
    const manualTypes = {};
    this.data.previewRows
      .filter((row) => row.selected && row.needsReview)
      .forEach((row) => {
        manualTypes[row.rowNumber] = row.manualType;
      });
    const pendingImport = {
      batchId: this.data.previewBatchId,
      selectedRows,
      manualTypes,
      categoryChoices,
    };
    if (!pendingImport.batchId) {
      feedback.showToast({ type: "error", message: "导入批次无效，请重新预览" });
      return;
    }
    try {
      wx.setStorageSync(this.importStorageKey, pendingImport);
    } catch (_error) {
      feedback.showToast({ type: "error", message: "无法保存导入进度，请检查设备存储后重试" });
      return;
    }
    this.setData({ pendingImport, previewVisible: false });
    return this.resumeImport();
  },
  async resumeImport() {
    let pendingImport = this.data.pendingImport;
    if (this.data.uploading || !pendingImport) return;
    this.setData({ uploading: true });
    try {
      let result;
      do {
        result = await recordService.importRecords(pendingImport);
        if (result.recovered) {
          pendingImport = { ...pendingImport, categoryChoices: result.categoryChoices };
          delete pendingImport.recoverCategories;
          wx.setStorageSync(this.importStorageKey, pendingImport);
          this.setData({ pendingImport });
        }
      } while (result.hasMore);
      if (
        result.cleanupStatus === "pending" &&
        !this.rememberPendingCleanup(pendingImport.batchId)
      ) {
        feedback.showToast({
          type: "error",
          message: "导入已完成，但无法保存清理进度，请继续重试",
        });
        return;
      }
      if (result.cleanupStatus === "unmanaged")
        feedback.showToast({ type: "warning", message: "历史批次临时文件需要管理员清理" });
      wx.removeStorageSync(this.importStorageKey);
      const range =
        result.startDate && result.endDate
          ? `已导入 ${result.startDate} 至 ${result.endDate} 的记录`
          : "导入已完成";
      this.setData({
        previewVisible: false,
        pendingImport: null,
        resultVisible: true,
        result: {
          imported: result.imported || 0,
          skipped: result.skipped || 0,
          duplicates: result.duplicates || 0,
          errors: result.errors || [],
          startDate: result.startDate || "",
        },
        resultDateText: range,
      });
    } catch (_error) {
      feedback.showToast({ type: "error", message: "导入暂未完成，可继续上次导入" });
    } finally {
      this.setData({ uploading: false });
    }
  },
  rememberPendingCleanup(batchId) {
    const pendingCleanup = Array.from(new Set([...this.data.pendingCleanup, batchId]));
    try {
      wx.setStorageSync(this.cleanupStorageKey, pendingCleanup);
      this.setData({ pendingCleanup });
      return true;
    } catch (_error) {
      return false;
    }
  },
  async refreshAbandonedPreviews() {
    try {
      const result = await recordService.listImportPreviews({ ledgerId: this.data.ledgerId });
      const current = (this.data.pendingImport || {}).batchId;
      this.setData({
        abandonedPreviewIds: (result.previews || [])
          .map((item) => item.batchId)
          .filter((id) => id && id !== current && id !== this.data.previewBatchId),
      });
    } catch (_error) {
      this.setData({ abandonedPreviewIds: [] });
    }
  },
  cleanAbandonedPreviews() {
    if (this.data.uploading || !this.data.abandonedPreviewIds.length) return;
    wx.showModal({
      title: "清理未确认预览",
      content: "将取消未确认的预览，包括其他设备上的预览；已经开始的导入不会取消。",
      success: async (result) => {
        if (!result.confirm || this.data.uploading) return;
        this.setData({ uploading: true });
        let failed = false;
        try {
          for (const batchId of this.data.abandonedPreviewIds) {
            try {
              const response = await recordService.cancelImportPreview({ batchId });
              if (response.cleanupStatus === "pending" && !this.rememberPendingCleanup(batchId))
                failed = true;
              if (response.cleanupStatus === "unmanaged") failed = true;
            } catch (_error) {
              failed = true;
            }
          }
          await this.refreshAbandonedPreviews();
          if (failed)
            feedback.showToast({
              type: "warning",
              message: "部分预览或历史文件未能清理，请稍后检查",
            });
        } finally {
          this.setData({ uploading: false });
        }
      },
    });
  },
  async retryPendingCleanup() {
    if (this.data.cleaning) return;
    this.setData({ cleaning: true });
    const requested = [...this.data.pendingCleanup];
    const remaining = [];
    for (const batchId of requested) {
      try {
        const result = await recordService.retryImportFileCleanup({ batchId });
        if (result.cleanupStatus === "pending") remaining.push(batchId);
      } catch (_error) {
        remaining.push(batchId);
      }
    }
    const next = Array.from(
      new Set([...remaining, ...this.data.pendingCleanup.filter((id) => !requested.includes(id))])
    );
    try {
      wx.setStorageSync(this.cleanupStorageKey, next);
      this.setData({ pendingCleanup: next });
    } catch (_error) {
      feedback.showToast({ type: "warning", message: "清理进度保存失败，请稍后重试" });
    }
    try {
      if (typeof recordService.sweepImportFileCleanup === "function") {
        const result = await recordService.sweepImportFileCleanup({ ledgerId: this.data.ledgerId });
        this.setData({ serverCleanupPending: Boolean(result.pending || result.hasMore) });
      }
    } catch (_error) {
      this.setData({ serverCleanupPending: true });
    } finally {
      this.setData({ cleaning: false });
    }
  },
  recoverImportCategories() {
    if (this.data.uploading || !this.data.pendingImport) return;
    const pendingImport = { ...this.data.pendingImport, recoverCategories: true };
    try {
      wx.setStorageSync(this.importStorageKey, pendingImport);
    } catch (_error) {
      feedback.showToast({ type: "error", message: "无法保存导入进度，请检查设备存储后重试" });
      return;
    }
    this.setData({ pendingImport });
    return this.resumeImport();
  },
  continueImport() {
    this.setData({
      resultVisible: false,
      result: { imported: 0, skipped: 0, errors: [] },
      resultDateText: "",
    });
  },
  viewRecords() {
    const month = this.data.result.startDate ? this.data.result.startDate.slice(0, 7) : "";
    wx.redirectTo({
      url: `/pages/index/index?tab=records${month ? `&month=${encodeURIComponent(month)}` : ""}`,
    });
  },
});
