function monthAnchor() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dateAnchor() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatAnalysisRangeLabel(mode, anchor, fallback = "") {
  if (mode === "month" && /^\d{4}-\d{2}$/.test(anchor)) {
    return `${anchor.slice(0, 4)}年${anchor.slice(5, 7)}月`;
  }
  if (mode === "year" && /^\d{4}$/.test(anchor)) return `${anchor}年`;
  if (mode === "week") {
    if (fallback) return fallback;
    if (/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return `${anchor.slice(5)} 当周`;
    return "本周";
  }
  if (mode === "all") return "全部时间";
  return fallback;
}

function customRangeDefaults() {
  const end = dateAnchor();
  return { start: `${end.slice(0, 8)}01`, end };
}

function getPresetRange(type) {
  const now = new Date();
  const format = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const end = format(now);
  if (type === "7d") {
    const d = new Date(now.getTime() - 6 * 86400000);
    return { start: format(d), end, preset: "7d" };
  }
  if (type === "30d") {
    const d = new Date(now.getTime() - 29 * 86400000);
    return { start: format(d), end, preset: "30d" };
  }
  if (type === "month") {
    return { start: `${end.slice(0, 8)}01`, end, preset: "month" };
  }
  if (type === "year") {
    return { start: `${now.getFullYear()}-01-01`, end, preset: "year" };
  }
  return customRangeDefaults();
}

function getDaysCount(start, end) {
  if (!start || !end) return 0;
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

function isCurrentMonthAnchor(anchor) {
  return anchor === monthAnchor();
}

function isCurrentYearAnchor(anchor) {
  return Number(anchor) === new Date().getFullYear();
}

function shiftMonth(anchor, delta) {
  const [year, month] = String(anchor || monthAnchor())
    .split("-")
    .map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

module.exports = {
  monthAnchor,
  dateAnchor,
  formatAnalysisRangeLabel,
  customRangeDefaults,
  getPresetRange,
  getDaysCount,
  isCurrentMonthAnchor,
  isCurrentYearAnchor,
  shiftMonth,
};
