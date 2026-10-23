// Page wiring. Files are read in the browser; nothing is uploaded or stored.

import { guessColumns, INVOICE_FIELDS, missingRequired, PAYMENT_FIELDS } from "./columns.js";
import { readTable, toInvoices, toPayments } from "./data.js";
import { DEFAULTS, matchPayments } from "./match.js";
import { formatMoney, toCsv } from "./table.js";

const SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const PREFS_KEY = "cash-match:prefs"; // language and settings only, never financial data

const T = {
  en: {
    title: "Cash Match",
    tagline: "Drop in the money you received and your open invoices. Cash Match suggests which invoices each payment pays, including payments that cover several invoices, early-payment discounts and short payments.",
    privacy: "Your files never leave this browser.",
    hPayments: "1 · Payments received", hintPayments: "Bank export, lockbox or deposit report. CSV or Excel. Needs an amount; payer and description help.",
    hInvoices: "2 · Open invoices", hintInvoices: "Accounts receivable export from Odoo, QuickBooks, Xero or any ERP. Needs invoice number and open amount.",
    pick: "Choose file", columns: "Columns", none: "— not used —", sample: "Load sample data",
    fee: "Short-payment tolerance $", disc: "Early-payment discounts",
    copy: "Copy for Excel", download: "Download CSV", copied: "Copied: paste into Excel", selected: "Table selected: press Ctrl+C",
    rows: (n, name) => `${n} rows · ${name}`, sampleName: "sample data", missing: (f) => `Missing column: ${f}`,
    problems: (n) => `${n} rows have an unreadable amount`,
    fields: { amount: "Amount", date: "Date", payer: "Payer", memo: "Description", check: "Check no.", id: "Reference",
      number: "Invoice no.", customer: "Customer", open: "Open amount", total: "Total", due: "Due date" },
    stats: { received: "received", applied: "applied to invoices", unapplied: "not applied", payments: "payments", open: "invoices still open" },
    bands: { all: "All", certain: "Certain", high: "Likely", review: "Check", low: "Weak", unmatched: "No match", manual: "Edited" },
    choose: "Suggestion", noMatch: "Do not match", alt: (i) => `Alternative ${i}`,
    diffShort: (m) => `${m} short`, diffOver: (m) => `${m} left over`, exact: "exact",
    usedTwice: (n) => `Also chosen for another payment: ${n}`, blocked: "Its possible invoices were already matched to other payments.",
    nothing: "No open invoice fits this payment.", emptyLedger: "Load both files to see suggestions.",
    reasons: {
      name: (c, s) => `Payer looks like ${c} (${Math.round(s * 100)}% name match)`,
      single: () => "One open invoice has exactly this amount",
      refHint: (n) => `Invoice number ${n} appears in the description`,
      refExact: (n) => `Description names ${n}`,
      refPartial: (n) => `Description names ${n}, but less was paid: partial payment`,
      refSum: () => "Those invoices add up exactly to the payment",
      over: (c, m) => `Paid ${m(c)} more than the invoices`,
      short: (c, m) => `Paid ${m(c)} less than the invoices: bank fee or deduction?`,
      sameAmount: (k) => `${k} open invoices have this amount`,
      oldestChosen: () => "the oldest one is suggested",
      combination: (k) => `${k} invoices add up exactly to the payment`,
      otherCombos: (k) => `${k} combinations fit; the one with the oldest invoices comes first`,
      discount: (p, c, m) => `Fits after a ${p}% early-payment discount (${m(c)})`,
      overOldest: (c, m) => `No exact fit; all open invoices covered, ${m(c)} left over`,
      partialOldest: () => "No exact fit; applied to the oldest open invoices (partial payment)",
      otherCustomer: (c) => `Same amount as an invoice of ${c}, but the payer name is different`,
    },
    exportHead: ["Payment date", "Payment reference", "Payer / description", "Payment amount", "Invoice", "Customer",
      "Invoice open", "Applied", "Open after", "Status", "Notes"],
    footer: "Suggestions, not postings: review them, then record the payments in your accounting system. Amounts are handled in cents, so totals are exact.",
  },
  tr: {
    title: "Ödeme Eşleştirici",
    tagline: "Gelen ödemeleri ve açık faturaları yükle. Her ödemenin hangi faturaları kapattığını önersin: birden fazla faturayı ödeyen tahsilatlar, erken ödeme iskontoları ve eksik ödemeler dahil.",
    privacy: "Dosyaların bu tarayıcıdan dışarı çıkmaz.",
    hPayments: "1 · Gelen ödemeler", hintPayments: "Banka hareketleri ya da çek yatırma raporu. CSV veya Excel. Tutar şart; ödeyen ve açıklama işe yarar.",
    hInvoices: "2 · Açık faturalar", hintInvoices: "Odoo, QuickBooks, Logo, Mikro ya da herhangi bir ERP'den alacak listesi. Fatura no ve kalan tutar şart.",
    pick: "Dosya seç", columns: "Kolonlar", none: "— kullanılmıyor —", sample: "Örnek verileri yükle",
    fee: "Eksik ödeme toleransı $", disc: "Erken ödeme iskontosu",
    copy: "Excel için kopyala", download: "CSV indir", copied: "Kopyalandı: Excel'e yapıştır", selected: "Tablo seçildi: Ctrl+C",
    rows: (n, name) => `${n} satır · ${name}`, sampleName: "örnek veri", missing: (f) => `Eksik kolon: ${f}`,
    problems: (n) => `${n} satırın tutarı okunamadı`,
    fields: { amount: "Tutar", date: "Tarih", payer: "Ödeyen", memo: "Açıklama", check: "Çek no", id: "Referans",
      number: "Fatura no", customer: "Müşteri", open: "Kalan tutar", total: "Toplam", due: "Vade" },
    stats: { received: "gelen", applied: "faturalara uygulanan", unapplied: "uygulanmayan", payments: "ödeme", open: "açık kalan fatura" },
    bands: { all: "Hepsi", certain: "Kesin", high: "Güçlü", review: "Kontrol et", low: "Zayıf", unmatched: "Eşleşmedi", manual: "Düzenlendi" },
    choose: "Öneri", noMatch: "Eşleştirme", alt: (i) => `Alternatif ${i}`,
    diffShort: (m) => `${m} eksik`, diffOver: (m) => `${m} fazla`, exact: "tam",
    usedTwice: (n) => `Başka bir ödeme için de seçili: ${n}`, blocked: "Olası faturaları başka ödemelerle eşleşti.",
    nothing: "Bu ödemeye uyan açık fatura yok.", emptyLedger: "Önerileri görmek için iki dosyayı da yükle.",
    reasons: {
      name: (c, s) => `Ödeyen ${c} gibi görünüyor (%${Math.round(s * 100)} isim benzerliği)`,
      single: () => "Tek bir açık faturanın tutarı birebir aynı",
      refHint: (n) => `Açıklamada ${n} fatura numarası geçiyor`,
      refExact: (n) => `Açıklamada ${n} yazıyor`,
      refPartial: (n) => `Açıklamada ${n} yazıyor ama daha az ödenmiş: kısmi ödeme`,
      refSum: () => "Bu faturaların toplamı ödemeye birebir eşit",
      over: (c, m) => `Faturalardan ${m(c)} fazla ödenmiş`,
      short: (c, m) => `Faturalardan ${m(c)} eksik ödenmiş: banka masrafı ya da kesinti?`,
      sameAmount: (k) => `${k} açık faturanın tutarı aynı`,
      oldestChosen: () => "en eskisi öneriliyor",
      combination: (k) => `${k} faturanın toplamı ödemeye birebir eşit`,
      otherCombos: (k) => `${k} farklı kombinasyon uyuyor; en eski faturalı olan önde`,
      discount: (p, c, m) => `%${p} erken ödeme iskontosu düşülünce tutuyor (${m(c)})`,
      overOldest: (c, m) => `Birebir uyan yok; tüm açık faturalar kapanıyor, ${m(c)} artıyor`,
      partialOldest: () => "Birebir uyan yok; en eski açık faturalara uygulandı (kısmi ödeme)",
      otherCustomer: (c) => `${c} müşterisinin bir faturasıyla aynı tutar, ama ödeyen adı farklı`,
    },
    exportHead: ["Ödeme tarihi", "Ödeme referansı", "Ödeyen / açıklama", "Ödeme tutarı", "Fatura", "Müşteri",
      "Fatura kalan", "Uygulanan", "Sonra kalan", "Durum", "Notlar"],
    footer: "Bunlar kayıt değil, öneri: kontrol edip ödemeleri muhasebe sisteminde sen işlersin. Tutarlar kuruş olarak hesaplanır, toplamlar kesin doğrudur.",
  },
};

const $ = (id) => document.getElementById(id);
const embedded = (() => { try { return window.self !== window.top; } catch { return true; } })();

const prefs = (() => {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); } catch { return {}; }
})();
const state = {
  lang: prefs.lang || ((navigator.language || "").toLowerCase().startsWith("tr") ? "tr" : "en"),
  feeDollars: Number.isFinite(prefs.feeDollars) ? prefs.feeDollars : DEFAULTS.feeToleranceCents / 100,
  discounts: typeof prefs.discounts === "string" ? prefs.discounts : "0.01,0.02",
  tables: { payments: null, invoices: null },
  names: { payments: "", invoices: "" },
  mappings: { payments: null, invoices: null },
  overrides: new Map(), // payment row -> choice index (0 = suggestion) or -1 (no match)
  filter: "all",
  view: null,
};

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ lang: state.lang, feeDollars: state.feeDollars, discounts: state.discounts })); } catch { /* ignore */ }
}

const t = () => T[state.lang];
const money = (c) => formatMoney(c, state.lang, "$");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function reasonText([key, ...args]) {
  const fn = t().reasons[key];
  if (!fn) return "";
  if (["over", "short", "overOldest"].includes(key)) return fn(args[0], money);
  if (key === "discount") return fn(args[0], args[1], money);
  return fn(...args);
}

// --- loading ----------------------------------------------------------------------------

let sheetjs = null;
function loadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!sheetjs) {
    sheetjs = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SHEETJS;
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error("Excel reader could not be loaded. Save the file as CSV and try again."));
      document.head.append(s);
    });
  }
  return sheetjs;
}

async function readFile(file) {
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await loadSheetJs();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    const clean = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
    if (!clean.length) return { headers: [], rows: [] };
    return { headers: clean[0].map((h, i) => String(h).trim() || `Column ${i + 1}`), rows: clean.slice(1) };
  }
  return readTable(await file.text());
}

function setTable(kind, table, name) {
  state.tables[kind] = table;
  state.names[kind] = name;
  state.mappings[kind] = guessColumns(table.headers, kind === "payments" ? PAYMENT_FIELDS : INVOICE_FIELDS);
  state.overrides.clear();
  update();
}

async function onFile(kind, file) {
  if (!file) return;
  try {
    setTable(kind, await readFile(file), file.name);
  } catch (err) {
    $(`status-${kind}`).textContent = err.message;
    $(`status-${kind}`).className = "status bad";
  }
}

async function loadSample() {
  const [p, i] = await Promise.all([
    fetch("./samples/bank-deposits.csv").then((r) => r.text()),
    fetch("./samples/open-invoices.csv").then((r) => r.text()),
  ]);
  state.tables = { payments: readTable(p), invoices: readTable(i) };
  state.names = { payments: t().sampleName, invoices: t().sampleName };
  state.mappings = {
    payments: guessColumns(state.tables.payments.headers, PAYMENT_FIELDS),
    invoices: guessColumns(state.tables.invoices.headers, INVOICE_FIELDS),
  };
  state.overrides.clear();
  update();
}

// --- computing ----------------------------------------------------------------------------

function compute() {
  const { payments, invoices } = state.tables;
  if (!payments || !invoices) return null;
  const P = toPayments(payments, state.mappings.payments);
  const I = toInvoices(invoices, state.mappings.invoices);
  if (P.missing.length || I.missing.length) return { P, I, match: null };
  const options = {
    feeToleranceCents: Math.max(0, Math.round((state.feeDollars || 0) * 100)),
    discountRates: state.discounts ? state.discounts.split(",").map(Number) : [],
  };
  const match = matchPayments(P.records, I.records, options);

  // apply the person's choices, then look for invoices chosen twice
  const rows = match.results.map((r) => {
    const choices = [r.chosen, ...r.alternatives].filter(Boolean);
    const pick = state.overrides.has(r.payment.row) ? state.overrides.get(r.payment.row) : 0;
    const selected = pick >= 0 ? choices[pick] || null : null;
    return { ...r, choices, pick, selected, edited: state.overrides.has(r.payment.row) };
  });
  const usage = new Map();
  for (const r of rows) for (const inv of r.selected?.invoices || []) usage.set(inv.row, [...(usage.get(inv.row) || []), r]);
  for (const r of rows) r.conflicts = (r.selected?.invoices || []).filter((i) => usage.get(i.row).length > 1).map((i) => i.number);

  const applied = rows.reduce((s, r) => s + (r.selected ? r.selected.applied.reduce((a, b) => a + b, 0) : 0), 0);
  const stillOpen = I.records.filter((i) => i.openCents > 0 && !usage.has(i.row)).length;
  return { P, I, match, rows, totals: { received: match.summary.receivedCents, applied, unapplied: match.summary.receivedCents - applied, stillOpen } };
}

// --- rendering ----------------------------------------------------------------------------

function renderStatic() {
  const x = t();
  document.documentElement.lang = state.lang;
  document.title = x.title;
  $("title").textContent = x.title;
  $("tagline").textContent = x.tagline;
  $("privacy").textContent = x.privacy;
  $("h-payments").textContent = x.hPayments;
  $("hint-payments").textContent = x.hintPayments;
  $("h-invoices").textContent = x.hInvoices;
  $("hint-invoices").textContent = x.hintInvoices;
  $("pick-payments").textContent = x.pick;
  $("pick-invoices").textContent = x.pick;
  $("sum-map-payments").textContent = x.columns;
  $("sum-map-invoices").textContent = x.columns;
  $("sample").textContent = x.sample;
  $("lbl-fee").textContent = x.fee;
  $("lbl-disc").textContent = x.disc;
  $("copy").textContent = x.copy;
  $("download").textContent = x.download;
  $("download").hidden = embedded; // downloads are blocked inside embedded viewers
  $("footer").textContent = x.footer;
  $("lang-en").setAttribute("aria-pressed", String(state.lang === "en"));
  $("lang-tr").setAttribute("aria-pressed", String(state.lang === "tr"));
  if (document.activeElement !== $("fee")) $("fee").value = state.feeDollars;
  $("disc").value = state.discounts;
}

function renderInput(kind, parsed) {
  const x = t();
  const table = state.tables[kind];
  const status = $(`status-${kind}`);
  const grid = $(`grid-${kind}`);
  if (!table) {
    status.textContent = "";
    grid.innerHTML = "";
    return;
  }
  const missing = missingRequired(state.mappings[kind], kind);
  const parts = [x.rows(table.rows.length, state.names[kind])];
  if (missing.length) parts.push(x.missing(missing.map((f) => x.fields[f]).join(", ")));
  else if (parsed?.problems?.length) parts.push(x.problems(parsed.problems.length));
  status.textContent = parts.join(" · ");
  status.className = `status ${missing.length ? "bad" : "ok"}`;
  if (missing.length) $(`map-${kind}`).open = true;

  const fields = Object.keys(kind === "payments" ? PAYMENT_FIELDS : INVOICE_FIELDS);
  grid.innerHTML = fields.map((f) => {
    const current = state.mappings[kind][f];
    const options = [`<option value="">${esc(x.none)}</option>`]
      .concat(table.headers.map((h, i) => `<option value="${i}"${current === i ? " selected" : ""}>${esc(h)}</option>`));
    return `<label>${esc(x.fields[f])}<select id="map-${kind}-${f}" data-kind="${kind}" data-field="${f}">${options.join("")}</select></label>`;
  }).join("");
}

function renderSummary(view) {
  const x = t();
  if (!view?.match) {
    $("summary").innerHTML = "";
    $("filters").innerHTML = "";
    return;
  }
  const s = view.match.summary;
  $("summary").innerHTML = [
    ["", money(view.totals.received), `${x.stats.received} · ${s.payments} ${x.stats.payments}`],
    ["green", money(view.totals.applied), x.stats.applied],
    [view.totals.unapplied ? "amber" : "", money(view.totals.unapplied), x.stats.unapplied],
    ["", String(view.totals.stillOpen), x.stats.open],
  ].map(([cls, n, l]) => `<div class="stat ${cls}"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join("");

  const counts = { all: view.rows.length };
  for (const r of view.rows) {
    const b = r.edited ? "manual" : r.band;
    counts[b] = (counts[b] || 0) + 1;
  }
  $("filters").innerHTML = ["all", "certain", "high", "review", "low", "unmatched", "manual"]
    .filter((b) => counts[b])
    .map((b) => `<button type="button" data-filter="${b}" aria-pressed="${state.filter === b}">${esc(x.bands[b])} · ${counts[b]}</button>`)
    .join("");
}

function choiceLabel(c, i) {
  const x = t();
  const nums = c.invoices.map((inv) => inv.number).join(" + ");
  const diff = c.diffCents === 0 ? x.exact : c.diffCents < 0 ? x.diffShort(money(-c.diffCents)) : x.diffOver(money(c.diffCents));
  return `${i === 0 ? x.choose : x.alt(i)}: ${nums} (${diff})`;
}

function renderLedger(view) {
  const x = t();
  const ledger = $("ledger");
  if (!view?.match) {
    ledger.innerHTML = `<div class="empty">${esc(x.emptyLedger)}</div>`;
    return;
  }
  const rows = view.rows.filter((r) => state.filter === "all" || (state.filter === "manual" ? r.edited : !r.edited && r.band === state.filter));
  ledger.innerHTML = rows.map((r) => {
    const p = r.payment;
    const c = r.selected;
    const bandKey = r.edited ? "manual" : c ? r.band : "unmatched";
    const payer = p.payer ? `<div class="payer">${esc(p.payer)}</div>` : "";
    const memo = p.memo ? `<div class="memo">${esc(p.memo)}</div>` : "";
    const check = p.check ? ` · #${esc(p.check)}` : "";
    let match = "";
    if (c) {
      const list = c.invoices.map((inv, i) => `<div class="inv"><div><span class="num">${esc(inv.number)}</span> <span class="cust">${esc(inv.customer)}${inv.due ? ` · ${esc(inv.due)}` : ""}</span></div><div class="amt">${esc(money(c.applied[i]))}</div></div>`).join("");
      const diff = c.diffCents === 0 ? "" : `<div class="diff ${c.diffCents < 0 ? "neg" : "pos"}">${esc(c.diffCents < 0 ? x.diffShort(money(-c.diffCents)) : x.diffOver(money(c.diffCents)))}</div>`;
      const why = `<ul class="why">${c.reasons.map((rs) => `<li>${esc(reasonText(rs))}</li>`).filter((li) => li !== "<li></li>").join("")}</ul>`;
      const conflict = r.conflicts.length ? `<div class="conflict">${esc(x.usedTwice(r.conflicts.join(", ")))}</div>` : "";
      match = `<div class="inv-list">${list}</div>${diff}${why}${conflict}`;
    } else {
      match = `<div class="why">${esc(r.blockedBy?.length ? x.blocked : x.nothing)}</div>`;
    }
    const options = r.choices.map((ch, i) => `<option value="${i}"${r.pick === i ? " selected" : ""}>${esc(choiceLabel(ch, i))}</option>`);
    options.push(`<option value="-1"${r.pick === -1 ? " selected" : ""}>${esc(x.noMatch)}</option>`);
    const chooser = r.choices.length ? `<div class="choice"><select id="choice-${p.row}" data-row="${p.row}" aria-label="${esc(x.choose)}">${options.join("")}</select></div>` : "";
    return `<article class="pay${r.edited ? " overridden" : ""}">
      <div><span class="pill ${bandKey}">${esc(x.bands[bandKey])}</span><div class="when">${esc(p.date || "")}${check}</div></div>
      <div class="desc">${payer}${memo}</div>
      <div class="amount">${esc(money(p.amountCents))}</div>
      <div class="match">${match}${chooser}</div>
    </article>`;
  }).join("") || `<div class="empty">—</div>`;
}

function update() {
  savePrefs();
  renderStatic();
  const view = compute();
  state.view = view;
  renderInput("payments", view?.P);
  renderInput("invoices", view?.I);
  renderSummary(view);
  renderLedger(view);
}

// --- export -------------------------------------------------------------------------------

function exportRows() {
  const x = t();
  const view = state.view;
  if (!view?.rows) return [x.exportHead];
  const plain = (c) => formatMoney(c, "en"); // spreadsheets read 1234.56 reliably
  const out = [x.exportHead];
  for (const r of view.rows) {
    const p = r.payment;
    const ref = p.check ? `Check ${p.check}` : p.id;
    const desc = [p.payer, p.memo].filter(Boolean).join(" · ");
    const status = x.bands[r.edited ? "manual" : r.selected ? r.band : "unmatched"];
    if (!r.selected) {
      out.push([p.date || "", ref, desc, plain(p.amountCents), "", "", "", "", "", status, r.blockedBy?.length ? x.blocked : x.nothing]);
      continue;
    }
    const notes = r.selected.reasons.map(reasonText).filter(Boolean).join("; ");
    r.selected.invoices.forEach((inv, i) => {
      const applied = r.selected.applied[i];
      out.push([p.date || "", ref, desc, plain(p.amountCents), inv.number, inv.customer, plain(inv.openCents), plain(applied),
        plain(inv.openCents - applied), status, i === 0 ? notes : ""]);
    });
  }
  return out;
}

function flash(msg) {
  $("toast").textContent = msg;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { $("toast").textContent = ""; }, 2500);
}

// --- events -------------------------------------------------------------------------------

for (const kind of ["payments", "invoices"]) {
  $(`file-${kind}`).addEventListener("change", (e) => onFile(kind, e.target.files[0]));
  const drop = $(`drop-${kind}`);
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); onFile(kind, e.dataTransfer.files[0]); });
  $(`grid-${kind}`).addEventListener("change", (e) => {
    const sel = e.target.closest("select");
    if (!sel) return;
    const m = { ...state.mappings[kind] };
    if (sel.value === "") delete m[sel.dataset.field];
    else {
      for (const [f, idx] of Object.entries(m)) if (idx === Number(sel.value)) delete m[f]; // one column, one field
      m[sel.dataset.field] = Number(sel.value);
    }
    state.mappings[kind] = m;
    state.overrides.clear();
    update();
  });
}
$("ledger").addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-row]");
  if (!sel) return;
  const row = Number(sel.dataset.row);
  const v = Number(sel.value);
  if (v === 0) state.overrides.delete(row);
  else state.overrides.set(row, v);
  update();
});
$("filters").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-filter]");
  if (!b) return;
  state.filter = b.dataset.filter;
  update();
});
$("fee").addEventListener("input", () => {
  const v = Number($("fee").value);
  if (Number.isFinite(v) && v >= 0) { state.feeDollars = v; state.overrides.clear(); update(); }
});
$("disc").addEventListener("change", () => { state.discounts = $("disc").value; state.overrides.clear(); update(); });
$("sample").addEventListener("click", () => loadSample());
$("lang-en").addEventListener("click", () => { state.lang = "en"; update(); });
$("lang-tr").addEventListener("click", () => { state.lang = "tr"; update(); });
$("copy").addEventListener("click", async () => {
  const tsv = exportRows().map((r) => r.map((c) => String(c ?? "").replace(/[\t\n\r]+/g, " ")).join("\t")).join("\n");
  try {
    await navigator.clipboard.writeText(tsv);
    flash(t().copied);
  } catch {
    const range = document.createRange();
    range.selectNodeContents($("ledger"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    flash(t().selected);
  }
});
$("download").addEventListener("click", () => {
  const blob = new Blob(["﻿" + toCsv(exportRows())], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "cash-match-results.csv";
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});

update();
loadSample().catch(() => update());
