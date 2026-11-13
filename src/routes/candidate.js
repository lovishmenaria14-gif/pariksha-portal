
import { Router } from 'express';
import crypto from 'node:crypto';
import { db, save, flush, id, refreshDatabase } from '../db.js';
import { config } from '../config.js';
import { HttpError, bad, clamp } from '../util.js';
import {
  allQuestions,
  maxMarks,
  buildOrder,
  paperFor,
  schemeFor,
  parseAnswer,
  evaluateQuestion
  DEFAULT_INSTRUCTIONS
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

const practiceDifficulty = (value) => {
  if (['easy', 'medium', 'hard'].includes(value)) return value;
  if (typeof value === 'number' && value >= 0 && value <= 1) {
    return value <= 0.1 ? 'easy' : value <= 0.2 ? 'medium' : 'hard';
  }
  return 'medium';
};

// ----------------------------------------------------------------
// STREAK SYSTEM
// ----------------------------------------------------------------

// Return the local calendar date (YYYY-MM-DD) for a timestamp.
// Constructed from local components so it is never affected by UTC offset.
function localDateStr(ms = Date.now()) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Add/subtract calendar days on a YYYY-MM-DD string using local time.
function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const shifted = new Date(y, m - 1, d + days);
  const sy = shifted.getFullYear();
  const sm = String(shifted.getMonth() + 1).padStart(2, '0');
  const sd = String(shifted.getDate()).padStart(2, '0');
  return `${sy}-${sm}-${sd}`;
}

// Record a meaningful study activity for a user at calendar-day level.
// Same-day deduplication: multiple activities on the same date count as one active day.
function recordActivity(userId, dateStr, activityType) {
  if (!userId || !dateStr) return;
  const exists = db.data.activity.some(
    (a) => a.userId === userId && a.date === dateStr
  );
  if (!exists) {
    db.data.activity.push({
      id: id('ac_'),
      userId,
      date: dateStr,
      activityType,
      at: Date.now(),
    });
    save();
  }
}

// Get all distinct active dates for a user, sorted ascending.
function userActivityDates(userId) {
  return db.data.activity
    .filter((a) => a.userId === userId)
    .map((a) => a.date)
    .filter((d, i, arr) => arr.indexOf(d) === i)
    .sort();
}

// Calculate current streak, longest streak, and today's status.
function calculateStreak(activityDates, todayDate) {
  const dateSet = new Set(activityDates);

  // Current streak: count backwards from today.
  let currentStreak = 0;
  let cursor = todayDate;
  while (dateSet.has(cursor)) {
    currentStreak++;
    cursor = shiftDate(cursor, -1);
  }

  // If today is inactive but yesterday was active, the streak still counts
  // from yesterday (user hasn't broken it yet, just hasn't studied today).
  if (currentStreak === 0) {
    const yesterday = shiftDate(todayDate, -1);
    if (dateSet.has(yesterday)) {
      currentStreak = 1;
      cursor = shiftDate(yesterday, -1);
      while (dateSet.has(cursor)) {
        currentStreak++;
        cursor = shiftDate(cursor, -1);
      }
    }
  }

  // Longest streak: longest run of consecutive active dates in history.
  let longestStreak = 0;
  let run = 0;
  let prev = null;
  for (const d of activityDates) {
    if (prev && d === shiftDate(prev, 1)) {
      run++;
    } else {
      run = 1;
    }
    longestStreak = Math.max(longestStreak, run);
    prev = d;
  }

  return {
    currentStreak,
    longestStreak,
    todayActive: dateSet.has(todayDate),
  };
}

// Motivational copy based on streak length.
function streakCopy(streak) {
  if (streak === 0) return 'Start your preparation today.';
  if (streak === 1) return 'Great start! Come back tomorrow to keep your streak alive.';
  if (streak === 2) return 'Two days strong! Keep the momentum going.';
  if (streak === 3) return 'You\'re building momentum! 🔥';
  if (streak < 7) return 'Great consistency. Keep going.';
  if (streak < 14) return 'One week strong! Keep going.';
  if (streak < 30) return 'Two weeks of consistency!';
  if (streak < 60) return '30 days! Your consistency is impressive.';
  if (streak < 100) return 'You\'re on a serious roll. Keep it up.';
  return 'Incredible dedication. Keep going.';
}

// Milestone streaks worth celebrating.
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];

// GET /api/streak — returns calculated streak data for the authenticated user.
candidateRouter.get('/streak', (req, res) => {
  const today = localDateStr();
  const dates = userActivityDates(req.user.id);
  const streak = calculateStreak(dates, today);
  const recent = dates
    .slice(-30)
    .map((d) => ({ date: d, active: true }));
  // Build last-7-day activity map for the weekly visualization.
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = shiftDate(today, -i);
    week.push({
      date: d,
      active: dateSetHas(dates, d),
      dayName: new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }),
    });
  }

  res.json({
    today,
    todayActive: streak.todayActive,
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    copy: streakCopy(streak.currentStreak),
    milestone: STREAK_MILESTONES.includes(streak.currentStreak)
      ? streak.currentStreak
      : null,
    week,
  });
});

// POST /api/activity — record a meaningful activity (client-reported, server-validated).
candidateRouter.post('/activity', async (req, res) => {
  const { date, activityType } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw bad('invalid_date', 'Provide a valid date in YYYY-MM-DD format.');
  }
  if (!activityType || typeof activityType !== 'string') {
    throw bad('invalid_activity', 'Provide an activity type.');
  }
  recordActivity(req.user.id, date, activityType);
  res.json({ ok: true });
});

function dateSetHas(dates, target) {
  for (const d of dates) if (d === target) return true;
  return false;
}

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
  let inProgress = null;

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
      startedAt: attempt.startedAt,
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

  if (attempt?.status === 'in_progress') {
    const qs = allQuestions(exam);
    const answered = qs.filter(({ q }) => {
      const a = attempt.responses?.[q.id]?.a;
      return a !== undefined && a !== null && a !== '' && !(Array.isArray(a) && !a.length);
    }).length;
    inProgress = {
      attemptId: attempt.id,
      startedAt: attempt.startedAt,
      lastActiveAt: attempt.lastSeenAt || attempt.startedAt,
      answeredCount: answered,
      totalQuestions: qs.length,
      progress: qs.length ? Math.round((answered / qs.length) * 100) : 0,
      markedCount: qs.filter(({ q }) => attempt.responses?.[q.id]?.m).length,
      currentQuestionId: attempt.currentQuestionId || null,
    };
  }

  return {
    analysis,
    inProgress,
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
// QUESTION BOOKMARKS
// ----------------------------------------------------------------

candidateRouter.get('/bookmarks', (req, res) => {
  db.data.bookmarks ||= [];
  const bookmarks = db.data.bookmarks
    .filter((b) => b.userId === req.user.id)
    .sort((a, b) => (b.bookmarkedAt || 0) - (a.bookmarkedAt || 0))
    .map((b) => {
      const exam = db.data.exams.find((e) => e.id === b.examId);
      return {
        ...b,
        examTitle: exam?.title || b.examTitle || 'Examination',
        examCode: exam?.code || b.examCode || ''
      };
    });

  res.json({ bookmarks });
});

candidateRouter.put('/attempts/:id/bookmarks/:qid', (req, res) => {
  const a = ownAttempt(req);
  const exam = getExam(a.examId);
  const found = allQuestions(exam).find((item) => item.q.id === req.params.qid);

  if (!found) {
    throw new HttpError(404, 'not_found', 'Question not found.');
  }

  db.data.bookmarks ||= [];
  let bookmark = db.data.bookmarks.find(
    (b) => b.userId === req.user.id && b.questionId === found.q.id && b.examId === exam.id
  );

  if (!bookmark) {
    bookmark = {
      id: id('bookmark_'),
      userId: req.user.id,
      questionId: found.q.id,
      examId: exam.id,
      examTitle: exam.title,
      examCode: exam.code,
      attemptId: a.id,
      sectionName: found.section.name,
      question: found.q,
      bookmarkedAt: Date.now()
    };
    db.data.bookmarks.push(bookmark);
    save();
  }

  res.json({ ok: true, bookmarked: true, bookmark });
});

candidateRouter.delete('/attempts/:id/bookmarks/:qid', (req, res) => {
  const a = ownAttempt(req);
  db.data.bookmarks ||= [];
  const before = db.data.bookmarks.length;
  db.data.bookmarks = db.data.bookmarks.filter(
    (b) => !(b.userId === req.user.id && b.examId === a.examId && b.questionId === req.params.qid)
  );

  if (db.data.bookmarks.length !== before) save();
  res.json({ ok: true, bookmarked: false });
});

// ----------------------------------------------------------------
// PRACTICE QUESTION BOOKMARKS
// ----------------------------------------------------------------

candidateRouter.put('/practice/bookmarks/:qid', (req, res) => {
  let found = null;
  for (const exam of db.data.exams) {
    for (const section of exam.sections) {
      const q = section.questions.find((quest) => quest.id === req.params.qid);
      if (q && !q.dropped) {
        found = { q, section, exam };
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    throw new HttpError(404, 'not_found', 'Question not found.');
  }

  db.data.bookmarks ||= [];
  let bookmark = db.data.bookmarks.find(
    (b) => b.userId === req.user.id && b.questionId === found.q.id
  );

  if (!bookmark) {
    bookmark = {
      id: id('bookmark_'),
      userId: req.user.id,
      questionId: found.q.id,
      examId: null,
      examTitle: 'Practice',
      examCode: 'PRACTICE',
      attemptId: null,
      sectionName: found.section.name,
      question: {
        id: found.q.id,
        text: found.q.text,
        type: found.q.type,
        options: found.q.options?.map((opt) => ({ id: opt.id, text: opt.text }))
      },
      bookmarkedAt: Date.now()
    };
    db.data.bookmarks.push(bookmark);
    save();
  }

  res.json({ ok: true, bookmarked: true, bookmark });
});

candidateRouter.delete('/practice/bookmarks/:qid', (req, res) => {
  db.data.bookmarks ||= [];
  const before = db.data.bookmarks.length;
  db.data.bookmarks = db.data.bookmarks.filter(
    (b) => !(b.userId === req.user.id && b.questionId === req.params.qid)
  );

  if (db.data.bookmarks.length !== before) save();
  res.json({ ok: true, bookmarked: false });
});

// ----------------------------------------------------------------
// ANNOUNCEMENTS
// ----------------------------------------------------------------
candidateRouter.get('/notifications', async (req, res) => {
  db.data.announcements ||= [];
  db.data.supportTickets ||= [];
  const announcements = db.data.announcements
    .filter((item) => item.published !== false && (!item.audience || item.audience === 'all' || item.audience === 'candidates'))
    .slice()
    .map((item) => ({
      ...item,
      isRead: Array.isArray(item.readBy) && item.readBy.includes(req.user.id),
    }));
  const supportUpdates = db.data.supportTickets
    .filter((ticket) => ticket.userId === req.user.id && ticket.candidateNotification)
    .map((ticket) => ({
      id: `support_${ticket.id}`,
      kind: 'support_ticket',
      type: 'support',
      title: ticket.subject,
      message: ticket.candidateNotification.message,
      createdAt: ticket.candidateNotification.createdAt,
      createdBy: 'Support team',
      isRead: !ticket.candidateUnread,
      ticketId: ticket.id,
    }));

  res.json({
    notifications: [...announcements, ...supportUpdates]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  });
});

candidateRouter.post('/notifications/:id/read', async (req, res) => {
  db.data.announcements ||= [];
  const announcement = db.data.announcements.find((item) => item.id === req.params.id);
  if (!announcement) throw new HttpError(404, 'notification_not_found', 'Notification not found.');
  announcement.readBy ||= [];
  if (!announcement.readBy.includes(req.user.id)) announcement.readBy.push(req.user.id);
  await flush();
  res.json({ ok: true });
});

candidateRouter.post('/notifications/read-all', async (req, res) => {
  db.data.announcements ||= [];
  db.data.supportTickets ||= [];
  for (const announcement of db.data.announcements) {
    announcement.readBy ||= [];
    if (!announcement.readBy.includes(req.user.id)) announcement.readBy.push(req.user.id);
  }
  for (const ticket of db.data.supportTickets) {
    if (ticket.userId === req.user.id) ticket.candidateUnread = false;
  }
  await flush();
  res.json({ ok: true });
});

// ----------------------------------------------------------------
// CANDIDATE SUPPORT TICKETS
// ----------------------------------------------------------------

const SUPPORT_CATEGORIES = [
  'Account & Login',
  'Examination',
  'Results & Score',
  'Technical Issue',
  'Other',
];

function ownSupportTicket(req) {
  db.data.supportTickets ||= [];

  const ticket = db.data.supportTickets.find(
    (item) =>
      item.id === req.params.id &&
      item.userId === req.user.id
  );

  if (!ticket) {
    throw new HttpError(404, 'ticket_not_found', 'Support ticket not found.');
  }

  return ticket;
}

// List only the logged-in candidate's tickets
candidateRouter.get('/support-tickets', (req, res) => {
  db.data.supportTickets ||= [];

  const tickets = db.data.supportTickets
    .filter((ticket) => ticket.userId === req.user.id)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  res.json({ tickets });
});

// Get one ticket and its conversation
candidateRouter.get('/support-tickets/:id', (req, res) => {
  const ticket = ownSupportTicket(req);
  res.json({ ticket });
});

// Mark an update as read when the candidate opens the ticket conversation.
candidateRouter.post('/support-tickets/:id/read', async (req, res) => {
  const ticket = ownSupportTicket(req);
  ticket.candidateUnread = false;
  await flush();
  res.json({ ok: true });
});

// Create a support ticket
candidateRouter.post('/support-tickets', async (req, res) => {
  const subject = typeof req.body?.subject === 'string'
    ? req.body.subject.trim()
    : '';

  const description = typeof req.body?.description === 'string'
    ? req.body.description.trim()
    : '';

  const category = typeof req.body?.category === 'string'
    ? req.body.category
    : '';

  if (subject.length < 5 || subject.length > 120) {
    throw bad('invalid_subject', 'Subject must be between 5 and 120 characters.');
  }

  if (description.length < 10 || description.length > 3000) {
    throw bad('invalid_description', 'Description must be between 10 and 3000 characters.');
  }

  if (!SUPPORT_CATEGORIES.includes(category)) {
    throw bad('invalid_category', 'Choose a valid support category.');
  }

  db.data.supportTickets ||= [];

  const now = Date.now();

  const ticket = {
    id: id('ticket_'),
    userId: req.user.id,
    candidateName: req.user.name || '',
    applicationNo: req.user.loginId || '',
    subject,
    category,
    description,
    status: 'open',
    replies: [],
    createdAt: now,
    updatedAt: now,
  };

  db.data.supportTickets.push(ticket);
  await flush();

  res.status(201).json({ ticket });
});

// ----------------------------------------------------------------
// PRACTICE
// ----------------------------------------------------------------
candidateRouter.get('/practice/bank', (_req, res) => {
  const subjects = new Map();
  const seenQuestionIds = new Set();
  for (const exam of db.data.exams) {
    for (const section of exam.sections) {
      for (const q of section.questions) {
        if (q.dropped || seenQuestionIds.has(q.id)) continue;
        seenQuestionIds.add(q.id);
        const name = section.name;
        const subject = subjects.get(name) || { name, count: 0, difficulties: { easy: 0, medium: 0, hard: 0 } };
        const difficulty = practiceDifficulty(q.difficulty);
        subject.count++;
        subject.difficulties[difficulty]++;
        subjects.set(name, subject);
      }
    }
  }
  res.json({ subjects: [...subjects.values()].sort((a, b) => a.name.localeCompare(b.name)) });
});

candidateRouter.get('/practice/questions', (req, res) => {
  const subject = typeof req.query.subject === 'string' ? req.query.subject : '';
  const difficulty = typeof req.query.difficulty === 'string' ? req.query.difficulty : 'all';
  if (difficulty !== 'all' && !['easy', 'medium', 'hard'].includes(difficulty)) {
    throw bad('invalid_difficulty', 'Choose easy, medium or hard difficulty.');
  }
  const questions = [];
  const seenQuestionIds = new Set();
  for (const exam of db.data.exams) {
    for (const section of exam.sections) {
      if (subject && section.name !== subject) continue;
      for (const q of section.questions) {
        if (q.dropped || seenQuestionIds.has(q.id)) continue;
        seenQuestionIds.add(q.id);
        const level = practiceDifficulty(q.difficulty);
        if (difficulty !== 'all' && level !== difficulty) continue;
        questions.push({
          id: q.id,
          subject: section.name,
          type: q.type,
          text: q.text,
          options: q.options?.map((option) => ({ id: option.id, text: option.text })),
          difficulty: level,
        });
      }
    }
  }
  res.json({ questions });
});

candidateRouter.post('/practice/questions/:qid/check', (req, res) => {
  const item = db.data.exams.flatMap((exam) => allQuestions(exam))
    .find(({ q }) => q.id === req.params.qid);
  if (!item || item.q.dropped) throw new HttpError(404, 'not_found', 'Practice question not found.');
  let answer;
  try {
    answer = parseAnswer(item.q, req.body?.answer);
  } catch {
    throw bad('invalid_answer', 'Enter a valid answer before checking.');
  }
  if (answer === null || (Array.isArray(answer) && answer.length === 0)) {
    throw bad('answer_required', 'Choose or enter an answer before checking.');
  }
  const result = evaluateQuestion(item.q, { a: answer }, { correct: 1, wrong: 0, partial: 0 });
  recordActivity(req.user.id, localDateStr(), 'practice_question');
  res.json({
    status: result.status,
    correctAnswer: item.q.answer,
    explanation: item.q.explanation || '',
  });
});

// ----------------------------------------------------------------
// PROFILE
// ----------------------------------------------------------------
candidateRouter.get('/profile', (req, res) => {
  res.json({
    profile: {
      name: req.user.name || '',
      email: req.user.email || '',
      phone: req.user.phone || '',
      photoURL: req.user.photoURL || '',
      applicationNo: req.user.loginId || '',
      rollNo: req.user.rollNo || '',
      centre: req.user.centre || '',
    },
  });
});

candidateRouter.put('/profile', async (req, res, next) => {
  try {
    const { name, email, phone, photoURL } = req.body || {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      throw bad('invalid_name', 'Enter your name (2–80 characters).');
    }
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw bad('invalid_email', 'Enter a valid email address.');
    }
    if (phone !== undefined && (typeof phone !== 'string' || phone.length > 20)) {
      throw bad('invalid_phone', 'Enter a valid phone number.');
    }
    if (photoURL !== undefined && typeof photoURL !== 'string') {
      throw bad('invalid_photo', 'Choose a valid profile photo.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (db.data.users.some((u) => u.id !== req.user.id && u.email?.toLowerCase() === normalizedEmail)) {
      throw new HttpError(409, 'email_exists', 'Another account already uses this email.');
    }

    req.user.name = name.trim();
    req.user.email = normalizedEmail;
    req.user.phone = typeof phone === 'string' ? phone.trim() : '';
    if (typeof photoURL === 'string') {
      if (photoURL.length > 900000 || (photoURL && !/^data:image\/(jpeg|png|webp);base64,/i.test(photoURL) && !/^https?:\/\//i.test(photoURL))) {
        throw bad('invalid_photo', 'Use a JPEG, PNG or WebP image smaller than 650 KB.');
      }
      req.user.photoURL = photoURL;
    }
    await flush();

    res.json({ profile: {
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      photoURL: req.user.photoURL || '',
      applicationNo: req.user.loginId || '',
      rollNo: req.user.rollNo || '',
      centre: req.user.centre || '',
    } });
  } catch (error) {
    next(error);
  }
});

// ----------------------------------------------------------------
// EXAMS
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// DAILY EXAM PAPERS GENERATOR
// ----------------------------------------------------------------

const DAILY_SCHEDULE = [
  {
    topic: 'Physics: Kinematics & Mechanics',
    durationMin: 20,
    sections: [
      {
        id: 'phy',
        name: 'Physics',
        questions: [
          { type: 'MCQ', text: 'A body of mass 2 kg moves with a speed of 3 m/s. Its kinetic energy is', options: [{ id: 'a', text: '3 J' }, { id: 'b', text: '6 J' }, { id: 'c', text: '9 J' }, { id: 'd', text: '18 J' }], answer: 'c', difficulty: 0.05, explanation: 'KE = (1/2) m v^{2} = 0.5 x 2 x 3^{2} = 9 J.' },
          { type: 'MCQ', text: 'A ball is dropped from a height of 20 m. Taking g = 10 m/s^{2}, the time it takes to reach the ground is', options: [{ id: 'a', text: '1 s' }, { id: 'b', text: '2 s' }, { id: 'c', text: '3 s' }, { id: 'd', text: '4 s' }], answer: 'b', difficulty: 0.05, explanation: 't = √(2h/g) = √(2 x 20 / 10) = 2 s.' },
          { type: 'NUMERICAL', text: 'A car starts from rest and accelerates uniformly at 2 m/s^{2} for 5 s. The distance covered, in metres, is', answer: 25, tolerance: 0.01, difficulty: 0.1, explanation: 's = (1/2) a t^{2} = 0.5 x 2 x 25 = 25 m.' }
        ]
      }
    ]
  },
  {
    topic: 'Chemistry: Structure & Chemical Bonding',
    durationMin: 20,
    sections: [
      {
        id: 'chem',
        name: 'Chemistry',
        questions: [
          { type: 'MCQ', text: 'The hybridisation of carbon in ethene (C_{2}H_{4}) is', options: [{ id: 'a', text: 'sp' }, { id: 'b', text: 'sp^{2}' }, { id: 'c', text: 'sp^{3}' }, { id: 'd', text: 'sp^{3}d' }], answer: 'b', difficulty: 0.1, explanation: 'Each carbon forms three sigma bonds and one pi bond, so it is sp^{2} hybridised.' },
          { type: 'MCQ', text: 'Which of these elements has the highest electronegativity?', options: [{ id: 'a', text: 'Oxygen' }, { id: 'b', text: 'Nitrogen' }, { id: 'c', text: 'Fluorine' }, { id: 'd', text: 'Chlorine' }], answer: 'c', difficulty: 0.05, explanation: 'Fluorine is the most electronegative element on the Pauling scale (3.98).' },
          { type: 'NUMERICAL', text: 'The number of sigma (σ) bonds in a molecule of ethane (C_{2}H_{6}) is', answer: 7, tolerance: 0.01, difficulty: 0.15, explanation: 'Six C-H bonds and one C-C bond: 7 sigma bonds.' }
        ]
      }
    ]
  },
  {
    topic: 'Mathematics: Differential Calculus & Algebra',
    durationMin: 20,
    sections: [
      {
        id: 'math',
        name: 'Mathematics',
        questions: [
          { type: 'MCQ', text: 'The derivative of sin x · cos x with respect to x is', options: [{ id: 'a', text: 'sin 2x' }, { id: 'b', text: 'cos 2x' }, { id: 'c', text: '2 cos 2x' }, { id: 'd', text: '-cos 2x' }], answer: 'b', difficulty: 0.15, explanation: 'sin x cos x = (1/2) sin 2x, so the derivative is cos 2x.' },
          { type: 'MCQ', text: 'The sum of the roots of x^{2} - 5x + 6 = 0 is', options: [{ id: 'a', text: '5' }, { id: 'b', text: '6' }, { id: 'c', text: '-5' }, { id: 'd', text: '-6' }], answer: 'a', difficulty: 0.05, explanation: 'Sum of roots = -b/a = 5.' },
          { type: 'NUMERICAL', text: 'The sum of the first 20 natural numbers is', answer: 210, tolerance: 0.01, difficulty: 0.1, explanation: 'n(n+1)/2 = 20 x 21 / 2 = 210.' }
        ]
      }
    ]
  },
  {
    topic: 'Physics: Electricity & Work-Energy Theorem',
    durationMin: 20,
    sections: [
      {
        id: 'phy',
        name: 'Physics',
        questions: [
          { type: 'MCQ', text: 'The dimensional formula of Planck’s constant h is', options: [{ id: 'a', text: '[ML^{2}T^{-2}]' }, { id: 'b', text: '[ML^{2}T^{-1}]' }, { id: 'c', text: '[MLT^{-1}]' }, { id: 'd', text: '[ML^{-1}T]' }], answer: 'b', difficulty: 0.15, explanation: 'E = hν, so h = [ML^{2}T^{-1}].' },
          { type: 'MCQ', text: 'Two resistors of 6 Ω and 3 Ω are connected in parallel. The equivalent resistance is', options: [{ id: 'a', text: '9 Ω' }, { id: 'b', text: '4.5 Ω' }, { id: 'c', text: '2 Ω' }, { id: 'd', text: '0.5 Ω' }], answer: 'c', difficulty: 0.1, explanation: 'R = (6 x 3)/(6 + 3) = 2 Ω.' },
          { type: 'NUMERICAL', text: 'A block of 10 kg is lifted vertically through 5 m at constant speed. Taking g = 10 m/s^{2}, the work done against gravity, in joules, is', answer: 500, tolerance: 0.01, difficulty: 0.15, explanation: 'W = m g h = 500 J.' }
        ]
      }
    ]
  },
  {
    topic: 'Chemistry: Ionic Equilibria & Mole Concept',
    durationMin: 20,
    sections: [
      {
        id: 'chem',
        name: 'Chemistry',
        questions: [
          { type: 'MCQ', text: 'The pH of a 0.001 M HCl solution at 25 °C is', options: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }, { id: 'c', text: '3' }, { id: 'd', text: '11' }], answer: 'c', difficulty: 0.05, explanation: 'HCl is a strong acid: [H^{+}] = 10^{-3} M, so pH = 3.' },
          { type: 'MCQ', text: 'The number of moles in 36 g of water (molar mass 18 g/mol) is', options: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }, { id: 'c', text: '3' }, { id: 'd', text: '4' }], answer: 'b', difficulty: 0.05, explanation: 'n = 36 / 18 = 2 mol.' },
          { type: 'NUMERICAL', text: 'The number of electrons in a Fe^{3+} ion (atomic number of Fe = 26) is', answer: 23, tolerance: 0.01, difficulty: 0.2, explanation: '26 - 3 = 23 electrons.' }
        ]
      }
    ]
  },
  {
    topic: 'Mathematics: Matrices & Permutations',
    durationMin: 20,
    sections: [
      {
        id: 'math',
        name: 'Mathematics',
        questions: [
          { type: 'MCQ', text: 'The value of the integral of 2x dx from 0 to 1 is', options: [{ id: 'a', text: '0' }, { id: 'b', text: '1' }, { id: 'c', text: '2' }, { id: 'd', text: '1/2' }], answer: 'b', difficulty: 0.1, explanation: '[x^{2}] from 0 to 1 = 1.' },
          { type: 'MCQ', text: 'If A = [[1, 2], [3, 4]], then the determinant of A is', options: [{ id: 'a', text: '-2' }, { id: 'b', text: '2' }, { id: 'c', text: '10' }, { id: 'd', text: '-10' }], answer: 'a', difficulty: 0.1, explanation: 'det A = (1)(4) - (2)(3) = -2.' },
          { type: 'NUMERICAL', text: 'The number of distinct arrangements of the letters of the word LEVEL is', answer: 30, tolerance: 0.01, difficulty: 0.25, explanation: '5! / (2! x 2!) = 30.' }
        ]
      }
    ]
  },
  {
    topic: 'PCM Comprehensive Mock Sprint',
    durationMin: 35,
    sections: [
      {
        id: 'phy',
        name: 'Physics',
        questions: [
          { type: 'MCQ', text: 'A body of mass 2 kg moves with a speed of 3 m/s. Its kinetic energy is', options: [{ id: 'a', text: '3 J' }, { id: 'b', text: '6 J' }, { id: 'c', text: '9 J' }, { id: 'd', text: '18 J' }], answer: 'c', difficulty: 0.05, explanation: 'KE = 9 J.' },
          { type: 'NUMERICAL', text: 'A car starts from rest and accelerates uniformly at 2 m/s^{2} for 5 s. The distance covered, in metres, is', answer: 25, tolerance: 0.01, difficulty: 0.1, explanation: 's = 25 m.' }
        ]
      },
      {
        id: 'chem',
        name: 'Chemistry',
        questions: [
          { type: 'MCQ', text: 'The pH of a 0.001 M HCl solution at 25 °C is', options: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }, { id: 'c', text: '3' }, { id: 'd', text: '11' }], answer: 'c', difficulty: 0.05, explanation: 'pH = 3.' },
          { type: 'NUMERICAL', text: 'The number of sigma (σ) bonds in a molecule of ethane (C_{2}H_{6}) is', answer: 7, tolerance: 0.01, difficulty: 0.15, explanation: '7 sigma bonds.' }
        ]
      },
      {
        id: 'math',
        name: 'Mathematics',
        questions: [
          { type: 'MCQ', text: 'The sum of the roots of x^{2} - 5x + 6 = 0 is', options: [{ id: 'a', text: '5' }, { id: 'b', text: '6' }, { id: 'c', text: '-5' }, { id: 'd', text: '-6' }], answer: 'a', difficulty: 0.05, explanation: 'Sum of roots = 5.' },
          { type: 'NUMERICAL', text: 'The sum of the first 20 natural numbers is', answer: 210, tolerance: 0.01, difficulty: 0.1, explanation: 'Sum = 210.' }
        ]
      }
    ]
  }
];

function ensureDailyExams() {
  db.data.exams ||= [];
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthPrefix = `ex_daily_${year}_${String(month + 1).padStart(2, '0')}_`;

  const existingDaily = db.data.exams.filter((e) => e.id?.startsWith(monthPrefix));
  if (existingDaily.length >= daysInMonth) return;

  const monthName = now.toLocaleString('en-US', { month: 'short' });
  const newExams = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const examId = `${monthPrefix}${String(d).padStart(2, '0')}`;
    if (db.data.exams.some((e) => e.id === examId)) continue;

    const template = DAILY_SCHEDULE[(d - 1) % DAILY_SCHEDULE.length];
    const dayStart = new Date(year, month, d, 0, 0, 0, 0).getTime();
    const dayEnd = new Date(year, month, d, 23, 59, 59, 999).getTime();

    const sections = template.sections.map((s) => ({
      id: s.id,
      name: s.name,
      questions: s.questions.map((q, qi) => ({
        ...q,
        id: `q_d${d}_${s.id}_${qi + 1}`
      }))
    }));

    newExams.push({
      id: examId,
      code: `DAY-${String(d).padStart(2, '0')}`,
      title: `Daily Paper ${String(d).padStart(2, '0')} — ${template.topic}`,
      description: `Daily practice test for ${d} ${monthName} ${year}. Topic: ${template.topic}.`,
      durationMin: template.durationMin,
      window: { start: dayStart, end: dayEnd },
      scheme: { MCQ: { correct: 4, wrong: -1 }, NUMERICAL: { correct: 4, wrong: 0 } },
      instructions: DEFAULT_INSTRUCTIONS,
      shuffleQuestions: true,
      maxViolations: 0,
      resultsPublished: true,
      challengeOpen: false,
      createdAt: dayStart,
      sections
    });
  }

  if (newExams.length) {
    db.data.exams.push(...newExams);
    save();
  }
}

// Get all exams with the latest attempt status
candidateRouter.get('/exams', (req, res) => {
  ensureDailyExams(); // <-- Generates distinct daily papers for the month if not already generated

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

  recordActivity(req.user.id, localDateStr(), 'exam_started');

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
      currentQuestionId: a.currentQuestionId || null,
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
    responses: a.responses,
    bookmarkedQuestionIds: (db.data.bookmarks || [])
      .filter((b) => b.userId === req.user.id && b.examId === a.examId)
      .map((b) => b.questionId)
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
    recordActivity(req.user.id, localDateStr(), 'exam_answered');
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
  a.currentQuestionId = q.id;

  save();

  res.json({
    ok: true,
    remainingMs: remainingMs(a),
    serverNow: Date.now()
  });
});

// Heartbeat (Syncs clock and checks if attempt has expired)
candidateRouter.post('/attempts/:id/heartbeat', (req, res) => {
  const a = ownAttempt(req);

  a.lastSeenAt = Date.now();
  if (req.body && typeof req.body.currentQuestionId === 'string') {
    a.currentQuestionId = req.body.currentQuestionId;
  }

  const remaining = remainingMs(a);
  const status = remaining <= 0 ? 'submitted' : a.status;

  res.json({
    status,
    remainingMs: remaining,
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
// SUBMIT EXAM (Authoritative & Idempotent)
// ----------------------------------------------------------------

candidateRouter.post('/attempts/:id/submit', async (req, res) => {
  const a = ownAttempt(req);

  // If already submitted (e.g. from background sweeper, double-click, or network retry), return safely
  if (a.status === 'submitted') {
    return res.json({
      status: 'submitted',
      attemptId: a.id,
      alreadySubmitted: true
    });
  }

  // Server decides reason based on its authoritative clock
  const reason = Date.now() >= a.endsAt ? 'timeout' : 'manual';
  finalizeAttempt(a, reason);

  recordActivity(req.user.id, localDateStr(), 'exam_submitted');
  await flush();

  res.json({
    status: 'submitted',
    attemptId: a.id,
    submitReason: reason
  });
});

// ----------------------------------------------------------------
// RESULT
// ----------------------------------------------------------------

candidateRouter.get('/attempts/:id/result', async (req, res) => {
  await refreshDatabase();
  const a = ownAttempt(req);

  if (a.status !== 'submitted') {
    throw new HttpError(
      409,
      'not_submitted',
      'Submit the exam to see your result.'
    );
  }

  recordActivity(req.user.id, localDateStr(), 'result_viewed');

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
