const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const plain = (value) => JSON.parse(JSON.stringify(value));
const input = (value) => ({ detail: { value } });
const dataset = (value) => ({ currentTarget: { dataset: value } });
const categories = [
  { _id: "food", type: "expense", level: "parent", name: "餐饮", icon: "restaurant" },
  { _id: "lunch", type: "expense", level: "child", parentId: "food", name: "午餐", icon: "bowl" },
  { _id: "salary", type: "income", level: "parent", name: "工资", icon: "funds" },
  { _id: "pay", type: "income", level: "child", parentId: "salary", name: "月薪", icon: "wallet" },
];

function loadDefinition(relative, kind, stubs, globals = {}) {
  const filename = path.join(root, relative);
  const localRequire = createRequire(filename);
  let definition;
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      ...globals,
      require(name) {
        return Object.hasOwn(stubs, name) ? stubs[name] : localRequire(name);
      },
      [kind](value) {
        definition = value;
      },
    },
    { filename }
  );
  return definition;
}

function pageFixture({
  ledger = {},
  createRecord,
  updateRecord,
  listCategories = async () => categories,
} = {}) {
  const calls = { creates: [], updates: [], toasts: [], navigation: [], modals: [] };
  const currentLedger = { _id: "ledger", name: "日常账本", type: "personal", ...ledger };
  const definition = loadDefinition(
    "miniprogram/pages/record-edit/index.js",
    "Page",
    {
      "../../services/feedback-ui": {
        showToast: (value) => calls.toasts.push(plain(value)),
        showReadonlyToast() {},
      },
      "../../services/record.service": {
        createRecord(payload) {
          calls.creates.push(plain(payload));
          return createRecord ? createRecord(payload) : Promise.resolve({ recordId: "new" });
        },
        updateRecord(payload) {
          calls.updates.push(plain(payload));
          return updateRecord ? updateRecord(payload) : Promise.resolve();
        },
      },
      "../../services/category.service": { listCategories },
      "../../services/category.store": { subscribeSync: () => () => {} },
      "../../services/ledger.service": {
        getLedgerMembers: async () => ({
          ledger: currentLedger,
          members: [
            { openid: "self", nickName: "我", role: "owner" },
            { openid: "other", nickName: "家人", role: "member" },
            { openid: "visitor", nickName: "访客", role: "readonly" },
          ],
        }),
      },
      "../../services/payment-account.service": { getPaymentAccounts: () => ["微信", "现金"] },
      "../../utils/navigation-timing": { markNavigation() {} },
    },
    {
      getApp: () => ({ globalData: { currentLedger, openid: "self" } }),
      getCurrentPages: () => [{}, {}],
      wx: {
        ...Object.fromEntries(
          ["navigateBack", "navigateTo", "reLaunch"].map((name) => [
            name,
            (options) => calls.navigation.push({ name, options }),
          ])
        ),
        showModal: (options) => calls.modals.push(options),
      },
    }
  );
  const page = {
    ...definition,
    data: plain(definition.data),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  page.onLoad();
  return { page, calls };
}

test("entry back confirms unsaved input and preserves it on cancel", () => {
  const { page, calls } = pageFixture();
  page.handleEntryBack();
  assert.equal(calls.navigation.length, 1);
  page.onAmountInput(input("42"));
  page.handleEntryBack();
  assert.equal(calls.modals.length, 1);
  calls.modals[0].success({ confirm: false });
  assert.equal(page.data.amount, "42");
  assert.equal(calls.navigation.length, 1);
  calls.modals[0].success({ confirm: true });
  assert.equal(calls.navigation.length, 2);
});

async function readyPage(options) {
  const fixture = pageFixture(options);
  await fixture.page.onShow();
  fixture.page.chooseCategory({ detail: { categoryId: "lunch" } });
  fixture.page.onAmountInput(input("12.5+8-3"));
  return fixture;
}

function componentFixture(properties = {}) {
  const definition = loadDefinition("miniprogram/components/tl-record-form/index.js", "Component", {
    "../../services/feedback-ui": { showToast() {} },
  });
  const events = [];
  const component = {
    ...definition.methods,
    data: {
      ...plain(
        Object.fromEntries(
          Object.entries(definition.properties).map(([key, value]) => [key, value.value])
        )
      ),
      ...plain(definition.data),
      ...properties,
    },
    setData(patch) {
      Object.assign(this.data, patch);
    },
    triggerEvent(name, detail) {
      events.push({ name, detail: detail === undefined ? undefined : plain(detail) });
    },
  };
  return { component, events };
}

test("flat category choices include all children and disambiguate duplicate names", async () => {
  const duplicates = [
    ...categories,
    { _id: "food2", type: "expense", level: "parent", name: "旅行" },
    { _id: "lunch2", type: "expense", level: "child", parentId: "food2", name: "午餐" },
  ];
  const { page } = pageFixture({ listCategories: async () => duplicates });
  await page.onShow();
  assert.deepEqual(plain(page.data.flatCategories.map((item) => [item.id, item.parentHint])), [
    ["lunch", "餐饮"],
    ["lunch2", "旅行"],
  ]);
  page.chooseCategory({ detail: {}, currentTarget: { dataset: { categoryId: "lunch2" } } });
  assert.equal(page.data.categoryId, "lunch2");
  assert.equal(page.data.parentCategory, "旅行");
});

test("train uses dedicated quick amounts while taxi uses ledger configuration", async () => {
  const traffic = [
    { _id: "traffic", type: "expense", level: "parent", name: "交通" },
    { _id: "train", type: "expense", level: "child", parentId: "traffic", name: "火车高铁" },
    { _id: "taxi", type: "expense", level: "child", parentId: "traffic", name: "打车" },
  ];
  const { page } = pageFixture({
    ledger: { quickAmountsEnabled: true, quickAmounts: [18, 32] },
    listCategories: async () => traffic,
  });
  await page.onShow();
  page.chooseCategory({ detail: { categoryId: "train" } });
  assert.deepEqual(plain(page.data.quickAmounts), [373.5, 356.5, 265, 432.5]);
  page.chooseCategory({ detail: { categoryId: "taxi" } });
  assert.deepEqual(plain(page.data.quickAmounts), [18, 32]);
});

test("stale category failures cannot overwrite a newer successful load", async () => {
  let rejectOld;
  let resolveNew;
  let calls = 0;
  const { page } = pageFixture({
    listCategories: () =>
      new Promise((resolve, reject) => {
        if (calls++ === 0) rejectOld = reject;
        else resolveNew = resolve;
      }),
  });
  const oldRequest = page.loadCategories();
  const newRequest = page.loadCategories();
  resolveNew(categories);
  await newRequest;
  rejectOld(new Error("stale"));
  await oldRequest;
  assert.equal(page.data.categoryError, false);
  assert.equal(page.data.groups.length, 1);
});

test("new entry ignores route category metadata and cannot save without explicit selection", async () => {
  const { page, calls } = pageFixture();
  page.onLoad({ categoryId: "lunch", categoryName: "午餐" });
  await page.onShow();
  page.onAmountInput(input("20"));
  assert.equal(page.data.categoryId, "");
  assert.equal(page.data.canSave, false);
  await page.saveAndLeave();
  await page.saveAndContinue();
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.navigation.length, 0);
  assert.equal(calls.toasts.at(-1).message, "请选择分类");
});

test("expression saves evaluated amount with category metadata and normalized tags", async () => {
  const { page, calls } = await readyPage();
  page.onNoteInput(input("午餐备注"));
  page.onTagInput(input("工作，午餐 工作"));
  page.onAccountChange(input("1"));
  page.onDateChange(input("2026-03-12"));
  assert.equal(page.data.amountResult, "17.5");
  assert.equal(page.data.showAmountResult, true);
  assert.equal(page.data.canSave, true);
  await page.saveAndLeave();
  assert.equal(calls.creates.length, 1);
  assert.deepEqual(calls.creates[0], {
    recordId: "",
    ledgerId: "ledger",
    type: "expense",
    amount: 17.5,
    note: "午餐备注",
    tags: ["工作", "午餐"],
    date: "2026-03-12",
    categoryId: "lunch",
    categoryName: "午餐",
    categoryLabel: "午餐",
    categoryIcon: "bowl",
    parentCategory: "餐饮",
    parentIcon: "restaurant",
    account: "现金",
    syncVersion: 0,
  });
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.navigation[0].name, "navigateBack");
  assert.deepEqual(calls.toasts, []);
});

test("editing saves silently and returns only after cloud confirmation", async () => {
  let resolveUpdate;
  const { page, calls } = await readyPage({
    updateRecord: () =>
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
  });
  page.setData({ isEditing: true, recordId: "existing", syncVersion: 4 });
  const saving = page.saveAndLeave();
  assert.equal(page.data.saving, true);
  assert.equal(calls.navigation.length, 0);
  assert.deepEqual(calls.toasts, []);
  await page.saveAndLeave();
  assert.equal(calls.updates.length, 1);
  resolveUpdate();
  await saving;
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].recordId, "existing");
  assert.equal(calls.updates[0].syncVersion, 4);
  assert.equal(calls.navigation[0].name, "navigateBack");
  assert.deepEqual(calls.toasts, []);
});

test("editing failure preserves input and its error feedback while a retry saves silently", async () => {
  let failing = true;
  const { page, calls } = await readyPage({
    updateRecord: async () => {
      if (failing) throw new Error("network unavailable");
    },
  });
  page.setData({ isEditing: true, recordId: "existing", note: "保留备注" });
  const before = plain(page.data);
  await page.saveAndLeave();
  assert.deepEqual(plain(page.data), before);
  assert.equal(calls.navigation.length, 0);
  assert.equal(calls.toasts.length, 1);
  assert.equal(calls.toasts[0].type, "error");
  assert.match(calls.toasts[0].message, /输入已保留/);
  failing = false;
  await page.saveAndLeave();
  assert.equal(calls.updates.length, 2);
  assert.equal(calls.navigation.length, 1);
  assert.equal(calls.toasts.length, 1);
});

test("invalid, zero and negative expressions cannot save even when invoked directly", async () => {
  for (const value of ["", "12.", "2..3", "2-2", "2-3"]) {
    const { page, calls } = await readyPage();
    page.onAmountInput(input(value));
    assert.equal(page.data.canSave, false, value);
    await page.saveAndLeave();
    assert.equal(calls.creates.length, 0, value);
    assert.equal(page.data.amount, value);
    assert.equal(calls.toasts.at(-1).type, "warning");
  }
});

test("switching type or deleting selected category requires a fresh selection", async () => {
  const { page, calls } = await readyPage();
  page.switchType(dataset({ type: "income" }));
  assert.equal(page.data.categoryId, "");
  assert.equal(page.data.amount, "12.5+8-3");
  assert.equal(page.data.canSave, false);
  page.chooseCategory({ detail: { categoryId: "lunch" } });
  assert.equal(page.data.categoryId, "");
  page.chooseCategory({ detail: { categoryId: "pay" } });
  assert.equal(page.data.canSave, true);
  page.renderCategories(categories.filter((item) => item._id !== "pay"));
  await page.saveAndLeave();
  assert.equal(page.data.categoryId, "");
  assert.equal(page.data.canSave, false);
  assert.equal(calls.creates.length, 0);
});

test("inline selection uses category identity even when names are identical", async () => {
  const duplicateName = { ...categories[1], _id: "another-lunch" };
  const { page } = await readyPage({ listCategories: async () => [...categories, duplicateName] });
  assert.equal(page.data.categoryId, "lunch");
  page.chooseCategory({ detail: { categoryId: "another-lunch" } });
  assert.equal(page.data.categoryId, "another-lunch");
  assert.equal(page.data.categoryName, "午餐");
  page.renderCategories(categories);
  assert.equal(page.data.categoryId, "");
});

test("pending save blocks duplicate leave/continue submissions and category changes", async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const { page, calls } = await readyPage({ createRecord: () => pending });
  const first = page.saveAndLeave();
  assert.equal(page.data.saving, true);
  assert.deepEqual(calls.toasts, []);
  assert.equal(calls.navigation.length, 0);
  await page.saveAndContinue();
  await page.saveAndLeave();
  page.switchType(dataset({ type: "income" }));
  page.chooseCategory({ detail: { categoryId: "pay" } });
  assert.equal(page.data.type, "expense");
  assert.equal(page.data.categoryId, "lunch");
  assert.equal(calls.creates.length, 1);
  resolve({ recordId: "new" });
  await first;
  assert.equal(calls.navigation.length, 1);
  assert.deepEqual(calls.toasts, []);
});

test("save-and-continue resets entry fields and permits a deliberate second save", async () => {
  const { page, calls } = await readyPage();
  page.onNoteInput(input("备注"));
  page.onTagInput(input("待保存标签"));
  const retained = {
    categoryId: page.data.categoryId,
    date: page.data.date,
    ledgerId: page.data.ledgerId,
  };
  await page.saveAndContinue();
  assert.equal(calls.navigation.length, 0);
  for (const key of ["amount", "amountResult", "note", "tagInput"])
    assert.equal(page.data[key], "");
  assert.deepEqual(plain(page.data.tags), []);
  assert.equal(page.data.saving, false);
  assert.equal(page.data.canSave, false);
  for (const [key, value] of Object.entries(retained)) assert.equal(page.data[key], value);
  page.onAmountInput(input("0.1+0.2"));
  await page.saveAndContinue();
  assert.equal(calls.creates.length, 2);
  assert.equal(calls.creates[1].amount, 0.3);
  assert.deepEqual(calls.toasts, []);
});

test("service failure and conflict preserve all input and release saving for retry", async () => {
  for (const code of ["NETWORK_ERROR", "RECORD_CONFLICT"]) {
    let failing = true;
    const { page, calls } = await readyPage({
      createRecord: async () => {
        if (failing) throw Object.assign(new Error("failed"), { code });
      },
    });
    page.onNoteInput(input("不要丢失"));
    page.setData({ tags: ["已有"], tagInput: "新标签", accountIndex: 1 });
    const before = plain(page.data);
    await page.saveAndContinue();
    assert.deepEqual(plain(page.data), before);
    assert.equal(calls.navigation.length, 0);
    assert.equal(calls.toasts.at(-1).type, "error");
    assert.match(calls.toasts.at(-1).message, /输入已保留/);
    failing = false;
    await page.saveAndLeave();
    assert.equal(calls.creates.length, 2);
    assert.deepEqual(calls.creates[0], calls.creates[1]);
    assert.equal(calls.navigation.length, 1);
  }
});

test("readonly, category/family loading and error states block direct saves", async () => {
  for (const flag of [
    "readonly",
    "categoryLoading",
    "categoryError",
    "familyLoading",
    "familyError",
    "recordLoading",
    "recordLoadError",
    "deleting",
  ]) {
    const { page, calls } = await readyPage();
    page.setData({ [flag]: true });
    await page.saveAndLeave();
    assert.equal(calls.creates.length, 0, flag);
    assert.equal(calls.navigation.length, 0, flag);
  }
});

test("family context excludes visitors and personal expenses require a consumer", async () => {
  const { page, calls } = await readyPage({ ledger: { type: "shared" } });
  await page.loadFamilyContext("ledger");
  assert.deepEqual(
    Array.from(page.data.familyMembers, (item) => item.openid),
    ["", "self", "other"]
  );
  assert.deepEqual(
    Array.from(page.data.familyConsumers, (item) => item.openid),
    ["self", "other"]
  );
  assert.equal(page.data.familyConsumers[page.data.familyConsumerIndex].openid, "self");
  page.setData({ familyConsumers: [] });
  await page.saveAndLeave();
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.toasts.at(-1).message, "请选择消费归属成员");
  page.setData({
    familyConsumers: [
      { openid: "self", nickName: "我" },
      { openid: "other", nickName: "家人" },
    ],
  });
  page.changeFamilyPayer(input("2"));
  page.changeFamilyConsumer(input("1"));
  await page.saveAndContinue();
  assert.deepEqual(calls.creates[0].familyAttribution, {
    payerOpenid: "other",
    consumerKind: "personal",
    consumerOpenid: "other",
  });
});

test("non-personal family expenses clear consumer identity; income omits attribution", async () => {
  for (const [index, kind] of [
    [0, "unknown"],
    [2, "public"],
    [3, "multiple"],
  ]) {
    const { page, calls } = await readyPage({ ledger: { type: "shared" } });
    await page.loadFamilyContext("ledger");
    page.changeFamilyKind(input(String(index)));
    await page.saveAndContinue();
    assert.deepEqual(calls.creates[0].familyAttribution, {
      payerOpenid: "self",
      consumerKind: kind,
      consumerOpenid: "",
    });
    page.switchType(dataset({ type: "income" }));
    page.chooseCategory({ detail: { categoryId: "pay" } });
    page.onAmountInput(input("10"));
    await page.saveAndLeave();
    assert.equal(Object.hasOwn(calls.creates[1], "familyAttribution"), false);
  }
});

test("quick completion emits submit without amountinput or premature expression settlement", () => {
  const { component, events } = componentFixture({ quickEntry: true, amount: "12.5+8-3" });
  component.openKeypad();
  component.closeKeypad();
  assert.equal(events.length, 0);
  component.submit();
  assert.deepEqual(events, [{ name: "submit", detail: undefined }]);
  assert.equal(component.data.amount, "12.5+8-3");
  component.setData({ saving: true });
  component.submit();
  assert.equal(events.length, 1);
  component.setData({ saving: false, quickEntry: false });
  component.submit();
  assert.equal(events.length, 1);
});

test("legacy keypad confirmation settles expression and signals closing without submitting", () => {
  const { component, events } = componentFixture({ amount: "0.1+0.2" });
  component.openKeypad();
  assert.equal(component.data.showKeypad, true);
  component.closeKeypad();
  assert.equal(component.data.showKeypad, false);
  assert.deepEqual(events, [
    { name: "keypadchange", detail: { open: true } },
    { name: "amountinput", detail: { value: "0.3" } },
    { name: "keypadchange", detail: { open: false } },
  ]);
});

test("keypad edits emit controlled values with two-decimal precision", () => {
  const { component, events } = componentFixture({ quickEntry: true });
  component.pressDecimal();
  component.setData({ amount: "0.12" });
  component.pressNumber(dataset({ digit: "3" }));
  component.pressDecimal();
  component.setData({ amount: "12+" });
  component.pressOperator(dataset({ operator: "-" }));
  component.setData({ amount: "12-0" });
  component.pressNumber(dataset({ digit: "5" }));
  component.backspace();
  component.clearAmount();
  assert.deepEqual(
    events.map((event) => event.detail.value),
    ["0.", "0.12", "12-", "12-5", "12-", ""]
  );
});
