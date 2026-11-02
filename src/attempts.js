import { db, save } from './db.js';
import { config } from './config.js';
import { HttpError } from './util.js';
import {
  evaluateAttempt,
  invalidateStats,
  cohort,
  percentileOf,
  rankOf,
  histogram,
  allQuestions,
  maxMarks,
  schemeFor,
} from './engine.js';

export function getExam(examId) {
  const e = db.data.exams.find((x) => x.id === examId);
  if (!e) throw new HttpError(404, 'not_found', 'Exam not found.');
  return e;
}

export const remainingMs = (a, now = Date.now()) => Math.max(0, a.endsAt - now);

export function finalizeAttempt(a, reason = 'manual', now = Date.now()) {
  if (a.status === 'submitted') return a;
  const exam = getExam(a.examId);
  a.status = 'submitted';
  a.submitReason = reason;
  // A timed-out paper is stamped at its deadline, not at whenever the sweeper noticed.
  a.submittedAt = reason === 'timeout' ? Math.min(now, a.endsAt) : now;
  a.score = evaluateAttempt(exam, a);
  invalidateStats(a.examId);
  save();
  return a;
}

// Lazily closes an attempt whose time is over. Called on every read and by the sweeper.
export function sweepAttempt(a, now = Date.now()) {
  if (a.status === 'in_progress' && now > a.endsAt + config.graceMs) finalizeAttempt(a, 'timeout', now);
  return a;
}

export function sweepAll(now = Date.now()) {
  for (const a of db.data.attempts) sweepAttempt(a, now);
}

// Re-scores every submitted attempt of an exam, e.g. after the answer key changes.
export function rescoreExam(exam) {
  for (const a of db.data.attempts) {
    if (a.examId === exam.id && a.status === 'submitted') a.score = evaluateAttempt(exam, a);
  }
  invalidateStats(exam.id);
  save();
}

export function buildResult(exam, attempt, user) {
  const qs = allQuestions(exam);
  const answeredCount = qs.filter(({ q }) => {
    const a = attempt.responses[q.id]?.a;
    return a !== undefined && a !== null && a !== '' && !(Array.isArray(a) && !a.length);
  }).length;

  const base = {
    exam: { id: exam.id, code: exam.code, title: exam.title, durationMin: exam.durationMin },
    candidate: { name: user.name, applicationNo: user.loginId, rollNo: user.rollNo, centre: user.centre },
    attempt: {
      id: attempt.id,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      submitReason: attempt.submitReason,
      violations: attempt.violations,
    },
    published: !!exam.resultsPublished,
    challengeOpen: !!exam.challengeOpen,
    attemptedCount: answeredCount,
    questionCount: qs.length,
  };
  if (!exam.resultsPublished) return base;

  const stats = cohort(exam, db.data.attempts);
  const score = attempt.score;
  const sections = exam.sections.map((s) => ({
    id: s.id,
    ...score.sections[s.id],
    percentile: percentileOf(stats.secTotals[s.id], score.sections[s.id].marks),
  }));
  const myChallenges = db.data.challenges.filter((c) => c.attemptId === attempt.id);

  const questions = [];
  for (const s of exam.sections) {
    const byId = new Map(s.questions.map((q) => [q.id, q]));
    (attempt.order[s.id] || []).forEach((qid, i) => {
      const q = byId.get(qid);
      const r = score.questions[qid];
      const ch = myChallenges.find((c) => c.questionId === qid);
      questions.push({
        id: qid,
        section: s.name,
        no: i + 1,
        type: q.type,
        text: q.text,
        options: q.options,
        yourAnswer: attempt.responses[qid]?.a ?? null,
        correctAnswer: q.answer,
        dropped: !!q.dropped,
        explanation: q.explanation || '',
        status: r.status,
        marks: r.marks,
        maxMarks: schemeFor(exam, s, q).correct,
        timeMs: attempt.responses[qid]?.t || 0,
        challenge: ch ? { status: ch.status } : null,
      });
    });
  }

  return {
    ...base,
    score: { total: score.total, max: maxMarks(exam) },
    percentile: percentileOf(stats.totals, score.total),
    rank: rankOf(stats.totals, score.total),
    sections,
    cohort: {
      n: stats.n,
      mean: stats.mean,
      median: stats.median,
      max: stats.max,
      histogram: histogram(stats.totals, exam),
    },
    questions,
  };
}
