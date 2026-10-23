// Cash application: suggest which open invoices each incoming payment pays.
//
// For every payment we build candidate explanations, each with a confidence score and reasons:
//   referenced   the memo names the invoice(s) and the amount fits
//   single       one invoice of this customer has exactly this amount
//   combination  several invoices of this customer add up exactly to the payment
//   discount     the payment equals the invoice(s) minus an early-payment discount (e.g. 2%)
//   short        the payment is a little less than the invoice(s): bank fee or deduction
//   other        exact amount, but the invoice belongs to a customer with a different name
//   oldest       nothing fits exactly: apply to this customer's oldest invoices (partial)
// Then payments are assigned in order of confidence, so no invoice is used twice.

import { nameInText, nameSimilarity, referencedInvoices } from "./names.js";

export const DEFAULTS = Object.freeze({
  feeToleranceCents: 5000, // payments up to $50 short count as "short" (wire fees, small deductions)
  discountRates: [0.01, 0.02],
  nameThreshold: 0.6,
  maxInvoicesPerPayment: 8,
  searchInvoices: 40, // per customer, oldest first
  nodeBudget: 200000,
});

export function band(confidence) {
  if (confidence === null || confidence === undefined) return "unmatched";
  if (confidence >= 90) return "certain";
  if (confidence >= 75) return "high";
  if (confidence >= 55) return "review";
  return "low";
}

const byAge = (a, b) => (a.due || a.date || "9999").localeCompare(b.due || b.date || "9999") || a.row - b.row;

// All subsets (up to `limit`) of `items` whose `value` sum lies in [lo, hi]. Items should be oldest
// first; solutions come back in search order, which prefers older invoices.
export function subsetSums(items, lo, hi, { maxItems = 8, limit = 6, nodeBudget = 200000, minItems = 1 } = {}) {
  const values = items.map((x) => x.value);
  const suffix = new Array(values.length + 1).fill(0);
  for (let i = values.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + Math.max(0, values[i]);
  const out = [];
  let nodes = 0;
  const chosen = [];
  let exhausted = true;
  (function dfs(start, sum) {
    if (out.length >= limit) return;
    if (++nodes > nodeBudget) {
      exhausted = false;
      return;
    }
    if (sum >= lo && sum <= hi && chosen.length >= minItems) out.push(chosen.map((i) => items[i]));
    if (chosen.length >= maxItems) return;
    for (let i = start; i < values.length; i++) {
      if (sum + suffix[i] < lo) return; // even taking everything left is not enough
      if (sum + values[i] > hi) continue;
      chosen.push(i);
      dfs(i + 1, sum + values[i]);
      chosen.pop();
      if (out.length >= limit || nodes > nodeBudget) return;
    }
  })(0, 0);
  return { solutions: out, exhausted };
}

const sumOpen = (invs) => invs.reduce((s, i) => s + i.openCents, 0);

function candidate(kind, invoices, payment, confidence, reasons, applied) {
  const total = sumOpen(invoices);
  return {
    kind,
    invoices,
    applied: applied || invoices.map((i) => i.openCents),
    diffCents: payment.amountCents - total, // < 0 short, > 0 overpaid
    confidence: Math.max(1, Math.min(99, Math.round(confidence))),
    reasons,
  };
}

function oldestFirst(invoices, amount) {
  const applied = [];
  const used = [];
  let left = amount;
  for (const inv of invoices) {
    if (left <= 0) break;
    const take = Math.min(left, inv.openCents);
    used.push(inv);
    applied.push(take);
    left -= take;
  }
  return { used, applied };
}

export function candidatesFor(payment, invoices, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const amount = payment.amountCents;
  const open = invoices.filter((i) => i.openCents > 0);
  const out = [];

  // Customers whose name resembles the payer
  const customers = new Map();
  for (const inv of open) if (!customers.has(inv.customer)) customers.set(inv.customer, []);
  for (const inv of open) customers.get(inv.customer).push(inv);
  // Bank exports often have no payer column: the name is inside the description.
  const description = `${payment.payer || ""} ${payment.memo || ""}`;
  const similar = [...customers.keys()]
    .map((c) => ({
      customer: c,
      sim: Math.max(payment.payer ? nameSimilarity(payment.payer, c) : 0, nameInText(c, description)),
    }))
    .filter((x) => x.sim >= o.nameThreshold)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 3);

  const refs = referencedInvoices(`${payment.memo || ""} ${payment.payer || ""}`, open);
  const weakIds = new Set(refs.weak.map((i) => i.row));

  // 1. The memo names the invoices
  if (refs.strong.length) {
    const invs = [...refs.strong].sort(byAge);
    const total = sumOpen(invs);
    const names = invs.map((i) => i.number).join(", ");
    const discountRate = o.discountRates.find((r) => Math.abs(invs.reduce((s, i) => s + Math.round(i.openCents * (1 - r)), 0) - amount) <= 1);
    if (total === amount) {
      out.push(candidate("referenced", invs, payment, 98, [["refExact", names]]));
    } else if (discountRate) {
      out.push(candidate("referenced", invs, payment, 94, [["refExact", names], ["discount", Math.round(discountRate * 100), total - amount]],
        invs.map((i) => Math.round(i.openCents * (1 - discountRate)))));
    } else if (total > amount && total - amount <= o.feeToleranceCents) {
      out.push(candidate("referenced", invs, payment, 86, [["refExact", names], ["short", total - amount]]));
    } else if (total > amount) {
      const { used, applied } = oldestFirst(invs, amount);
      out.push(candidate("referenced", used, payment, 72, [["refPartial", names]], applied));
    } else {
      out.push(candidate("referenced", invs, payment, 74, [["refExact", names], ["over", amount - total]]));
    }
  }

  // 1b. Short invoice numbers in the memo ("INV 440 444") that together equal the payment
  if (refs.weak.length >= 1 && !refs.strong.length) {
    const invs = [...refs.weak].sort(byAge);
    if (sumOpen(invs) === amount) {
      out.push(candidate("referenced", invs, payment, invs.length === 1 ? 93 : 92, [["refHint", invs.map((i) => i.number).join(", ")], ["refSum"]]));
    }
  }

  // 2. Per similar customer: single invoice, combination, discount, short payment
  for (const { customer, sim } of similar) {
    const invs = customers.get(customer).slice().sort(byAge).slice(0, o.searchInvoices);
    const factor = 0.7 + 0.3 * sim;
    const nameReason = ["name", customer, sim];
    const items = invs.map((inv) => ({ ...inv, value: inv.openCents }));
    const opts = { maxItems: o.maxInvoicesPerPayment, nodeBudget: o.nodeBudget };

    const singles = invs.filter((i) => i.openCents === amount);
    if (singles.length === 1) {
      const hinted = weakIds.has(singles[0].row);
      out.push(candidate("single", singles, payment, (hinted ? 96 : 92) * factor,
        [nameReason, ["single"], ...(hinted ? [["refHint", singles[0].number]] : [])]));
    } else if (singles.length > 1) {
      const hinted = singles.find((i) => weakIds.has(i.row));
      const pick = hinted || singles[0];
      out.push(candidate("single", [pick], payment, (hinted ? 88 : 70) * factor,
        [nameReason, ["sameAmount", singles.length], hinted ? ["refHint", pick.number] : ["oldestChosen"]]));
      for (const other of singles) if (other !== pick) out.push(candidate("single", [other], payment, 60 * factor, [nameReason, ["sameAmount", singles.length]]));
    }

    const combos = subsetSums(items, amount, amount, { ...opts, minItems: 2 });
    const ranked = combos.solutions
      .map((sol) => ({ sol, hits: sol.filter((i) => weakIds.has(i.row)).length }))
      .sort((a, b) => b.hits - a.hits);
    ranked.forEach(({ sol, hits }, idx) => {
      const unique = ranked.length === 1 && combos.exhausted;
      const conf = unique ? 88 : idx === 0 ? (hits ? 80 : 66) : 55;
      const reasons = [nameReason, ["combination", sol.length]];
      if (!unique) reasons.push(["otherCombos", ranked.length]);
      if (hits) reasons.push(["refHint", sol.filter((i) => weakIds.has(i.row)).map((i) => i.number).join(", ")]);
      out.push(candidate("combination", sol, payment, conf * factor, reasons));
    });

    for (const rate of o.discountRates) {
      const disc = items.map((i) => ({ ...i, value: Math.round(i.openCents * (1 - rate)) }));
      const found = subsetSums(disc, amount - 1, amount + 1, { ...opts, limit: 2 });
      for (const sol of found.solutions) {
        const pct = Math.round(rate * 100);
        out.push(candidate("discount", sol, payment, (found.solutions.length === 1 ? 80 : 62) * factor,
          [nameReason, ["discount", pct, sumOpen(sol) - amount]],
          sol.map((i) => Math.round(i.openCents * (1 - rate)))));
      }
    }

    if (o.feeToleranceCents > 0) {
      const short = subsetSums(items, amount + 1, amount + o.feeToleranceCents, { ...opts, limit: 3 });
      short.solutions
        .sort((a, b) => sumOpen(a) - sumOpen(b))
        .forEach((sol, idx) => {
          out.push(candidate("short", sol, payment, (idx === 0 && short.solutions.length === 1 ? 70 : 58) * factor,
            [nameReason, ["short", sumOpen(sol) - amount]], applyShort(sol, amount)));
        });
    }

    const { used, applied } = oldestFirst(invs, amount);
    if (used.length) {
      const leftover = amount - applied.reduce((a, b) => a + b, 0);
      out.push(candidate("oldest", used, payment, 40 * factor,
        [nameReason, leftover > 0 ? ["overOldest", leftover] : ["partialOldest"]], applied));
    }
  }

  // 3. Exact amount on another customer's invoice
  const others = open.filter((i) => i.openCents === amount && !similar.some((s) => s.customer === i.customer));
  for (const inv of others.slice(0, 3)) {
    out.push(candidate("other", [inv], payment, others.length === 1 ? (weakIds.has(inv.row) ? 70 : 50) : 35,
      [["otherCustomer", inv.customer], ...(weakIds.has(inv.row) ? [["refHint", inv.number]] : [])]));
  }

  // Best first; drop exact duplicates (same invoice set) keeping the most confident.
  out.sort((a, b) => b.confidence - a.confidence);
  const seen = new Set();
  return out.filter((c) => {
    const key = c.invoices.map((i) => i.row).sort((x, y) => x - y).join(",") + ":" + c.applied.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// A short payment: pay invoices fully, oldest first, and leave the shortfall on the last one.
function applyShort(invoices, amount) {
  let left = amount;
  return invoices.map((inv, i) => {
    const take = i === invoices.length - 1 ? left : Math.min(left, inv.openCents);
    left -= take;
    return take;
  });
}

export function matchPayments(payments, invoices, options = {}) {
  const incoming = payments.filter((p) => p.amountCents > 0);
  const all = incoming.map((p) => ({ payment: p, candidates: candidatesFor(p, invoices, options) }));
  const order = [...all].sort((a, b) => (b.candidates[0]?.confidence || 0) - (a.candidates[0]?.confidence || 0));
  const usedBy = new Map(); // invoice row -> payment
  const results = new Map();

  for (const entry of order) {
    const free = entry.candidates.filter((c) => c.invoices.every((i) => !usedBy.has(i.row)));
    const chosen = free[0] || null;
    if (chosen) for (const inv of chosen.invoices) usedBy.set(inv.row, entry.payment);
    const blocked = entry.candidates.length && !chosen
      ? [...new Set(entry.candidates.flatMap((c) => c.invoices).map((i) => usedBy.get(i.row)).filter(Boolean))]
      : [];
    results.set(entry.payment, {
      payment: entry.payment,
      chosen,
      alternatives: free.slice(1, 4),
      band: band(chosen ? chosen.confidence : null),
      blockedBy: blocked,
    });
  }

  const list = incoming.map((p) => results.get(p));
  const appliedCents = list.reduce((s, r) => s + (r.chosen ? r.chosen.applied.reduce((a, b) => a + b, 0) : 0), 0);
  const receivedCents = incoming.reduce((s, p) => s + p.amountCents, 0);
  const openAfter = invoices.filter((i) => i.openCents > 0 && !usedBy.has(i.row));
  return {
    results: list,
    summary: {
      payments: incoming.length,
      skipped: payments.length - incoming.length,
      matched: list.filter((r) => r.chosen).length,
      byBand: ["certain", "high", "review", "low", "unmatched"].reduce((acc, b) => ({ ...acc, [b]: list.filter((r) => r.band === b).length }), {}),
      receivedCents,
      appliedCents,
      unappliedCents: receivedCents - appliedCents,
      invoicesStillOpen: openAfter.length,
    },
  };
}
