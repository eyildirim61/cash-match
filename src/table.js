// Reading tabular files: CSV with any common delimiter, and money amounts in any common format.

export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ",";
  let bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => splitLine(l, d).length);
    if (!counts.length || counts[0] < 2) continue;
    const consistent = counts.filter((c) => c === counts[0]).length;
    const score = consistent * 100 + counts[0];
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function splitLine(line, d) {
  return parseCsv(line, d)[0] || [];
}

// RFC 4180 style: quoted fields, doubled quotes, newlines inside quotes.
export function parseCsv(text, delimiter) {
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === d) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// "$1,234.56" "1.234,56" "1234.5" "(250.00)" "-250" "USD 1,000" "1 234,50 TL" -> integer cents, or null.
export function parseMoney(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[A-Za-z$€£₺\s ']/g, "");
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  // Which separator is the decimal point?
  //   both present            -> the last one ("1,234.56", "1.234,56")
  //   one kind, used once     -> decimal unless exactly 3 digits follow ("12,5", "12.50"; "1,234" = thousands)
  //   one kind, used twice+   -> thousands ("1.234.567")
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decimalAt = -1;
  if (lastDot >= 0 && lastComma >= 0) decimalAt = Math.max(lastDot, lastComma);
  else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const count = s.split(sep).length - 1;
    const at = s.lastIndexOf(sep);
    if (count === 1 && s.length - at - 1 !== 3) decimalAt = at;
  }
  const intPart = (decimalAt >= 0 ? s.slice(0, decimalAt) : s).replace(/[.,]/g, "") || "0";
  const frac = decimalAt >= 0 ? s.slice(decimalAt + 1).replace(/[.,]/g, "") : "";
  const fracCents = frac.length <= 2 ? Number(frac.padEnd(2, "0")) : Math.round(Number(`0.${frac}`) * 100);
  const cents = Number(intPart) * 100 + fracCents;
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function formatMoney(cents, lang = "en", currency = "") {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString();
  const frac = String(abs % 100).padStart(2, "0");
  const groupSep = lang === "tr" ? "." : ",";
  const decSep = lang === "tr" ? "," : ".";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep);
  return `${sign}${currency}${grouped}${decSep}${frac}`;
}

// Dates: ISO, US (MM/DD/YYYY), Turkish/European (DD.MM.YYYY), and Excel serial numbers -> "YYYY-MM-DD".
export function parseDate(raw, { dayFirst = false } = {}) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && raw > 20000 && raw < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    let [a, b, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    const dotted = s.includes(".");
    const dayFirstHere = dayFirst || dotted || a > 12;
    return dayFirstHere ? iso(y, b, a) : iso(y, a, b);
  }
  return null;
}

function iso(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function toCsv(rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
