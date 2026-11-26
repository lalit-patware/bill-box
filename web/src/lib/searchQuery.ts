/**
 * Turn a natural search like "milk october", "blue shirt zudio", "fridge warranty 2026"
 * into filters for the search_bills() database function.
 */

export interface ParsedQuery {
  words: string[];
  kinds: string[];
  month: number | null;
  year: number | null;
}

const MONTHS: [number, string[]][] = [
  [1, ['jan', 'january', 'janvari', 'जनवरी']],
  [2, ['feb', 'february', 'farvari', 'फरवरी']],
  [3, ['mar', 'march', 'मार्च']],
  [4, ['apr', 'april', 'अप्रैल']],
  [5, ['may', 'मई']],
  [6, ['jun', 'june', 'जून']],
  [7, ['jul', 'july', 'जुलाई']],
  [8, ['aug', 'august', 'agast', 'अगस्त']],
  [9, ['sep', 'sept', 'september', 'सितंबर']],
  [10, ['oct', 'october', 'अक्टूबर']],
  [11, ['nov', 'november', 'नवंबर']],
  [12, ['dec', 'december', 'दिसंबर']],
];

const KINDS: [string, string[]][] = [
  ['recurring_milk', ['milk', 'doodh', 'dudh', 'dairy', 'दूध']],
  ['laundry', ['dhobi', 'laundry', 'istri', 'iron', 'press', 'dryclean', 'drycleaning', 'धोबी']],
  ['textile_kaccha', ['saree', 'sari', 'kapda', 'fabric', 'textile', 'साड़ी', 'कपड़ा']],
  ['vendor_credit', ['kirana', 'udhaar', 'udhar', 'grocery', 'किराना']],
  ['medical_consult', ['doctor', 'clinic', 'medical', 'pharmacy', 'medicine', 'dawai', 'dawa', 'डॉक्टर', 'दवाई']],
  ['hospital', ['hospital', 'अस्पताल']],
  ['electronics', ['warranty', 'guarantee', 'electronics', 'वारंटी']],
  ['retail_fashion', ['exchange']],
];

const STOP = new Set(['bill', 'bills', 'ka', 'ki', 'ke', 'the', 'of', 'for', 'from', 'in', 'my', 'बिल']);

const monthOf = new Map(MONTHS.flatMap(([n, names]) => names.map((w) => [w, n] as const)));
const kindOf = new Map(KINDS.flatMap(([k, names]) => names.map((w) => [w, k] as const)));

export function parseQuery(input: string): ParsedQuery {
  const out: ParsedQuery = { words: [], kinds: [], month: null, year: null };
  const tokens = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s/-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const tok of tokens) {
    if (/^20\d\d$/.test(tok)) {
      out.year = Number(tok);
      continue;
    }
    const month = monthOf.get(tok);
    if (month) {
      out.month = month;
      continue;
    }
    const kind = kindOf.get(tok);
    if (kind) {
      if (!out.kinds.includes(kind)) out.kinds.push(kind);
      continue;
    }
    if (STOP.has(tok) || tok.length < 2) continue;
    if (!out.words.includes(tok)) out.words.push(tok);
  }
  return out;
}

export function isEmptyQuery(q: ParsedQuery): boolean {
  return !q.words.length && !q.kinds.length && q.month === null && q.year === null;
}
