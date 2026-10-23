// Turn raw table rows into payment and invoice records using a column mapping.

import { guessColumns, INVOICE_FIELDS, missingRequired, PAYMENT_FIELDS } from "./columns.js";
import { parseCsv, parseDate, parseMoney } from "./table.js";

export function readTable(text) {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return { headers: [], rows: [] };
  const width = Math.max(...rows.map((r) => r.length));
  const headers = rows[0].map((h, i) => (h || "").trim() || `Column ${i + 1}`);
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`);
  return { headers, rows: rows.slice(1) };
}

// Most US exports are month-first; switch to day-first when a column has a value like 25/10/2026.
function dayFirstColumn(rows, idx) {
  if (idx === undefined) return false;
  return rows.some((r) => {
    const m = String(r[idx] ?? "").match(/^(\d{1,2})[/-](\d{1,2})[/-]\d{2,4}/);
    return m && Number(m[1]) > 12;
  });
}

const cell = (r, idx) => (idx === undefined ? "" : r[idx] ?? "");
const text = (r, idx) => String(cell(r, idx)).trim();

export function toPayments(table, mapping = guessColumns(table.headers, PAYMENT_FIELDS)) {
  const missing = missingRequired(mapping, "payments");
  const dayFirst = dayFirstColumn(table.rows, mapping.date);
  const records = [];
  const problems = [];
  table.rows.forEach((r, i) => {
    const row = i + 2;
    const amountCents = parseMoney(cell(r, mapping.amount));
    if (amountCents === null) {
      if (text(r, mapping.amount)) problems.push({ row, value: text(r, mapping.amount) });
      return;
    }
    records.push({
      row,
      amountCents,
      date: parseDate(cell(r, mapping.date), { dayFirst }),
      payer: text(r, mapping.payer),
      memo: text(r, mapping.memo),
      check: text(r, mapping.check),
      id: text(r, mapping.id) || `row ${row}`,
    });
  });
  return { records, mapping, missing, problems };
}

export function toInvoices(table, mapping = guessColumns(table.headers, INVOICE_FIELDS)) {
  const missing = missingRequired(mapping, "invoices");
  const dayFirst = dayFirstColumn(table.rows, mapping.date) || dayFirstColumn(table.rows, mapping.due);
  const amountCol = mapping.open !== undefined ? mapping.open : mapping.total;
  const records = [];
  const problems = [];
  table.rows.forEach((r, i) => {
    const row = i + 2;
    const openCents = parseMoney(cell(r, amountCol));
    const number = text(r, mapping.number);
    if (openCents === null || !number) {
      if (number || text(r, amountCol)) problems.push({ row, value: `${number} ${text(r, amountCol)}`.trim() });
      return;
    }
    records.push({
      row,
      number,
      customer: text(r, mapping.customer),
      openCents,
      totalCents: parseMoney(cell(r, mapping.total)),
      date: parseDate(cell(r, mapping.date), { dayFirst }),
      due: parseDate(cell(r, mapping.due), { dayFirst }),
    });
  });
  return { records, mapping, missing, problems };
}
