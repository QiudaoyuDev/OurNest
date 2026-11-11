const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

test("import preview sums selected cents and rejects confirmed duplicates", () => {
  const filename = path.resolve("miniprogram/pages/record-import/index.js");
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: createRequire(filename),
    getApp: () => ({}),
    Page: (value) => {
      definition = value;
    },
  });
  const page = {
    ...definition,
    data: {
      ...definition.data,
      previewRows: [
        { rowNumber: 1, type: "expense", amount: 0.1, selected: true },
        {
          rowNumber: 2,
          type: "expense",
          amount: 0.2,
          selected: true,
          categoryChoiceRequired: true,
        },
        { rowNumber: 3, type: "income", amount: 5, selected: false, confirmedDuplicate: true },
      ],
    },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
  };
  page.refreshPreviewSummary();
  assert.equal(page.data.previewSummary.expense, "0.30");
  assert.equal(page.data.previewSummary.count, 2);
  assert.equal(page.data.previewSummary.pending, 2);
  assert.equal(page.data.previewSummary.blocked, true);
  page.togglePreviewRow({ currentTarget: { dataset: { row: 3 } } });
  assert.equal(page.data.previewRows[2].selected, false);
});
