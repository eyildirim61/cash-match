import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { guessColumns, INVOICE_FIELDS, PAYMENT_FIELDS } from "../src/columns.js";
import { readTable, toInvoices, toPayments } from "../src/data.js";
import { band, candidatesFor, matchPayments, subsetSums } from "../src/match.js";
import { invoiceKeys, nameInText, nameSimilarity, referencedInvoices } from "../src/names.js";
import { formatMoney, parseCsv, parseDate, parseMoney, toCsv } from "../src/table.js";

const sample = (name) => readFileSync(new URL(`../samples/${name}`, import.meta.url), "utf8");

// --- table ----------------------------------------------------------------------------

test("money in every common format, as integer cents", () => {
  const cases = {
    "1,234.56": 123456, "$1,234.56": 123456, "1.234,56": 123456, "1234.5": 123450, "12,5": 1250,
    "1,234": 123400, "1.234.567": 123456700, "(250.00)": -25000, "-250": -25000, "250-": -25000,
    "USD 1,000.00": 100000, "1 234,50 TL": 123450, "0.1": 10, "3,087.00": 308700, "1.005,00": 100500, "10.005": 1000500, // one dot + 3 digits = thousands
  };
  for (const [text, cents] of Object.entries(cases)) assert.equal(parseMoney(text), cents, text);
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney("abc"), null);
  assert.equal(parseMoney(19.99), 1999);
});

test("formatMoney", () => {
  assert.equal(formatMoney(123456), "1,234.56");
  assert.equal(formatMoney(123456, "tr"), "1.234,56");
  assert.equal(formatMoney(-500, "en", "$"), "-$5.00");
});

test("dates: ISO, US, day-first and Excel serials", () => {
  assert.equal(parseDate("2026-10-14"), "2026-10-14");
  assert.equal(parseDate("10/14/2026"), "2026-10-14");
  assert.equal(parseDate("14.10.2026"), "2026-10-14");
  assert.equal(parseDate("03/04/2026", { dayFirst: true }), "2026-04-03");
  assert.equal(parseDate("25/10/26"), "2026-10-25");
  assert.equal(parseDate(46309), "2026-10-14");
  assert.equal(parseDate("soon"), null);
});

test("CSV with quotes, embedded commas and semicolons", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  assert.deepEqual(parseCsv("a;b\n1,5;2\n"), [["a", "b"], ["1,5", "2"]]);
  assert.equal(toCsv([["a", "b,c"]]), 'a,"b,c"\r\n');
});

// --- columns --------------------------------------------------------------------------

test("columns from bank, Odoo, QuickBooks and Turkish exports", () => {
  assert.deepEqual(guessColumns(["Posting Date", "Description", "Check Number", "Amount"], PAYMENT_FIELDS),
    { amount: 3, date: 0, memo: 1, check: 2 });
  assert.deepEqual(guessColumns(["Number", "Partner", "Invoice Date", "Due Date", "Total", "Amount Due"], INVOICE_FIELDS),
    { number: 0, customer: 1, open: 5, total: 4, date: 2, due: 3 });
  assert.deepEqual(guessColumns(["Num", "Customer", "Date", "Due Date", "Amount", "Open Balance"], INVOICE_FIELDS),
    { number: 0, customer: 1, open: 5, total: 4, date: 2, due: 3 });
  const tr = guessColumns(["Fatura No", "Cari", "Fatura Tarihi", "Vade", "Kalan Tutar (TL)"], INVOICE_FIELDS);
  assert.deepEqual([tr.number, tr.customer, tr.open, tr.due], [0, 1, 4, 3]);
});

test("invoice list without an open-amount column uses the total", () => {
  const t = readTable("Invoice,Customer,Amount\nA-1,X Co,100.00\n");
  const { records, missing } = toInvoices(t);
  assert.deepEqual(missing, []);
  assert.equal(records[0].openCents, 10000);
});

test("rows with unreadable amounts are reported, not silently dropped", () => {
  const { records, problems } = toPayments(readTable("Amount,Description\n12.00,ok\nn/a,bad\n,empty\n"));
  assert.equal(records.length, 1);
  assert.deepEqual(problems, [{ row: 3, value: "n/a" }]);
});

// --- names ----------------------------------------------------------------------------

test("company name similarity", () => {
  assert.equal(nameSimilarity("ABC Market LLC", "abc market, inc."), 1);
  assert.ok(nameSimilarity("Harbor Point Mkt", "Harbor Point Market Inc.") >= 0.85);
  assert.ok(nameSimilarity("Acme Foods", "Zenith Foods") < 0.6);
  assert.ok(nameSimilarity("Yıldız Gıda Ltd. Şti.", "YILDIZ GIDA LIMITED SIRKETI") >= 0.85);
});

test("customer name inside a bank description", () => {
  assert.equal(nameInText("Harbor Point Market Inc.", "CHECK DEPOSIT HARBOR POINT MKT INV 412"), 1);
  assert.equal(nameInText("Pine Street Pantry", "CHECK DEPOSIT PINE ST PANTRY"), 1);
  assert.equal(nameInText("Lakeview Deli & Catering", "WIRE IN LAKEVIEW DELI"), 0.75);
  assert.ok(nameInText("Northgate Foods", "ACH CREDIT SOUTHGATE FOODS") <= 0.5); // first word must match
  assert.equal(nameInText("Brightside Grocers LLC", "MOBILE DEPOSIT R. KAPLAN"), 0);
});

test("invoice references in memos", () => {
  assert.deepEqual(invoiceKeys("INV/2026/0412"), { full: "inv20260412", last: "412" });
  const invs = [{ number: "INV/2026/0412" }, { number: "INV/2026/0419" }, { number: "INV/2025/0412" }];
  assert.deepEqual(referencedInvoices("PMT INV-2026-0412", invs).strong.map((i) => i.number), ["INV/2026/0412"]);
  // "412" alone is ambiguous (2025 and 2026 both end in 412): not used
  assert.deepEqual(referencedInvoices("inv 412", invs).weak, []);
  assert.deepEqual(referencedInvoices("inv 419", invs).weak.map((i) => i.number), ["INV/2026/0419"]);
});

// --- matching -------------------------------------------------------------------------

const inv = (row, number, customer, open, due = `2026-10-${String(row).padStart(2, "0")}`) =>
  ({ row, number, customer, openCents: Math.round(open * 100), due });
const pay = (amount, memo, payer = "") => ({ row: 2, amountCents: Math.round(amount * 100), memo, payer, id: "p" });

test("subset sums find combinations, oldest first, within budget", () => {
  const items = [5, 3, 2, 8].map((value, i) => ({ value, i }));
  const { solutions, exhausted } = subsetSums(items, 10, 10, { minItems: 2 });
  assert.deepEqual(solutions.map((s) => s.map((x) => x.value)), [[5, 3, 2], [2, 8]]);
  assert.ok(exhausted);
  const big = Array.from({ length: 40 }, () => ({ value: 1000 }));
  assert.equal(subsetSums(big, 20500, 20500, { nodeBudget: 500 }).exhausted, false); // impossible target, big search
});

test("single exact invoice of the named customer", () => {
  const invoices = [inv(1, "A-1", "Acme Foods", 100), inv(2, "A-2", "Acme Foods", 250)];
  const [best] = candidatesFor(pay(250, "ACH CREDIT ACME FOODS"), invoices);
  assert.equal(best.kind, "single");
  assert.equal(best.invoices[0].number, "A-2");
  assert.equal(band(best.confidence), "certain");
});

test("one payment covering several invoices", () => {
  const invoices = [inv(1, "B-1", "Brightside", 520), inv(2, "B-2", "Brightside", 1010), inv(3, "B-3", "Brightside", 845.25)];
  const [best] = candidatesFor(pay(1530, "DEPOSIT BRIGHTSIDE"), invoices);
  assert.equal(best.kind, "combination");
  assert.deepEqual(best.invoices.map((i) => i.number), ["B-1", "B-2"]);
});

test("early-payment discount and short payments", () => {
  const invoices = [inv(1, "N-1", "Northgate Foods", 3150)];
  const [disc] = candidatesFor(pay(3087, "NORTHGATE FOODS"), invoices);
  assert.equal(disc.kind, "discount");
  assert.equal(disc.diffCents, -6300);
  const [short] = candidatesFor(pay(3125, "NORTHGATE FOODS"), invoices);
  assert.equal(short.kind, "short");
  assert.equal(short.applied[0], 312500);
  const [none] = candidatesFor(pay(3000, "NORTHGATE FOODS"), invoices, { feeToleranceCents: 5000 });
  assert.equal(none.kind, "oldest"); // $150 short is beyond the fee tolerance: only a partial suggestion
});

test("memo with the full invoice number wins even without a name", () => {
  const invoices = [inv(1, "INV-7781", "Zed Ltd", 400), inv(2, "INV-7790", "Other Co", 400)];
  const [best] = candidatesFor(pay(400, "PAYMENT FOR INV-7790"), invoices);
  assert.equal(best.kind, "referenced");
  assert.equal(best.invoices[0].number, "INV-7790");
  assert.equal(band(best.confidence), "certain");
});

test("same amount on another customer is only a weak suggestion", () => {
  const invoices = [inv(1, "H-1", "Harbor Point", 388.4)];
  const [best] = candidatesFor(pay(388.4, "MOBILE DEPOSIT R. KAPLAN"), invoices);
  assert.equal(best.kind, "other");
  assert.equal(band(best.confidence), "low");
});

test("assignment never uses an invoice twice", () => {
  const invoices = [inv(1, "L-1", "Lakeview Deli", 2500)];
  const payments = [pay(2500, "WIRE LAKEVIEW DELI"), { ...pay(2500, "WIRE LAKEVIEW DELI"), row: 3 }];
  const { results, summary } = matchPayments(payments, invoices);
  assert.equal(results.filter((r) => r.chosen).length, 1);
  const loser = results.find((r) => !r.chosen);
  assert.equal(loser.band, "unmatched");
  assert.equal(loser.blockedBy.length, 1);
  assert.equal(summary.invoicesStillOpen, 0);
});

test("outgoing amounts are skipped", () => {
  const { summary } = matchPayments([pay(-15, "SERVICE FEE")], [inv(1, "X", "Y", 15)]);
  assert.deepEqual([summary.payments, summary.skipped], [0, 1]);
});

test("the sample files: every designed case lands where it should", () => {
  const payments = toPayments(readTable(sample("bank-deposits.csv"))).records;
  const invoices = toInvoices(readTable(sample("open-invoices.csv"))).records;
  const { results, summary } = matchPayments(payments, invoices);
  const by = (needle) => results.find((r) => r.payment.memo.includes(needle));
  const nums = (r) => r.chosen.invoices.map((i) => i.number.slice(-4));

  assert.deepEqual([by("HARBOR").band, nums(by("HARBOR"))], ["certain", ["0412"]]);
  assert.deepEqual([by("BRIGHTSIDE").chosen.kind, nums(by("BRIGHTSIDE"))], ["combination", ["0398", "0405"]]);
  assert.deepEqual([by("NORTHGATE").band, by("NORTHGATE").chosen.diffCents], ["certain", -6300]);
  assert.deepEqual([by("LAKEVIEW").band, nums(by("LAKEVIEW"))], ["review", ["0402"]]);
  assert.deepEqual([by("SUNRISE").chosen.kind, by("SUNRISE").chosen.diffCents], ["short", -2500]);
  assert.deepEqual([by("PINE").chosen.kind, by("PINE").band], ["oldest", "low"]);
  assert.equal(by("KAPLAN").chosen.kind, "other");
  assert.deepEqual(nums(by("RIVERSIDE")), ["0440", "0444"]);
  assert.equal(by("GOLDEN").band, "high");
  assert.equal(by("UNKNOWN").band, "unmatched");
  assert.deepEqual([summary.payments, summary.skipped, summary.matched], [10, 1, 9]);
});

test("performance: a customer with many open invoices", () => {
  const invoices = Array.from({ length: 300 }, (_, i) => inv(i + 1, `X-${i}`, "Big Customer", 100 + ((i * 37) % 900)));
  const t0 = Date.now();
  matchPayments([pay(12345.67, "BIG CUSTOMER"), pay(1000, "BIG CUSTOMER")], invoices);
  assert.ok(Date.now() - t0 < 2000);
});
