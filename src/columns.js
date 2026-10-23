// Recognise columns in exports from banks, Odoo, QuickBooks, Xero, NetSuite and Turkish software.

const fold = (s) =>
  String(s || "")
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const PAYMENT_FIELDS = {
  amount: ["amount", "credit", "deposit", "deposits", "credit amount", "payment amount", "amount received", "received",
    "tutar", "alacak", "odeme tutari", "tahsilat", "miktar"],
  date: ["date", "posting date", "posted date", "value date", "transaction date", "deposit date", "payment date",
    "tarih", "islem tarihi", "valor", "odeme tarihi"],
  payer: ["payer", "name", "customer", "from", "remitter", "payer name", "counterparty", "originator", "partner",
    "musteri", "firma", "gonderen", "cari", "unvan"],
  memo: ["memo", "description", "details", "reference", "remittance", "remittance info", "narrative", "addenda",
    "payment details", "aciklama", "referans", "odeme aciklamasi"],
  check: ["check", "check no", "check number", "cheque", "cheque number", "check num", "serial", "cek no", "cek numarasi"],
  id: ["id", "transaction id", "reference number", "trace number", "bank reference", "fis no", "dekont no"],
};

export const INVOICE_FIELDS = {
  number: ["number", "invoice", "invoice number", "invoice no", "invoice num", "num", "doc number", "document number",
    "name", "fatura no", "fatura numarasi", "belge no"],
  customer: ["customer", "partner", "client", "customer name", "bill to", "account", "musteri", "cari", "firma", "unvan"],
  open: ["amount due", "amount residual", "residual", "open balance", "balance", "open amount", "balance due", "remaining",
    "kalan", "kalan tutar", "acik tutar", "bakiye"],
  total: ["total", "amount", "amount total", "invoice amount", "total amount", "tutar", "toplam", "fatura tutari"],
  date: ["invoice date", "date", "issue date", "fatura tarihi", "tarih"],
  due: ["due date", "due", "payment due", "vade", "vade tarihi", "son odeme tarihi"],
};

// Header text after folding, also with a trailing "(...)" note removed, e.g. "Amount Due (USD)".
function keys(header) {
  const f = fold(header);
  const stripped = fold(String(header || "").replace(/\s*\([^)]*\)\s*$/, ""));
  return [...new Set([f, stripped])];
}

export function guessColumns(headers, fields) {
  const mapping = {};
  const used = new Set();
  for (const [field, aliases] of Object.entries(fields)) {
    const wanted = aliases.map(fold);
    // exact alias match first, in alias order (so "amount due" beats "amount")
    for (const alias of wanted) {
      const idx = headers.findIndex((h, i) => !used.has(i) && keys(h).includes(alias));
      if (idx >= 0) {
        mapping[field] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return mapping;
}

export function missingRequired(mapping, kind) {
  const required = kind === "payments" ? ["amount"] : ["number", "open"];
  const missing = required.filter((f) => mapping[f] === undefined);
  // An invoice list with a total but no open-amount column is usable: treat the total as open.
  if (kind === "invoices" && missing.includes("open") && mapping.total !== undefined) {
    return missing.filter((f) => f !== "open");
  }
  return missing;
}
