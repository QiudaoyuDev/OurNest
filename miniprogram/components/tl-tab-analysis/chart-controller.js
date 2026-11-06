function createChartController({ canRender, createChart, getOption, onChartEvent } = {}) {
  const entries = new Map();

  function clearWrapper(entry) {
    if (entry && entry.component && typeof entry.component.setChart === "function")
      entry.component.setChart(null);
  }

  function dispose(key) {
    const entry = entries.get(key);
    if (!entry) return;
    if (entry.chart && typeof entry.chart.off === "function" && entry.clickHandler)
      entry.chart.off("click", entry.clickHandler);
    if (entry.chart && typeof entry.chart.dispose === "function") entry.chart.dispose();
    if (entry.canvas && typeof entry.canvas.setChart === "function") entry.canvas.setChart(null);
    clearWrapper(entry);
    entries.delete(key);
  }

  function mount(key, descriptor = {}) {
    const { canvas, width, height, dpr, component, generation } = descriptor;
    if (!canRender || !canRender() || !canvas || !width || !height) {
      const existing = entries.get(key);
      if (existing) existing.state = "waitingVisible";
      return null;
    }
    const existing = entries.get(key);
    if (existing && existing.canvas === canvas && existing.generation === generation) {
      existing.state = "ready";
      return existing.chart;
    }
    dispose(key);
    const chart = createChart(canvas, width, height, dpr);
    if (!chart) return null;
    const entry = { key, canvas, component, chart, generation, width, height, state: "ready" };
    entry.clickHandler = (params) => {
      if (entries.get(key) !== entry || entry.state !== "ready") return;
      onChartEvent && onChartEvent(key, params);
    };
    if (typeof canvas.setChart === "function") canvas.setChart(chart);
    if (component && typeof component.setChart === "function") component.setChart(chart);
    if (typeof chart.on === "function") chart.on("click", entry.clickHandler);
    entries.set(key, entry);
    return chart;
  }

  function update(key, context) {
    const entry = entries.get(key);
    if (!entry || entry.state !== "ready" || !canRender || !canRender()) return false;
    const option = getOption && getOption(key, context);
    if (!option || typeof entry.chart.setOption !== "function") return false;
    entry.chart.setOption(option, true);
    return true;
  }

  function resize(key, width, height) {
    const entry = entries.get(key);
    if (!entry || entry.state !== "ready" || !width || !height) return false;
    entry.width = width;
    entry.height = height;
    if (typeof entry.chart.resize === "function") entry.chart.resize({ width, height });
    return true;
  }

  function disposeAll() {
    Array.from(entries.keys()).forEach(dispose);
  }

  return {
    mount,
    update,
    resize,
    dispose,
    disposeAll,
    get: (key) => entries.get(key),
    size: () => entries.size,
  };
}

module.exports = { createChartController };
