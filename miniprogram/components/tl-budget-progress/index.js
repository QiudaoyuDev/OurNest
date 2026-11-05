Component({
  properties: {
    enabled: { type: Boolean, value: false },
    rate: { type: Number, value: 0 },
  },
  data: {
    barStyle: "width: 0%",
    statusClass: "safe",
  },
  observers: {
    rate(value) {
      const rate = Number(value);
      const width = Number.isFinite(rate) ? Math.max(0, Math.min(100, rate)) : 0;
      const statusClass =
        rate >= 90 ? "danger" : rate >= 70 ? "warning" : rate >= 50 ? "attention" : "safe";
      this.setData({
        barStyle: `width: ${Number(width.toFixed(2))}%`,
        statusClass,
      });
    },
  },
});
