
import { Router } from 'express';
import crypto from 'node:crypto';
import { db, save, id } from '../db.js';
import { config } from '../config.js';
import { HttpError, bad, clamp } from '../util.js';
import {
  allQuestions,
  maxMarks,
  buildOrder,
  paperFor,
  schemeFor,
  parseAnswer
} from '../engine.js';
import {
  getExam,
  finalizeAttempt,
  sweepAttempt,
  remainingMs,
  buildResult
} from '../attempts.js';

export const candidateRouter = Router();

const windowState = (exam, now = Date.now()) =>
  now < exam.window.start
    ? 'upcoming'
    : now > exam.window.end
      ? 'closed'
      : 'open';

// Get the latest attempt for a student and exam
const findAttempt = (userId, examId) => {
  for (let i = db.data.attempts.length - 1; i >= 0; i--) {
    const a = db.data.attempts[i];

    if (a.userId === userId && a.examId === examId) {
      return a;
    }
  }

  return null;
};

// Build exam information for dashboard and instructions
function examCard(exam, attempt) {
  let analysis = null;

  if (attempt?.status === 'submitted') {
    const questions = Object.values(attempt.score?.questions || {});
    const correct = questions.filter((q) => q.status === 'correct').length;
    const wrong = questions.filter((q) => q.status === 'wrong').length;
    const attempted = Object.keys(attempt.responses || {}).filter((qid) => {
      const answer = attempt.responses[qid]?.a;
      return answer !== undefined && answer !== null && answer !== '' && !(Array.isArray(answer) && !answer.length);
    }).length;

    analysis = {
      submittedAt: attempt.submittedAt,
      score: attempt.score?.total ?? null,
      maxScore: maxMarks(exam),
      attempted,
      correct,
      wrong,
      questionCount: allQuestions(exam).length,
      accuracy: attempted ? Math.round((correct / attempted) * 100) : 0,
      published: !!exam.resultsPublished,
    };
  }

  return {
    analysis,
    id: exam.id,
    code: exam.code,
    title: exam.title,
    description: exam.description,
    durationMin: exam.durationMin,
    window: exam.window,
    windowState: windowState(exam),
    questionCount: allQuestions(exam).length,
    maxMarks: maxMarks(exam),
    sections: exam.sections.map((s) => ({
      id: s.id,
      name: s.name,
      count: s.questions.length
    })),
    status: attempt ? attempt.status : 'not_started',
    attemptId: attempt?.id,
    resultsPublished: !!exam.resultsPublished,
  };
}

function ownAttempt(req) {
  const a = db.data.attempts.find(
    (x) => x.id === req.params.id && x.userId === req.user.id
  );

  if (!a) {
    throw new HttpError(404, 'not_found', 'Attempt not found.');
  }

  return sweepAttempt(a);
}

// ----------------------------------------------------------------
// EXAMS
// ----------------------------------------------------------------

// Get all exams with the latest attempt status
candidateRouter.get('/exams', (req, res) => {
  const cards = db.data.exams.map((exam) => {
    const a = findAttempt(req.user.id, exam.id);

    if (a) {
      sweepAttempt(a);
    }

    return examCard(exam, a);
  });

  res.json({
    exams: cards,
    serverNow: Date.now()
  });
});

// Exam instructions
candidateRouter.get('/exams/:id/instructions', (req, res) => {
  const exam = getExam(req.params.id);

  const a = findAttempt(req.user.id, exam.id);

  if (a) {
    sweepAttempt(a);
  }

  const marking = [];

  for (const { section, q } of allQuestions(exam)) {
    if (marking.some((m) => m.type === q.type)) continue;

    const sc = schemeFor(exam, section, q);

    marking.push({
      type: q.type,
      correct: sc.correct,
      wrong: sc.wrong,
      partial: q.type === 'MSQ' ? sc.partial : undefined
    });
  }

  res.json({
    exam: examCard(exam, a),
    instructions: exam.instructions,
    marking,
    maxViolations: exam.maxViolations
  });
});

// ----------------------------------------------------------------
// START EXAM - MULTIPLE ATTEMPTS SUPPORTED
// ----------------------------------------------------------------

candidateRouter.post('/exams/:id/start', (req, res) => {
  const exam = getExam(req.params.id);

  // Find the student's latest attempt
  const existing = findAttempt(req.user.id, exam.id);

  if (existing) {
    sweepAttempt(existing);

    // Resume if an attempt is already running
    if (existing.status === 'in_progress') {
      return res.json({
        attemptId: existing.id
      });
    }

    // If submitted, execution continues and a new attempt is created.
  }

  // Check exam availability
  const state = windowState(exam);

  if (state === 'upcoming') {
    throw new HttpError(
      403,
      'not_open_yet',
      'This exam has not opened yet.'
    );
  }

  if (state === 'closed') {
    throw new HttpError(
      403,
      'closed',
      'This exam is closed.'
    );
  }

  const now = Date.now();
  const seed = crypto.randomInt(1, 2 ** 31 - 1);

  // Create a completely new attempt
  const attempt = {
    id: id('at_'),
    examId: exam.id,
    userId: req.user.id,
    status: 'in_progress',
    startedAt: now,
    endsAt: now + Math.round(exam.durationMin * 60000),
    extraMs: 0,
    seed,
    order: buildOrder(exam, seed),
    responses: {},
    violations: 0,
    events: [],
    lastSeenAt: now,
    ip: req.ip,
  };

  db.data.attempts.push(attempt);

  save();

  res.status(201).json({
    attemptId: attempt.id
  });
});

// ----------------------------------------------------------------
// ATTEMPT
// ----------------------------------------------------------------

// Get attempt and question paper
candidateRouter.get('/attempts/:id', (req, res) => {
  const a = ownAttempt(req);
  const exam = getExam(a.examId);

  if (a.status === 'submitted') {
    return res.json({
      attempt: {
        id: a.id,
        status: 'submitted'
      }
    });
  }

  a.lastSeenAt = Date.now();

  res.json({
    attempt: {
      id: a.id,
      status: a.status,
      startedAt: a.startedAt,
      endsAt: a.endsAt,
      serverNow: Date.now(),
      remainingMs: remainingMs(a),
      violations: a.violations,
    },

    exam: {
      id: exam.id,
      title: exam.title,
      code: exam.code,
      durationMin: exam.durationMin,
      maxViolations: exam.maxViolations
    },

    candidate: {
      name: req.user.name,
      applicationNo: req.user.loginId,
      rollNo: req.user.rollNo
    },

    paper: paperFor(exam, a),
    responses: a.responses
  });
});

// Save answers
candidateRouter.put('/attempts/:id/responses/:qid', (req, res) => {
  const a = ownAttempt(req);

  if (a.status !== 'in_progress') {
    throw new HttpError(
      409,
      'time_over',
      'This exam has been submitted.'
    );
  }

  const exam = getExam(a.examId);

  const q = allQuestions(exam).find(
    (x) => x.q.id === req.params.qid
  )?.q;

  if (!q) {
    throw new HttpError(404, 'not_found', 'Question not found.');
  }

  const body = req.body || {};

  const resp = (a.responses[q.id] ||= {
    a: null,
    m: false,
    v: false,
    t: 0
  });

  if ('a' in body) {
    try {
      resp.a = parseAnswer(q, body.a);
    } catch (e) {
      if (e.invalid) {
        throw bad(
          'invalid_answer',
          'That answer is not valid for this question.'
        );
      }

      throw e;
    }
  }

  if ('m' in body) {
    resp.m = !!body.m;
  }

  if (body.v) {
    resp.v = true;
  }

  if (Number.isFinite(body.t)) {
    resp.t += clamp(
      Math.round(body.t),
      0,
      10 * 60000
    );
  }

  a.lastSeenAt = Date.now();

  save();

  res.json({
    ok: true,
    remainingMs: remainingMs(a),
    serverNow: Date.now()
  });
});

// Heartbeat
candidateRouter.post('/attempts/:id/heartbeat', (req, res) => {
  const a = ownAttempt(req);

  a.lastSeenAt = Date.now();

  res.json({
    status: a.status,
    remainingMs: remainingMs(a),
    serverNow: Date.now()
  });
});

// ----------------------------------------------------------------
// EXAM VIOLATIONS
// ----------------------------------------------------------------

const VIOLATION_TYPES = new Set([
  'tab_hidden',
  'fullscreen_exit',
  'window_blur'
]);

candidateRouter.post('/attempts/:id/events', (req, res) => {
  const a = ownAttempt(req);

  if (a.status !== 'in_progress') {
    return res.json({
      status: a.status,
      violations: a.violations
    });
  }

  const exam = getExam(a.examId);

  const type = String(req.body?.type || '').slice(0, 30);

  if (a.events.length < 300) {
    a.events.push({
      at: Date.now(),
      type
    });
  }

  if (VIOLATION_TYPES.has(type)) {
    a.violations += 1;
  }

  let autoSubmitted = false;

  if (
    exam.maxViolations > 0 &&
    a.violations >= exam.maxViolations
  ) {
    finalizeAttempt(a, 'violations');
    autoSubmitted = true;
  }

  save();

  res.json({
    status: a.status,
    violations: a.violations,
    autoSubmitted
  });
});

// ----------------------------------------------------------------
// SUBMIT EXAM
// ----------------------------------------------------------------

candidateRouter.post('/attempts/:id/submit', (req, res) => {
  const a = ownAttempt(req);

  // Preserve independent results for every attempt
  finalizeAttempt(
    a,
    Date.now() >= a.endsAt ? 'timeout' : 'manual'
  );

  res.json({
    status: 'submitted',
    attemptId: a.id
  });
});

// ----------------------------------------------------------------
// RESULT
// ----------------------------------------------------------------

candidateRouter.get('/attempts/:id/result', (req, res) => {
  const a = ownAttempt(req);

  if (a.status !== 'submitted') {
    throw new HttpError(
      409,
      'not_submitted',
      'Submit the exam to see your result.'
    );
  }

  res.json(
    buildResult(
      getExam(a.examId),
      a,
      req.user
    )
  );
});

// ----------------------------------------------------------------
// ANSWER-KEY CHALLENGES
// ----------------------------------------------------------------

candidateRouter.get('/attempts/:id/challenges', (req, res) => {
  const a = ownAttempt(req);

  res.json({
    challenges: db.data.challenges.filter(
      (c) => c.attemptId === a.id
    )
  });
});

candidateRouter.post('/attempts/:id/challenges', (req, res) => {
  const a = ownAttempt(req);
  const exam = getExam(a.examId);

  if (a.status !== 'submitted' || !exam.resultsPublished) {
    throw new HttpError(
      409,
      'not_available',
      'Challenges open after results are published.'
    );
  }

  if (!exam.challengeOpen) {
    throw new HttpError(
      409,
      'challenge_closed',
      'The challenge window for this exam is closed.'
    );
  }

  const { questionId, claim, reason } = req.body || {};

  const q = allQuestions(exam).find(
    (x) => x.q.id === questionId
  )?.q;

  if (!q) {
    throw new HttpError(
      404,
      'not_found',
      'Question not found.'
    );
  }

  if (
    typeof reason !== 'string' ||
    reason.trim().length < 10 ||
    reason.trim().length > 500
  ) {
    throw bad(
      'invalid_reason',
      'Explain your challenge in 10 to 500 characters.'
    );
  }

  let parsed;

  try {
    parsed = parseAnswer(q, claim);
  } catch {
    throw bad(
      'invalid_answer',
      'Choose the answer you believe is correct.'
    );
  }

  if (parsed === null) {
    throw bad(
      'invalid_answer',
      'Choose the answer you believe is correct.'
    );
  }

  if (
    db.data.challenges.some(
      (c) =>
        c.userId === req.user.id &&
        c.questionId === q.id
    )
  ) {
    throw new HttpError(
      409,
      'duplicate',
      'You have already challenged this question.'
    );
  }

  const ch = {
    id: id('ch_'),
    examId: exam.id,
    attemptId: a.id,
    userId: req.user.id,
    questionId: q.id,
    claim: parsed,
    reason: reason.trim(),
    status: 'pending',
    createdAt: Date.now(),
  };

  db.data.challenges.push(ch);

  save();

  res.status(201).json({
    challenge: ch
  });
});
