import { Router } from 'express';
import crypto from 'node:crypto';
import { db, save, id, audit } from '../db.js';
import { HttpError, bad, csvRow, wrap } from '../util.js';
import { hashPassword } from '../auth.js';
import {
  normalizeExam,
  EXAM_TEMPLATE,
  allQuestions,
  maxMarks,
  cohort,
  percentileOf,
  rankOf,
  histogram,
  schemeFor,
} from '../engine.js';
import { getExam, finalizeAttempt, sweepAll, rescoreExam, remainingMs } from '../attempts.js';

export const adminRouter = Router();

const userById = (uid) => db.data.users.find((u) => u.id === uid);
const candidates = () => db.data.users.filter((u) => u.role === 'candidate');

function examRow(exam) {
  const attempts = db.data.attempts.filter((a) => a.examId === exam.id);
  return {
    id: exam.id,
    code: exam.code,
    title: exam.title,
    description: exam.description,
    durationMin: exam.durationMin,
    window: exam.window,
    questionCount: allQuestions(exam).length,
    maxMarks: maxMarks(exam),
    sections: exam.sections.map((s) => ({ id: s.id, name: s.name, count: s.questions.length })),
    resultsPublished: !!exam.resultsPublished,
    challengeOpen: !!exam.challengeOpen,
    maxViolations: exam.maxViolations,
    attempts: attempts.length,
    inProgress: attempts.filter((a) => a.status === 'in_progress').length,
    submitted: attempts.filter((a) => a.status === 'submitted').length,
  };
}

const randomPassword = () => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(10), (b) => alphabet[b % alphabet.length]).join('');
};

// ---------------------------------------------------------------- control room
adminRouter.get('/overview', (_req, res) => {
  sweepAll();
  res.json({
    candidates: candidates().filter((u) => !u.synthetic).length,
    exams: db.data.exams.length,
    inProgress: db.data.attempts.filter((a) => a.status === 'in_progress').length,
    submitted: db.data.attempts.filter((a) => a.status === 'submitted').length,
    pendingChallenges: db.data.challenges.filter((c) => c.status === 'pending').length,
  });
});

adminRouter.get('/live', (_req, res) => {
  sweepAll();
  const now = Date.now();
  const live = db.data.attempts
    .filter((a) => a.status === 'in_progress')
    .map((a) => {
      const exam = db.data.exams.find((e) => e.id === a.examId);
      const user = userById(a.userId);
      const answered = Object.values(a.responses).filter((r) => r.a !== null && r.a !== undefined && r.a !== '').length;
      return {
        attemptId: a.id,
        candidate: user?.name,
        applicationNo: user?.loginId,
        exam: exam?.title,
        remainingMs: remainingMs(a, now),
        answered,
        total: exam ? allQuestions(exam).length : 0,
        violations: a.violations,
        lastSeenSecondsAgo: Math.round((now - (a.lastSeenAt || a.startedAt)) / 1000),
        extraMin: Math.round((a.extraMs || 0) / 60000),
      };
    });
  res.json({ live, serverNow: now });
});

adminRouter.post('/attempts/:id/extend', (req, res) => {
  const a = db.data.attempts.find((x) => x.id === req.params.id);
  if (!a) throw new HttpError(404, 'not_found', 'Attempt not found.');
  const minutes = Number(req.body?.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw bad('invalid_minutes', 'Add between 1 and 60 minutes.');
  if (a.status !== 'in_progress') throw new HttpError(409, 'not_in_progress', 'This attempt is already submitted.');
  a.endsAt += minutes * 60000;
  a.extraMs = (a.extraMs || 0) + minutes * 60000;
  audit(req.user.loginId, 'attempt.extend', `${a.id} +${minutes}m ${String(req.body?.reason || '').slice(0, 120)}`);
  save();
  res.json({ ok: true, remainingMs: remainingMs(a) });
});

adminRouter.post('/attempts/:id/submit', (req, res) => {
  const a = db.data.attempts.find((x) => x.id === req.params.id);
  if (!a) throw new HttpError(404, 'not_found', 'Attempt not found.');
  finalizeAttempt(a, 'admin');
  audit(req.user.loginId, 'attempt.force_submit', a.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- exams
adminRouter.get('/exam-template', (_req, res) => res.json(EXAM_TEMPLATE));

adminRouter.get('/exams', (_req, res) => {
  sweepAll();
  res.json({ exams: db.data.exams.map(examRow) });
});

adminRouter.get('/exams/:id', (req, res) => {
  const exam = getExam(req.params.id);
  res.json({ exam: { ...examRow(exam), sections: exam.sections } });
});

adminRouter.post('/exams', (req, res) => {
  let exam;
  try {
    exam = normalizeExam(req.body);
  } catch (e) {
    if (e.details) throw new HttpError(422, 'invalid_exam', 'The exam file has problems.', { details: e.details });
    throw e;
  }
  db.data.exams.push(exam);
  audit(req.user.loginId, 'exam.create', exam.title);
  save();
  res.status(201).json({ exam: examRow(exam) });
});

adminRouter.patch('/exams/:id', (req, res) => {
  const exam = getExam(req.params.id);
  const b = req.body || {};
  if ('resultsPublished' in b) exam.resultsPublished = !!b.resultsPublished;
  if ('challengeOpen' in b) exam.challengeOpen = !!b.challengeOpen;
  if (b.window) {
    const start = Date.parse(b.window.start);
    const end = Date.parse(b.window.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw bad('invalid_window', 'Use valid dates, with the end after the start.');
    exam.window = { start, end };
  }
  if ('maxViolations' in b) {
    const n = Number(b.maxViolations);
    if (!Number.isInteger(n) || n < 0 || n > 50) throw bad('invalid_violations', 'Use a whole number from 0 to 50.');
    exam.maxViolations = n;
  }
  audit(req.user.loginId, 'exam.update', `${exam.title} ${JSON.stringify(b).slice(0, 150)}`);
  save();
  res.json({ exam: examRow(exam) });
});

adminRouter.delete('/exams/:id', (req, res) => {
  const exam = getExam(req.params.id);
  if (db.data.attempts.some((a) => a.examId === exam.id)) {
    throw new HttpError(409, 'has_attempts', 'This exam already has attempts and cannot be deleted.');
  }
  db.data.exams = db.data.exams.filter((e) => e.id !== exam.id);
  audit(req.user.loginId, 'exam.delete', exam.title);
  save();
  res.json({ ok: true });
});

// Answer key edits re-score every submitted paper for that exam.
adminRouter.post('/exams/:id/questions/:qid/key', (req, res) => {
  const exam = getExam(req.params.id);
  const q = allQuestions(exam).find((x) => x.q.id === req.params.qid)?.q;
  if (!q) throw new HttpError(404, 'not_found', 'Question not found.');
  const b = req.body || {};
  if ('drop' in b) q.dropped = !!b.drop;
  if ('answer' in b) {
    let ans = b.answer;
    if (q.type === 'NUMERICAL') {
      ans = [].concat(ans).map(Number);
      if (!ans.length || ans.some((x) => !Number.isFinite(x))) throw bad('invalid_answer', 'Enter a number.');
      ans = ans.length === 1 ? ans[0] : ans;
    } else {
      const ids = new Set(q.options.map((o) => o.id));
      ans = [...new Set([].concat(ans).map((x) => String(x).toLowerCase()))].sort();
      if (!ans.length || ans.some((x) => !ids.has(x))) throw bad('invalid_answer', 'Choose valid option letters.');
      ans = q.type === 'MSQ' || ans.length > 1 ? ans : ans[0];
    }
    q.answer = ans;
  }
  rescoreExam(exam);
  audit(req.user.loginId, 'key.update', `${exam.title} ${q.id} ${JSON.stringify(b).slice(0, 100)}`);
  res.json({ ok: true, question: { id: q.id, answer: q.answer, dropped: !!q.dropped } });
});

// ---------------------------------------------------------------- results and analytics
adminRouter.get('/exams/:id/analytics', (req, res) => {
  sweepAll();
  const exam = getExam(req.params.id);
  const stats = cohort(exam, db.data.attempts);
  const done = db.data.attempts.filter((a) => a.examId === exam.id && a.status === 'submitted' && a.score);
  const questions = [];
  for (const s of exam.sections) {
    s.questions.forEach((q, i) => {
      let attempted = 0;
      let correct = 0;
      let time = 0;
      for (const a of done) {
        const r = a.score.questions[q.id];
        const resp = a.responses[q.id];
        if (resp?.a !== null && resp?.a !== undefined && resp?.a !== '') attempted++;
        if (r?.status === 'correct') correct++;
        time += resp?.t || 0;
      }
      questions.push({
        id: q.id,
        section: s.name,
        no: i + 1,
        type: q.type,
        text: q.text.slice(0, 90),
        dropped: !!q.dropped,
        attemptedPct: done.length ? (100 * attempted) / done.length : 0,
        correctPct: attempted ? (100 * correct) / attempted : 0,
        avgTimeSec: done.length ? Math.round(time / done.length / 1000) : 0,
      });
    });
  }
  const top = done
    .map((a) => ({ a, user: userById(a.userId) }))
    .sort((x, y) => y.a.score.total - x.a.score.total)
    .slice(0, 15)
    .map(({ a, user }) => ({
      name: user?.name,
      applicationNo: user?.loginId,
      total: a.score.total,
      percentile: percentileOf(stats.totals, a.score.total),
      rank: rankOf(stats.totals, a.score.total),
      violations: a.violations,
    }));
  res.json({
    exam: examRow(exam),
    cohort: { n: stats.n, mean: stats.mean, median: stats.median, max: stats.max, min: stats.min },
    histogram: histogram(stats.totals, exam),
    sectionMeans: exam.sections.map((s) => ({
      id: s.id,
      name: s.name,
      mean: stats.n ? stats.secTotals[s.id].reduce((x, y) => x + y, 0) / stats.n : 0,
      max: s.questions.reduce((m, q) => m + schemeFor(exam, s, q).correct, 0),
    })),
    questions,
    top,
    violationsTotal: done.reduce((n, a) => n + a.violations, 0),
    flagged: done.filter((a) => a.violations > 0).length,
  });
});

adminRouter.get('/exams/:id/results.csv', (req, res) => {
  const exam = getExam(req.params.id);
  const stats = cohort(exam, db.data.attempts);
  const done = db.data.attempts
    .filter((a) => a.examId === exam.id && a.status === 'submitted' && a.score)
    .sort((x, y) => y.score.total - x.score.total);
  const header = [
    'Rank',
    'Application no',
    'Name',
    'Total',
    'Max',
    'Percentile',
    ...exam.sections.map((s) => `${s.name} marks`),
    'Attempted',
    'Correct',
    'Wrong',
    'Violations',
    'Submitted by',
    'Submitted at',
  ];
  const lines = [csvRow(header)];
  for (const a of done) {
    const u = userById(a.userId);
    const secs = Object.values(a.score.sections);
    lines.push(
      csvRow([
        rankOf(stats.totals, a.score.total),
        u?.loginId,
        u?.name,
        a.score.total,
        a.score.max,
        percentileOf(stats.totals, a.score.total).toFixed(4),
        ...exam.sections.map((s) => a.score.sections[s.id].marks),
        secs.reduce((n, s) => n + s.attempted, 0),
        secs.reduce((n, s) => n + s.correct, 0),
        secs.reduce((n, s) => n + s.wrong, 0),
        a.violations,
        a.submitReason,
        new Date(a.submittedAt).toISOString(),
      ]),
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="results-${(exam.code || exam.id).replace(/[^\w-]/g, '')}.csv"`);
  res.send(lines.join('\r\n'));
});

// ---------------------------------------------------------------- candidates
adminRouter.get('/candidates', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const list = candidates()
    .filter((u) => !u.synthetic)
    .filter((u) => !q || u.name.toLowerCase().includes(q) || u.loginId.includes(q))
    .slice(0, 300)
    .map((u) => ({
      id: u.id,
      name: u.name,
      applicationNo: u.loginId,
      rollNo: u.rollNo,
      centre: u.centre,
      attempts: db.data.attempts.filter((a) => a.userId === u.id).length,
    }));
  res.json({ candidates: list, syntheticCount: candidates().filter((u) => u.synthetic).length });
});

adminRouter.post('/candidates/bulk', wrap(async (req, res) => {
  const count = Number(req.body?.count);
  if (!Number.isInteger(count) || count < 1 || count > 500) throw bad('invalid_count', 'Create between 1 and 500 candidates at a time.');
  const names = Array.isArray(req.body?.names) ? req.body.names.map((n) => String(n).trim().slice(0, 60)).filter(Boolean) : [];
  const centre = String(req.body?.centre || 'Pariksha Online Centre').trim().slice(0, 60);
  const existing = candidates().map((u) => Number(u.loginId.slice(-6))).filter(Number.isFinite);
  let n = Math.max(1000, ...existing) + 1;
  const created = [];
  for (let i = 0; i < count; i++, n++) {
    const password = randomPassword();
    const user = {
      id: id('u_'),
      role: 'candidate',
      loginId: `2610${String(n).padStart(8, '0')}`,
      name: names[i] || `Candidate ${n}`,
      rollNo: `PK26-${String(n).padStart(6, '0')}`,
      centre,
      passwordHash: await hashPassword(password),
    };
    db.data.users.push(user);
    created.push({ name: user.name, applicationNo: user.loginId, rollNo: user.rollNo, password });
  }
  audit(req.user.loginId, 'candidates.bulk_create', `${count} candidates`);
  save();
  res.status(201).json({ created });
}));

adminRouter.post('/candidates/:id/reset-password', wrap(async (req, res) => {
  const u = userById(req.params.id);
  if (!u || u.role !== 'candidate') throw new HttpError(404, 'not_found', 'Candidate not found.');
  const password = randomPassword();
  u.passwordHash = await hashPassword(password);
  audit(req.user.loginId, 'candidate.reset_password', u.loginId);
  save();
  res.json({ applicationNo: u.loginId, password });
}));

// ---------------------------------------------------------------- challenges
adminRouter.get('/challenges', (_req, res) => {
  const rows = db.data.challenges
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((c) => {
      const exam = db.data.exams.find((e) => e.id === c.examId);
      const q = exam && allQuestions(exam).find((x) => x.q.id === c.questionId);
      return {
        id: c.id,
        status: c.status,
        createdAt: c.createdAt,
        reason: c.reason,
        claim: c.claim,
        candidate: userById(c.userId)?.name,
        exam: exam?.title,
        examId: c.examId,
        questionId: c.questionId,
        question: q ? { section: q.section.name, text: q.q.text, type: q.q.type, options: q.q.options, answer: q.q.answer, dropped: !!q.q.dropped } : null,
      };
    });
  res.json({ challenges: rows });
});

// Resolving a challenge changes the key for everyone, then closes every pending
// challenge on that question the same way (the NTA approach).
adminRouter.post('/challenges/:id/resolve', (req, res) => {
  const ch = db.data.challenges.find((c) => c.id === req.params.id);
  if (!ch) throw new HttpError(404, 'not_found', 'Challenge not found.');
  if (ch.status !== 'pending') throw new HttpError(409, 'resolved', 'This challenge is already resolved.');
  const decision = req.body?.decision;
  if (!['accept', 'drop', 'reject'].includes(decision)) throw bad('invalid_decision', 'Choose accept, drop or reject.');
  const exam = getExam(ch.examId);
  const q = allQuestions(exam).find((x) => x.q.id === ch.questionId)?.q;
  if (!q) throw new HttpError(404, 'not_found', 'Question not found.');

  if (decision === 'accept') {
    let ans = req.body?.answer ?? ch.claim;
    try {
      if (q.type === 'NUMERICAL') {
        ans = [].concat(ans).map(Number);
        if (ans.some((x) => !Number.isFinite(x))) throw new Error('bad');
        ans = ans.length === 1 ? ans[0] : ans;
      } else {
        const ids = new Set(q.options.map((o) => o.id));
        ans = [...new Set([].concat(ans).map(String))].sort();
        if (!ans.length || ans.some((x) => !ids.has(x))) throw new Error('bad');
        ans = q.type === 'MSQ' || ans.length > 1 ? ans : ans[0];
      }
    } catch {
      throw bad('invalid_answer', 'The new answer is not valid for this question.');
    }
    q.answer = ans;
  }
  if (decision === 'drop') q.dropped = true;

  const status = decision === 'reject' ? 'rejected' : decision === 'drop' ? 'dropped' : 'accepted';
  for (const c of db.data.challenges) {
    if (c.questionId === ch.questionId && c.status === 'pending') {
      c.status = status;
      c.resolvedAt = Date.now();
    }
  }
  if (decision !== 'reject') rescoreExam(exam);
  audit(req.user.loginId, `challenge.${decision}`, `${exam.title} ${q.id}`);
  save();
  res.json({ ok: true, status });
});

// ---------------------------------------------------------------- audit
adminRouter.get('/audit', (_req, res) => res.json({ audit: db.data.audit.slice(-100).reverse() }));
