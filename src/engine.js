import { mulberry32, shuffle } from './util.js';
import { id as newId } from './db.js';

// ---------------------------------------------------------------------------
// Marking scheme
// ---------------------------------------------------------------------------
// Every value can be overridden per exam (exam.scheme), per section
// (section.scheme) and, for the "correct" marks, per question (q.marks).
export const DEFAULT_SCHEME = {
  MCQ: { correct: 4, wrong: -1 },
  MSQ: { correct: 4, wrong: -2, partial: 1 },
  NUMERICAL: { correct: 4, wrong: 0 },
};

export function schemeFor(exam, section, q) {
  const s = {
    ...DEFAULT_SCHEME[q.type],
    ...(exam.scheme?.[q.type] || {}),
    ...(section.scheme?.[q.type] || {}),
  };
  if (Number.isFinite(q.marks)) s.correct = q.marks;
  return s;
}

export const allQuestions = (exam) => exam.sections.flatMap((section) => section.questions.map((q) => ({ section, q })));

export const maxMarks = (exam) => allQuestions(exam).reduce((sum, { section, q }) => sum + schemeFor(exam, section, q).correct, 0);

const isBlank = (a) => a === undefined || a === null || a === '' || (Array.isArray(a) && a.length === 0);

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------
export function evaluateQuestion(q, resp, sc) {
  // A dropped question gives full marks to every candidate (the usual NTA outcome
  // when a question is found to be wrong or ambiguous).
  if (q.dropped) return { status: 'bonus', marks: sc.correct };
  const a = resp?.a;
  if (isBlank(a)) return { status: 'unattempted', marks: 0 };

  if (q.type === 'MCQ') {
    return [].concat(q.answer).includes(a)
      ? { status: 'correct', marks: sc.correct }
      : { status: 'wrong', marks: sc.wrong };
  }

  if (q.type === 'MSQ') {
    const key = new Set(q.answer);
    const picked = new Set([].concat(a));
    if ([...picked].some((x) => !key.has(x))) return { status: 'wrong', marks: sc.wrong };
    if (picked.size === key.size) return { status: 'correct', marks: sc.correct };
    return { status: 'partial', marks: Math.min(sc.partial * picked.size, sc.correct) };
  }

  // NUMERICAL
  const n = Number(a);
  if (!Number.isFinite(n)) return { status: 'unattempted', marks: 0 };
  const tol = q.tolerance ?? 0.01;
  const ok = [].concat(q.answer).some((k) => Math.abs(n - Number(k)) <= tol + 1e-9);
  return ok ? { status: 'correct', marks: sc.correct } : { status: 'wrong', marks: sc.wrong };
}

export function evaluateAttempt(exam, attempt) {
  const sections = {};
  const questions = {};
  let total = 0;
  let max = 0;
  for (const section of exam.sections) {
    const s = { name: section.name, marks: 0, max: 0, correct: 0, wrong: 0, partial: 0, bonus: 0, unattempted: 0, attempted: 0 };
    for (const q of section.questions) {
      const sc = schemeFor(exam, section, q);
      const resp = attempt.responses[q.id];
      const r = evaluateQuestion(q, resp, sc);
      questions[q.id] = r;
      s.marks += r.marks;
      s.max += sc.correct;
      s[r.status] += 1;
      if (!isBlank(resp?.a)) s.attempted += 1;
    }
    s.marks = Math.round(s.marks * 100) / 100;
    sections[section.id] = s;
    total += s.marks;
    max += s.max;
  }
  return { total: Math.round(total * 100) / 100, max, sections, questions };
}

// ---------------------------------------------------------------------------
// Cohort statistics and NTA-style percentile
// ---------------------------------------------------------------------------
// Percentile = 100 x (candidates who scored the same or lower) / (candidates who appeared).
const statsCache = new Map();
export const invalidateStats = (examId) => statsCache.delete(examId);

export function cohort(exam, attempts) {
  const hit = statsCache.get(exam.id);
  if (hit) return hit;
  const done = attempts.filter((a) => a.examId === exam.id && a.status === 'submitted' && a.score);
  const totals = done.map((a) => a.score.total).sort((x, y) => x - y);
  const secTotals = {};
  for (const s of exam.sections) {
    secTotals[s.id] = done.map((a) => a.score.sections[s.id]?.marks ?? 0).sort((x, y) => x - y);
  }
  const n = totals.length;
  const stats = {
    n,
    totals,
    secTotals,
    mean: n ? totals.reduce((a, b) => a + b, 0) / n : 0,
    median: n ? (totals[Math.floor((n - 1) / 2)] + totals[Math.ceil((n - 1) / 2)]) / 2 : 0,
    max: n ? totals[n - 1] : 0,
    min: n ? totals[0] : 0,
  };
  statsCache.set(exam.id, stats);
  return stats;
}

function upperBound(sorted, x) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const percentileOf = (sorted, x) => (sorted.length ? (100 * upperBound(sorted, x)) / sorted.length : 0);
export const rankOf = (sorted, x) => 1 + (sorted.length - upperBound(sorted, x));

export function histogram(totals, exam, bins = 12) {
  const hi = maxMarks(exam);
  const lo = Math.min(0, Math.floor(totals[0] ?? 0));
  const width = (hi - lo) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count: 0 }));
  for (const t of totals) out[Math.min(bins - 1, Math.max(0, Math.floor((t - lo) / width)))].count++;
  return { lo, hi, bins: out };
}

// ---------------------------------------------------------------------------
// Paper delivery
// ---------------------------------------------------------------------------
// Each candidate gets a seeded question order. Questions of the same type stay together
// (Section A / Section B style) and are shuffled inside their group when enabled.
export function buildOrder(exam, seed) {
  const rnd = mulberry32(seed);
  const order = {};
  for (const s of exam.sections) {
    let ids = s.questions.map((q) => q.id);
    if (exam.shuffleQuestions) {
      const groups = new Map();
      for (const q of s.questions) {
        if (!groups.has(q.type)) groups.set(q.type, []);
        groups.get(q.type).push(q.id);
      }
      ids = [...groups.values()].flatMap((g) => shuffle(g, rnd));
    }
    order[s.id] = ids;
  }
  return order;
}

// The candidate-facing paper. Never includes answers, tolerances or explanations.
export function paperFor(exam, attempt) {
  return {
    sections: exam.sections.map((s) => {
      const byId = new Map(s.questions.map((q) => [q.id, q]));
      return {
        id: s.id,
        name: s.name,
        questions: (attempt.order[s.id] || []).map((qid, i) => {
          const q = byId.get(qid);
          const sc = schemeFor(exam, s, q);
          return {
            id: q.id,
            no: i + 1,
            type: q.type,
            text: q.text,
            options: q.options?.map((o) => ({ id: o.id, text: o.text })),
            marks: { correct: sc.correct, wrong: sc.wrong, partial: q.type === 'MSQ' ? sc.partial : undefined },
          };
        }),
      };
    }),
  };
}

export function parseAnswer(q, a) {
  const fail = () => {
    const e = new Error('invalid_answer');
    e.invalid = true;
    throw e;
  };
  if (a === null || a === undefined) return null;
  if (q.type === 'MCQ') {
    if (typeof a !== 'string' || !q.options.some((o) => o.id === a)) fail();
    return a;
  }
  if (q.type === 'MSQ') {
    if (!Array.isArray(a) || a.length > q.options.length) fail();
    const set = [...new Set(a)];
    if (!set.every((x) => q.options.some((o) => o.id === x))) fail();
    return set.length ? set.sort() : null;
  }
  if (typeof a !== 'string' || a.length > 12 || !/^-?\d*\.?\d*$/.test(a)) fail();
  return a === '' ? null : a;
}

// ---------------------------------------------------------------------------
// Exam import / validation (admin)
// ---------------------------------------------------------------------------
export const DEFAULT_INSTRUCTIONS = [
  'The test is timed. The clock at the top right shows the time left. When it reaches zero your paper is submitted automatically.',
  'Select a number in the question palette to jump to that question. Your answer is saved as soon as you choose it.',
  'Use Save & Next to move on, Mark for Review & Next to flag a question you want to revisit, and Clear Response to remove your answer.',
  'A question marked for review that already has an answer is still evaluated. A marked question without an answer is not.',
  'For multiple choice questions, select an option. For numerical questions, type the value or use the on-screen keypad.',
  'Stay in full-screen and do not switch tabs. Every exit is recorded and shown to the invigilator.',
  'The marks for each question are shown above it. Some question types carry negative marking.',
  'You can submit only once. After you submit, you cannot return to the paper.',
];

const LETTERS = 'abcdefgh';
const TYPES = ['MCQ', 'MSQ', 'NUMERICAL'];
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

export function normalizeExam(input, now = Date.now()) {
  const errors = [];
  const add = (m) => errors.push(m);
  const o = input && typeof input === 'object' ? input : {};
  const str = (v, min, max, label) => {
    if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) {
      add(`${label} must be ${min}-${max} characters.`);
      return '';
    }
    return v.trim();
  };

  const title = str(o.title, 3, 120, 'title');
  const code = o.code == null ? '' : str(String(o.code), 0, 20, 'code');
  const description = o.description == null ? '' : str(o.description, 0, 500, 'description');
  const durationMin = Number(o.durationMin);
  if (!(durationMin >= 0.01 && durationMin <= 600)) add('durationMin must be between 0.01 and 600 minutes.');

  const start = o.window?.start ? Date.parse(o.window.start) : now;
  const end = o.window?.end ? Date.parse(o.window.end) : now + 30 * 864e5;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    add('window.start and window.end must be valid dates, with the end after the start.');
  }

  const scheme = {};
  for (const type of TYPES) {
    const s = o.scheme?.[type];
    if (s == null) continue;
    scheme[type] = {};
    for (const [k, lo, hi] of [['correct', 0, 100], ['wrong', -100, 0], ['partial', 0, 100]]) {
      if (s[k] == null) continue;
      const v = Number(s[k]);
      if (v >= lo && v <= hi) scheme[type][k] = v;
      else add(`scheme.${type}.${k} must be between ${lo} and ${hi}.`);
    }
  }

  const maxViolations = o.maxViolations == null ? 0 : Number(o.maxViolations);
  if (!Number.isInteger(maxViolations) || maxViolations < 0 || maxViolations > 50) add('maxViolations must be a whole number from 0 to 50.');

  let instructions = DEFAULT_INSTRUCTIONS;
  if (o.instructions != null) {
    if (!Array.isArray(o.instructions) || o.instructions.length > 20 || o.instructions.some((s) => typeof s !== 'string' || s.length > 400)) {
      add('instructions must be a list of up to 20 short strings.');
    } else instructions = o.instructions;
  }

  const sections = [];
  const usedIds = new Set();
  if (!Array.isArray(o.sections) || o.sections.length < 1 || o.sections.length > 8) add('Provide 1-8 sections.');
  let questionCount = 0;
  (Array.isArray(o.sections) ? o.sections : []).forEach((sec, si) => {
    const sname = str(sec?.name, 1, 40, `Section ${si + 1} name`);
    let sid = slug(sname) || `s${si + 1}`;
    if (usedIds.has(sid)) sid = `${sid}-${si + 1}`;
    usedIds.add(sid);
    const section = { id: sid, name: sname, questions: [] };
    if (!Array.isArray(sec?.questions) || sec.questions.length < 1 || sec.questions.length > 150) {
      add(`Section ${si + 1}: provide 1-150 questions.`);
      return;
    }
    sec.questions.forEach((q, qi) => {
      const label = `${sname} Q${qi + 1}`;
      questionCount++;
      const type = String(q?.type || '').toUpperCase();
      if (!TYPES.includes(type)) return add(`${label}: type must be MCQ, MSQ or NUMERICAL.`);
      const text = str(q.text, 1, 4000, `${label} text`);
      const out = { id: newId('q_'), type, text };
      if (type === 'NUMERICAL') {
        const arr = [].concat(q.answer ?? []).map(Number);
        if (!arr.length || arr.some((x) => !Number.isFinite(x))) return add(`${label}: numerical answer must be a number.`);
        out.answer = arr.length === 1 ? arr[0] : arr;
        const tol = q.tolerance == null ? 0.01 : Number(q.tolerance);
        if (!(tol >= 0 && tol <= 1000)) return add(`${label}: tolerance must be between 0 and 1000.`);
        out.tolerance = tol;
      } else {
        if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) return add(`${label}: provide 2-6 options.`);
        const options = q.options.map((op, i) => ({ id: LETTERS[i], text: typeof op === 'string' ? op : op?.text }));
        if (options.some((op) => typeof op.text !== 'string' || !op.text.trim() || op.text.length > 500)) {
          return add(`${label}: every option needs text of up to 500 characters.`);
        }
        options.forEach((op) => (op.text = op.text.trim()));
        const ids = new Set(options.map((x) => x.id));
        const ans = [].concat(q.answer ?? []).map((x) => String(x).toLowerCase());
        if (!ans.length || ans.some((x) => !ids.has(x))) return add(`${label}: answer must be option letter(s) from a to ${LETTERS[options.length - 1]}.`);
        const uniq = [...new Set(ans)].sort();
        out.options = options;
        out.answer = type === 'MSQ' ? uniq : uniq.length === 1 ? uniq[0] : uniq;
      }
      if (q.marks != null) {
        if (!(Number(q.marks) >= 0 && Number(q.marks) <= 100)) return add(`${label}: marks must be between 0 and 100.`);
        out.marks = Number(q.marks);
      }
      if (q.explanation != null) out.explanation = str(q.explanation, 0, 1000, `${label} explanation`);
      section.questions.push(out);
    });
    sections.push(section);
  });
  if (questionCount > 300) add('An exam can have at most 300 questions.');

  if (errors.length) {
    const e = new Error('invalid_exam');
    e.details = errors.slice(0, 20);
    throw e;
  }

  return {
    id: newId('ex_'),
    code,
    title,
    description,
    durationMin,
    window: { start, end },
    scheme,
    instructions,
    shuffleQuestions: !!o.shuffleQuestions,
    maxViolations,
    resultsPublished: false,
    challengeOpen: false,
    createdAt: now,
    sections,
  };
}

export const EXAM_TEMPLATE = {
  code: 'MOCK-02',
  title: 'Sample mock paper',
  description: 'Two short sections to try the import.',
  durationMin: 30,
  shuffleQuestions: false,
  maxViolations: 0,
  scheme: { MCQ: { correct: 4, wrong: -1 }, NUMERICAL: { correct: 4, wrong: 0 } },
  sections: [
    {
      name: 'Physics',
      questions: [
        {
          type: 'MCQ',
          text: 'A body of mass 2 kg moves at 3 m/s. Its kinetic energy is',
          options: ['3 J', '6 J', '9 J', '18 J'],
          answer: 'c',
          explanation: 'KE = (1/2) m v^{2} = 0.5 x 2 x 9 = 9 J.',
        },
        { type: 'NUMERICAL', text: 'A car starts from rest and accelerates at 2 m/s^{2} for 5 s. Distance covered in metres?', answer: 25 },
      ],
    },
    {
      name: 'Mathematics',
      questions: [
        { type: 'MCQ', text: 'The sum of the roots of x^{2} - 5x + 6 = 0 is', options: ['5', '6', '-5', '-6'], answer: 'a' },
        { type: 'NUMERICAL', text: 'Number of ways to arrange the letters of LEVEL', answer: 30 },
      ],
    },
  ],
};
