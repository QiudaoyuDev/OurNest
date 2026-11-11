const feedback = require("../../services/feedback-ui");
const app = getApp();
const ledgerService = require("../../services/ledger.service");
const { resolveAvatarUrls } = require("../../utils/avatar");
const ledgerStore = require("../../services/ledger.store");
const categoryStore = require("../../services/category.store");

function normalizeMember(item = {}) {
  const role = ["owner", "member", "visitor"].includes(item.role) ? item.role : "member";
  return {
    ...item,
    role,
    roleClass: role,
    roleText: role === "owner" ? "拥有者" : role === "visitor" ? "访客" : "成员",
    isOwner: role === "owner",
  };
}

function getShareOptions(ledger = {}) {
  return ledger.type === "shared"
    ? [
        {
          mode: "member",
          title: "邀请成为成员",
          desc: "可记账、编辑自己的记录",
          icon: "group-line",
        },
        { mode: "visitor", title: "邀请成为访客", desc: "可查看账本数据", icon: "eye-line" },
      ]
    : [{ mode: "visitor", title: "邀请成为访客", desc: "对方可查看账本数据", icon: "eye-line" }];
}

Page({
  data: {
    loading: true,
    error: false,
    ledgerId: "",
    ledgerName: "成员管理",
    ledger: {},
    members: [],
    canManage: false,
    shareSheetVisible: false,
    shareOptions: [],
    shareMode: "visitor",
    inviteCode: "",
    inviteExpiresAt: "",
    invites: [],
    ownerTransfer: null,
    revokingId: "",
    confirmDialogVisible: false,
    confirmDialogTitle: "",
    confirmDialogContent: "",
    confirmDialogIcon: "",
    confirmDialogColor: "",
    confirmDialogConfirmText: "",
    confirmDialogDanger: false,
    confirmDialogLoading: false,
  },
  onShow() {
    this.loadMembers();
  },
  async loadMembers() {
    if (!app.globalData.loggedIn) return wx.reLaunch({ url: "/pages/login/index" });
    this.setData({ loading: true, error: false });
    try {
      await app.loginWithWechat();
      const data = await ledgerService.getLedgerMembers();
      const members = (await resolveAvatarUrls(data.members || [])).map(normalizeMember);
      this.setData({
        loading: false,
        ledgerId: (data.ledger && data.ledger.id) || "",
        ledgerName: (data.ledger && data.ledger.name) || "成员管理",
        ledger: data.ledger || {},
        members,
        canManage: Boolean(data.canManage),
        ownerTransfer: data.ownerTransfer || null,
      });
      if (data.canManage) await this.loadInvites();
    } catch (error) {
      console.warn("member list load failed", error);
      this.setData({ loading: false, error: true });
    }
  },
  openConfirmDialog({ title, content, icon, color, confirmText, danger, onConfirm }) {
    this._onConfirmAction = onConfirm;
    this.setData({
      confirmDialogVisible: true,
      confirmDialogTitle: title,
      confirmDialogContent: content,
      confirmDialogIcon: icon || "question-line",
      confirmDialogColor: color || "#f0442f",
      confirmDialogConfirmText: confirmText || "确认",
      confirmDialogDanger: Boolean(danger),
      confirmDialogLoading: false,
    });
  },
  closeConfirmDialog() {
    this._onConfirmAction = null;
    this.setData({ confirmDialogVisible: false });
  },
  async onConfirmDialogAction() {
    if (!this._onConfirmAction) return;
    this.setData({ confirmDialogLoading: true });
    try {
      await this._onConfirmAction();
    } finally {
      this.setData({ confirmDialogLoading: false, confirmDialogVisible: false });
      this._onConfirmAction = null;
    }
  },
  removeMember(event) {
    const openid = event.currentTarget.dataset.openid;
    const name = event.currentTarget.dataset.name || "该成员";
    if (!openid || !this.data.canManage) return;
    this.openConfirmDialog({
      title: "移除成员",
      content: `确认将“${name}”移出当前账本吗？其权限将立即失效，历史记录会保留。`,
      icon: "user-unfollow-line",
      color: "#f0442f",
      confirmText: "确认移除",
      danger: true,
      onConfirm: async () => {
        const loadingId = feedback.showLoading({ message: "正在移除" });
        try {
          await ledgerStore.removeLedgerMember(openid, this.data.ledgerId);
          feedback.showToast({ type: "success", message: "已移除" });
          this.loadMembers();
        } catch (error) {
          feedback.showToast({ type: "error", message: error.message || "移除失败" });
        } finally {
          feedback.hideLoading(loadingId);
        }
      },
    });
  },
  async loadInvites() {
    const result = await ledgerService.listLedgerInvites(this.data.ledgerId);
    this.setData({
      invites: (result.invites || []).map((item) => ({
        ...item,
        createdText: item.createdAt ? new Date(item.createdAt).toLocaleString() : "未知时间",
        expiresText: new Date(item.expiresAt).toLocaleString(),
      })),
    });
  },
  async inviteLedger() {
    if (!this.data.canManage) return;
    const options = getShareOptions(this.data.ledger);
    this.setData({
      shareSheetVisible: true,
      shareOptions: options,
      shareMode: options[0].mode,
      inviteCode: "",
      displayCode: "",
      inviteExpiresAt: "",
    });
  },
  async generateInvite() {
    if (!this.data.canManage || this.data.generating) return;
    this.setData({ generating: true });
    try {
      const data = await ledgerStore.createLedgerInviteToken({
        ledgerId: this.data.ledgerId,
        mode: this.data.shareMode,
      });
      this.setData({
        inviteCode: data.token,
        displayCode: `${data.token.slice(0, 4)} - ${data.token.slice(4)}`,
        inviteExpiresAt: new Date(data.expiresAt).toLocaleString(),
      });
      try {
        await this.loadInvites();
      } catch (_error) {
        feedback.showToast({ type: "warning", message: "邀请码已生成，但邀请列表刷新失败" });
      }
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "分享准备失败" });
    } finally {
      this.setData({ generating: false });
    }
  },
  closeShareSheet() {
    this.setData({ shareSheetVisible: false });
  },
  stopSheetTap() {},
  selectShareMode(event) {
    if (this.data.generating) return;
    const shareMode = event.currentTarget.dataset.mode || "visitor";
    this.setData({
      shareMode,
      inviteCode: "",
      displayCode: "",
      inviteExpiresAt: "",
    });
  },
  copyInviteCode() {
    if (!this.data.inviteCode) return;
    wx.setClipboardData({ data: this.data.inviteCode });
  },
  onShareAppMessage(options = {}) {
    const mode = (options.target && options.target.dataset.mode) || this.data.shareMode;
    return {
      title: mode === "visitor" ? `查看 ${this.data.ledgerName}` : `加入 ${this.data.ledgerName}`,
      path: `/pages/ledger-join-result/index?inviteToken=${encodeURIComponent(this.data.inviteCode || "")}`,
    };
  },
  async runMembershipAction(method, ...args) {
    try {
      await ledgerService[method](...args);
      try {
        await ledgerStore.syncLedgers({ force: true });
      } catch (_error) {
        ledgerStore.markSyncRequired();
        feedback.showToast({ type: "warning", message: "操作已完成，同步失败，请稍后手动同步" });
        if (method === "leaveLedger") {
          categoryStore.removeLedger(this.data.ledgerId);
          ledgerStore.clearLedgers();
          app.globalData.currentLedger = null;
          app.globalData.readonly = false;
          if (app.globalData.user) app.globalData.user.currentLedgerId = "";
          app.persistAuthState();
          wx.reLaunch({ url: "/pages/index/index" });
        }
        return;
      }
      if (method !== "revokeLedgerInvite") {
        feedback.showToast({ type: "success", message: "操作成功" });
      }
      if (method === "leaveLedger") wx.reLaunch({ url: "/pages/index/index" });
      else await this.loadMembers();
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "操作失败，请重试" });
    }
  },
  changeRole(event) {
    const { openid, role, name } = event.currentTarget.dataset;
    const next = role === "member" ? "visitor" : "member";
    this.openConfirmDialog({
      title: "调整权限",
      content: `将“${name}”设为${next === "member" ? "成员（可共同记账并编辑自己的记录）" : "只读访客（仅查账，不可编辑）"}？历史记录将完整保留。`,
      icon: "shield-user-line",
      color: "#0284c7",
      confirmText: "确认调整",
      onConfirm: async () => {
        await this.runMembershipAction("changeLedgerMemberRole", this.data.ledgerId, openid, next);
      },
    });
  },
  leaveLedger() {
    this.openConfirmDialog({
      title: "退出账本",
      content: "退出后将无法再访问该账本，历史记录及创建者信息保留。确认退出？",
      icon: "logout-box-r-line",
      color: "#f0442f",
      confirmText: "确认退出",
      danger: true,
      onConfirm: async () => {
        await this.runMembershipAction("leaveLedger", this.data.ledgerId);
      },
    });
  },
  transferOwner(event) {
    const { openid, name } = event.currentTarget.dataset;
    this.openConfirmDialog({
      title: "转移账本所有权",
      content: `确认向“${name}”发起转移？对方确认后将成为新拥有者，你将成为普通成员。`,
      icon: "swap-line",
      color: "#d97706",
      confirmText: "发起转移",
      onConfirm: async () => {
        await this.runMembershipAction("requestOwnerTransfer", this.data.ledgerId, openid);
      },
    });
  },
  respondTransfer(event) {
    const accept = event.currentTarget.dataset.accept;
    this.openConfirmDialog({
      title: accept ? "接受账本所有权" : "取消转移",
      content: accept ? "确认成为账本拥有者？原拥有者将成为普通成员。" : "确认取消这次所有权转移？",
      icon: accept ? "check-line" : "close-line",
      color: accept ? "#0ea569" : "#6f5a52",
      confirmText: accept ? "确认接收" : "确认取消",
      onConfirm: async () => {
        await this.runMembershipAction(
          accept ? "acceptOwnerTransfer" : "cancelOwnerTransfer",
          this.data.ledgerId
        );
      },
    });
  },
  revokeInvite(event) {
    const inviteId = event.currentTarget.dataset.id;
    this.openConfirmDialog({
      title: "撤销邀请",
      content: "撤销后该邀请码及微信分享链接将立即失效，不可再次使用。",
      icon: "delete-bin-line",
      color: "#f0442f",
      confirmText: "撤销邀请",
      danger: true,
      onConfirm: async () => {
        this.setData({ revokingId: inviteId });
        await this.runMembershipAction("revokeLedgerInvite", this.data.ledgerId, inviteId);
        this.setData({ revokingId: "" });
      },
    });
  },
});
