const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createChartController,
} = require("../miniprogram/components/tl-tab-analysis/chart-controller");

function chart() {
  return {
    options: [],
    disposed: false,
    events: {},
    on(name, listener) {
      this.events[name] = listener;
    },
    off(name) {
      delete this.events[name];
    },
    setOption(option, replace) {
      this.options.push({ option, replace });
    },
    dispose() {
      this.disposed = true;
    },
  };
}

test("chart controller binds canvas and wrapper once for a stable node", () => {
  let visible = true;
  const created = [];
  const events = [];
  const controller = createChartController({
    canRender: () => visible,
    createChart: () => {
      const instance = chart();
      created.push(instance);
      return instance;
    },
    getOption: (key) => ({ key }),
    onChartEvent: (key, params) => events.push({ key, params }),
  });
  const canvas = {
    setChart(value) {
      this.chart = value;
    },
  };
  const component = {
    setChart(value) {
      this.chart = value;
    },
  };
  const first = controller.mount("main", {
    canvas,
    width: 300,
    height: 200,
    component,
    generation: 1,
  });
  assert.equal(created.length, 1);
  assert.equal(canvas.chart, first);
  assert.equal(component.chart, first);
  assert.equal(controller.update("main"), true);
  assert.deepEqual(first.options, [{ option: { key: "main" }, replace: true }]);
  assert.equal(
    controller.mount("main", { canvas, width: 300, height: 200, component, generation: 1 }),
    first
  );
  assert.equal(created.length, 1);
  first.events.click({ dataIndex: 1 });
  assert.deepEqual(events, [{ key: "main", params: { dataIndex: 1 } }]);

  visible = false;
  assert.equal(controller.update("main"), false);
  controller.dispose("main");
  assert.equal(first.disposed, true);
  assert.equal(canvas.chart, null);
  assert.equal(component.chart, null);
});

test("chart controller does not initialize zero-size or hidden nodes", () => {
  const controller = createChartController({
    canRender: () => false,
    createChart: () => {
      throw new Error("must not initialize");
    },
  });
  assert.equal(controller.mount("main", { canvas: {}, width: 0, height: 100 }), null);
  assert.equal(controller.size(), 0);
});
