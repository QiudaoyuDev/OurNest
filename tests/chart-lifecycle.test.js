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

test("same-context refresh keeps the ec host and chart instance mounted", () => {
  let loading = false;
  const created = [];
  const controller = createChartController({
    canRender: () => !loading,
    createChart: () => {
      const instance = chart();
      created.push(instance);
      return instance;
    },
    getOption: () => ({ series: [{ data: [1] }] }),
  });
  const host = {
    setChart(value) {
      this.chart = value;
    },
  };

  const first = controller.mount("main", {
    canvas: host,
    component: host,
    width: 320,
    height: 180,
    generation: 1,
  });
  controller.update("main");
  loading = true;
  // The host remains mounted while its parent is hidden for refresh.
  assert.strictEqual(host.chart, first);
  assert.equal(controller.update("main"), false);
  assert.equal(created.length, 1);

  loading = false;
  assert.equal(controller.update("main"), true);
  assert.strictEqual(host.chart, first);
  assert.equal(created.length, 1);
  assert.equal(first.options.length, 2);
});

test("chart controller updates every mounted chart with the new option data", () => {
  const charts = [];
  const controller = createChartController({
    canRender: () => true,
    createChart: () => {
      const instance = chart();
      charts.push(instance);
      return instance;
    },
    getOption: (key, context) => ({ key, data: context.data }),
  });
  const mainCanvas = {};
  const secondaryCanvas = {};
  controller.mount("main", { canvas: mainCanvas, width: 300, height: 180, generation: 1 });
  controller.mount("category", {
    canvas: secondaryCanvas,
    width: 240,
    height: 140,
    generation: 1,
  });
  controller.update("main", { data: [1] });
  controller.update("category", { data: [2] });
  controller.update("main", { data: [3] });
  controller.update("category", { data: [4] });
  assert.deepEqual(charts[0].options.map(({ option }) => option.data), [[1], [3]]);
  assert.deepEqual(charts[1].options.map(({ option }) => option.data), [[2], [4]]);
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

test("chart controller disposes a node when its lifetime generation changes", () => {
  let visible = true;
  const created = [];
  const controller = createChartController({
    canRender: () => visible,
    createChart: () => {
      const instance = chart();
      created.push(instance);
      return instance;
    },
    getOption: () => ({ series: [{ data: [1] }] }),
  });
  const firstCanvas = {
    setChart(value) {
      this.chart = value;
    },
  };
  const first = controller.mount("main", {
    canvas: firstCanvas,
    width: 320,
    height: 180,
    component: firstCanvas,
    generation: 4,
  });
  controller.update("main");
  assert.equal(first.options.length, 1);

  const secondCanvas = {
    setChart(value) {
      this.chart = value;
    },
  };
  const second = controller.mount("main", {
    canvas: secondCanvas,
    width: 320,
    height: 180,
    component: secondCanvas,
    generation: 5,
  });
  assert.equal(created.length, 2);
  assert.equal(first.disposed, true);
  assert.equal(firstCanvas.chart, null);
  assert.equal(secondCanvas.chart, second);
  assert.notEqual(first, second);
});
