// Company names as banks print them ("ABC MKT LLC", "Abc Market, Inc.") and invoice numbers as
// customers write them in payment memos ("inv 412", "INV-2026-0412", "#412 #415").

const LEGAL = new Set([
  "llc", "l l c", "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "lp", "llp", "plc",
  "pllc", "pc", "gmbh", "ag", "sa", "srl", "bv", "nv", "the",
  "as", "a s", "sti", "ltd sti", "san", "tic", "ve", "ltd sti", "sirketi", "limited sirketi", "anonim",
]);

// Each abbreviation stands for one or more full words ("st" can be street or saint).
const ABBREVIATIONS = {
  mkt: ["market"], mkts: ["markets"], mrkt: ["market"], intl: ["international"], natl: ["national"],
  svc: ["services", "service"], svcs: ["services"], dist: ["distribution", "distributors"], distr: ["distribution"],
  grp: ["group"], mfg: ["manufacturing"], assoc: ["associates"], bros: ["brothers"], ctr: ["center"],
  centre: ["center"], st: ["street", "saint"], ave: ["avenue"], rest: ["restaurant"], rstrnt: ["restaurant"],
  bkry: ["bakery"], gro: ["grocery", "grocers"], groc: ["grocery", "grocers"], fds: ["foods"], mgmt: ["management"],
};

// Words in bank transaction descriptions that never belong to a payer name.
const BANK_NOISE = new Set([
  "check", "chk", "deposit", "dep", "mobile", "remote", "ach", "credit", "cr", "wire", "in", "incoming", "transfer",
  "xfer", "payment", "pmt", "pymt", "paid", "inv", "invoice", "invoices", "ref", "from", "ccd", "ppd", "ctx", "web",
  "online", "zelle", "orig", "co", "id", "name", "for", "of", "no", "nr", "eft", "bank", "branch", "item", "items",
  "havale", "eft", "gelen", "odeme", "tahsilat", "fatura",
]);

function sameWord(a, b) {
  if (a === b) return true;
  if ((ABBREVIATIONS[a] || []).includes(b) || (ABBREVIATIONS[b] || []).includes(a)) return true;
  return a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)); // "grocer" / "grocers"
}

function rawTokens(text) {
  return fold(text).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

// How much of a customer's name appears inside a free-text description, 0..1.
// The first word of the name counts double: "Pine Street Pantry" in "PINE ST PANTRY" = 1,
// "Lakeview Deli & Catering" in "WIRE IN LAKEVIEW DELI" = 0.75.
export function nameInText(customer, text) {
  const name = companyTokens(customer);
  const words = rawTokens(text).filter((w) => !BANK_NOISE.has(w) && !/^\d+$/.test(w));
  if (!name.length || !words.length) return 0;
  let got = 0;
  let total = 0;
  name.forEach((w, i) => {
    const weight = i === 0 ? 2 : 1;
    total += weight;
    if (words.some((x) => sameWord(w, x))) got += weight;
  });
  if (!words.some((x) => sameWord(name[0], x))) return Math.min(0.5, got / total); // first word is required
  return Math.round((got / total) * 1000) / 1000;
}

export function fold(text) {
  return String(text || "")
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i");
}

export function companyTokens(name) {
  const words = rawTokens(name).map((w) => (ABBREVIATIONS[w] ? ABBREVIATIONS[w][0] : w));
  const kept = words.filter((w) => !LEGAL.has(w) && w !== "and");
  return kept.length ? kept : words;
}

function bigrams(s) {
  const out = new Map();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

// 0..1. Dice coefficient on character bigrams of the cleaned names, boosted when one name's words
// are all contained in the other ("ABC" vs "ABC Market").
export function nameSimilarity(a, b) {
  const ta = companyTokens(a);
  const tb = companyTokens(b);
  if (!ta.length || !tb.length) return 0;
  const sa = ta.join(" ");
  const sb = tb.join(" ");
  if (sa === sb) return 1;
  const A = bigrams(sa);
  const B = bigrams(sb);
  let overlap = 0;
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) || 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  let score = (2 * overlap) / total;
  const setA = new Set(ta);
  const setB = new Set(tb);
  const contained = ta.every((w) => setB.has(w)) || tb.every((w) => setA.has(w));
  if (contained) score = Math.max(score, 0.85);
  // first word differs completely: likely different companies ("Acme Foods" vs "Zenith Foods")
  if (ta[0] !== tb[0] && !ta[0].startsWith(tb[0]) && !tb[0].startsWith(ta[0])) score *= 0.75;
  return Math.round(score * 1000) / 1000;
}

// Canonical forms of an invoice number: the full code and its last group of digits without zeros.
export function invoiceKeys(number) {
  const s = fold(number);
  const full = s.replace(/[^a-z0-9]/g, "");
  const digits = s.match(/\d+/g) || [];
  const last = digits.length ? String(Number(digits[digits.length - 1])) : "";
  return { full, last };
}

// Find which of the given invoices a memo refers to.
//   strong: the full invoice code appears ("INV20260412" in "PAYMENT INV-2026-0412")
//   weak:   only its trailing number appears as a separate number ("inv 412"), and only if
//           that number identifies exactly one candidate invoice
export function referencedInvoices(memo, invoices) {
  if (!memo) return { strong: [], weak: [] };
  const text = fold(memo);
  const compact = text.replace(/[^a-z0-9]/g, "");
  const numbers = new Set((text.match(/\d+/g) || []).map((n) => String(Number(n))));
  const strong = [];
  const byLast = new Map();
  for (const inv of invoices) {
    const k = invoiceKeys(inv.number);
    if (k.full.length >= 4 && /\d/.test(k.full) && compact.includes(k.full)) strong.push(inv);
    else if (k.last && k.last.length >= 2) {
      if (!byLast.has(k.last)) byLast.set(k.last, []);
      byLast.get(k.last).push(inv);
    }
  }
  const weak = [];
  for (const n of numbers) {
    const list = byLast.get(n);
    if (list && list.length === 1 && !strong.includes(list[0])) weak.push(list[0]);
  }
  return { strong, weak };
}
