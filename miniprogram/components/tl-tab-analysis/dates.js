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
  return fallback;
}

function customRangeDefaults() {
  const end = dateAnchor();
  return { start: `${end.slice(0, 8)}01`, end };
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
  isCurrentMonthAnchor,
  isCurrentYearAnchor,
  shiftMonth,
};
