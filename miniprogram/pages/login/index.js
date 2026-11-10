const feedback = require("../../services/feedback-ui");
const app = getApp();

function hasCachedAuth() {
  const auth = wx.getStorageSync("ourNestAuth");
  return Boolean(auth && auth.user);
}

Page({
  data: {
    loggingIn: false,
  },

  onLoad() {
    this.enterIndexIfAuthenticated();
  },

  onShow() {
    this.enterIndexIfAuthenticated();
  },

  async enterIndexIfAuthenticated() {
    if (this.data.loggingIn) return;
    let restoredFromCache = false;
    if (!app.globalData.loggedIn && hasCachedAuth()) {
      app.restoreAuthState();
      restoredFromCache = app.globalData.loggedIn;
    }

    if (restoredFromCache) {
      try {
        await app.loginWithWechat({ force: true });
      } catch (error) {
        feedback.showToast({ type: "error", message: error.message || "登录状态已失效" });
        return;
      }
    }

    if (app.globalData.loggedIn) {
      wx.reLaunch({ url: "/pages/index/index" });
    }
  },

  async login() {
    if (this.data.loggingIn) return;

    this.setData({ loggingIn: true });

    try {
      await app.loginWithWechat({ force: true });
      wx.reLaunch({ url: "/pages/index/index" });
    } catch (error) {
      feedback.showToast({ type: "error", message: error.message || "登录失败" });
      this.setData({ loggingIn: false });
    }
  },
});
