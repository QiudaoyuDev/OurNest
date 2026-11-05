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

function pageFixture({ ledger = {}, createRecord } = {}) {
  const calls = { creates: [], updates: [], toasts: [], navigation: [] };
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
        updateRecord: async (payload) => {
          calls.updates.push(plain(payload));
        },
      },
      "../../services/category.service": { listCategories: async () => categories },
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
      wx: Object.fromEntries(
        ["navigateBack", "navigateTo", "reLaunch"].map((name) => [
          name,
          (options) => calls.navigation.push({ name, options }),
        ])
      ),
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

test("pending save blocks duplicate leave/continue submissions and category changes", async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const { page, calls } = await readyPage({ createRecord: () => pending });
  const first = page.saveAndLeave();
  assert.equal(page.data.saving, true);
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
  assert.equal(page.data.familyMembers[page.data.familyConsumerIndex].openid, "self");
  page.changeFamilyConsumer(input("0"));
  await page.saveAndLeave();
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.toasts.at(-1).message, "请选择消费归属成员");
  page.changeFamilyPayer(input("2"));
  page.changeFamilyConsumer(input("1"));
  await page.saveAndContinue();
  assert.deepEqual(calls.creates[0].familyAttribution, {
    payerOpenid: "other",
    consumerKind: "personal",
    consumerOpenid: "self",
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
