const listeners = new Set();
const deliveredMutations = new Set();
let queued = new Map();
let scheduled = false;

function normalizeLedgerIds(value) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [value]).map((item) => String(item || "")).filter(Boolean)
    )
  );
}

function flush() {
  scheduled = false;
  const events = Array.from(queued.values());
  queued = new Map();
  for (const event of events) {
    if (event.mutationId) deliveredMutations.add(event.mutationId);
    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.warn("data refresh listener failed", error);
      }
    });
  }
}

function queueFlush() {
  if (scheduled) return;
  scheduled = true;
  Promise.resolve().then(flush);
}

function invalidate(input = {}) {
  const mutationId = String(input.mutationId || "");
  if (mutationId && deliveredMutations.has(mutationId)) return;
  const ledgerIds = normalizeLedgerIds(input.ledgerIds || input.ledgerId);
  const scope = ledgerIds.join(",") || "all";
  const existing = queued.get(scope);
  const event = {
    ledgerIds,
    removedLedgerIds: normalizeLedgerIds(input.removedLedgerIds),
    source: String(input.source || "unknown"),
    mutationId,
    manual: Boolean(input.manual),
  };
  if (existing) {
    event.ledgerIds = normalizeLedgerIds([...existing.ledgerIds, ...event.ledgerIds]);
    event.removedLedgerIds = normalizeLedgerIds([
      ...existing.removedLedgerIds,
      ...event.removedLedgerIds,
    ]);
    event.source = `${existing.source},${event.source}`;
    event.mutationId = existing.mutationId || event.mutationId;
    event.manual = existing.manual || event.manual;
  }
  queued.set(event.ledgerIds.join(",") || "all", event);
  queueFlush();
}

function subscribe(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function clear() {
  queued = new Map();
  deliveredMutations.clear();
  scheduled = false;
}

module.exports = { invalidate, subscribe, clear };
