import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pariksha-'));
process.env.DATA_FILE = path.join(tmp, 'db.json');
process.env.SEED_DEMO = '1';

const { config } = await import('../src/config.js');
const { db, load } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { seedDemo } = await import('../src/seed.js');

config.graceMs = 200; // keep the expiry test quick

let server;
let base;

function client() {
  let cookie = '';
  return {
    async req(method, url, body, headers = {}) {
      const res = await fetch(base + url, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-requested-with': 'pariksha',
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const kv = c.split(';')[0];
        cookie = kv.endsWith('=') ? '' : kv;
      }
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: res.status, body: json, raw: text };
    },
  };
}

const login = async (c, applicationNo, password) => c.req('POST', '/api/auth/login', { applicationNo, password });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  load();
  await seedDemo();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('health, CSRF header and wrong password', async () => {
  const c = client();
  assert.equal((await c.req('GET', '/api/health')).status, 200);
  const noHeader = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ applicationNo: 'x', password: 'y' }),
  });
  assert.equal(noHeader.status, 403);
  const wrong = await login(c, '261000000001', 'nope');
  assert.equal(wrong.status, 401);
  assert.match(wrong.body.message, /incorrect/);
  assert.equal((await c.req('GET', '/api/exams')).status, 401);
});

let sheet; // shared across the candidate flow
const ana = client();

test('candidate signs in and sees the exams', async () => {
  const r = await login(ana, '261000000001', 'Demo@123');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'candidate');
  assert.ok(!('passwordHash' in r.body.user));
  const list = await ana.req('GET', '/api/exams');
  assert.equal(list.status, 200);
  assert.equal(list.body.exams.length, 2);
  assert.equal(list.body.exams[0].status, 'not_started');
});

test('practice bank filters questions and reveals answers only after checking', async () => {
  const bank = await ana.req('GET', '/api/practice/bank');
  assert.equal(bank.status, 200);
  assert.deepEqual(bank.body.subjects.map((subject) => subject.name), ['Chemistry', 'Mathematics', 'Physics']);
  const filtered = await ana.req('GET', '/api/practice/questions?subject=Physics&difficulty=easy');
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.questions.length > 0);
  assert.ok(filtered.body.questions.every((question) => question.subject === 'Physics' && question.difficulty === 'easy'));
  assert.ok(!/"answer"|explanation|tolerance/.test(filtered.raw), 'practice list leaked the answer key');
  assert.equal((await ana.req('GET', '/api/practice/questions?difficulty=impossible')).status, 400);

  const noAnswer = await ana.req('POST', '/api/practice/questions/q_p1/check', {});
  assert.equal(noAnswer.status, 400);
  const wrong = await ana.req('POST', '/api/practice/questions/q_p1/check', { answer: 'a' });
  assert.equal(wrong.status, 200);
  assert.equal(wrong.body.status, 'wrong');
  assert.equal(wrong.body.correctAnswer, 'c');
  assert.match(wrong.body.explanation, /9 J/i);
  const correct = await ana.req('POST', '/api/practice/questions/q_p1/check', { answer: 'c' });
  assert.equal(correct.body.status, 'correct');
});

test('paper never leaks the answer key, and scoring follows the scheme', async () => {
  const start = await ana.req('POST', '/api/exams/ex_spr01/start');
  assert.equal(start.status, 201);
  const id = start.body.attemptId;
  sheet = id;

  const att = await ana.req('GET', `/api/attempts/${id}`);
  assert.equal(att.status, 200);
  assert.equal(att.body.paper.sections.length, 3);
  assert.ok(!/"answer"|explanation|tolerance|"correctAnswer"/.test(att.raw), 'answer key leaked to candidate');
  assert.ok(att.body.attempt.remainingMs > 9 * 60000 && att.body.attempt.remainingMs <= 10 * 60000);

  const put = (qid, body) => ana.req('PUT', `/api/attempts/${id}/responses/${qid}`, body);
  assert.equal((await put('q_p1', { a: 'c', v: true, t: 4000 })).status, 200); // correct   +4
  assert.equal((await put('q_p3', { a: 'a', v: true })).status, 200); //          wrong     -1
  assert.equal((await put('q_c1', { a: 'b', m: true, v: true })).status, 200); // correct   +4 (marked, still counts)
  assert.equal((await put('q_m5', { a: '30', v: true })).status, 200); //         numerical +4
  assert.equal((await put('q_c3', { a: null, v: true })).status, 200); //         cleared   0
  assert.equal((await put('q_m2', { a: 'z' })).status, 400, 'invalid option must be rejected');
  assert.equal((await put('q_m5', { a: 'abc' })).status, 400, 'invalid number must be rejected');
  assert.equal((await put('q_nope', { a: 'a' })).status, 404);

  const resumed = await ana.req('GET', `/api/attempts/${id}`);
  assert.equal(resumed.body.responses.q_p1.a, 'c');
  assert.equal(resumed.body.responses.q_c1.m, true);
  assert.equal(resumed.body.responses.q_p1.t, 4000);

  const early = await ana.req('GET', `/api/attempts/${id}/result`);
  assert.equal(early.status, 409, 'result must not be available before submitting');
});

test('submit, result, percentile and reattempt', async () => {
  assert.equal((await ana.req('POST', `/api/attempts/${sheet}/submit`)).status, 200);
  const res = await ana.req('GET', `/api/attempts/${sheet}/result`);
  assert.equal(res.status, 200);
  assert.equal(res.body.published, true);
  assert.equal(res.body.score.total, 11); // 4 - 1 + 4 + 4
  assert.equal(res.body.score.max, 24);
  assert.equal(res.body.sections.find((s) => s.id === 'phy').marks, 3);
  assert.equal(res.body.sections.find((s) => s.id === 'chem').marks, 4);
  assert.equal(res.body.sections.find((s) => s.id === 'math').marks, 4);
  assert.ok(res.body.percentile > 0 && res.body.percentile <= 100);
  assert.equal(res.body.rank, 1);
  const key = res.body.questions.find((x) => x.id === 'q_p1');
  assert.equal(key.correctAnswer, 'c');
  assert.equal(key.status, 'correct');

  const again = await ana.req('POST', '/api/exams/ex_spr01/start');
  assert.equal(again.status, 201);
  assert.notEqual(again.body.attemptId, sheet);
  const late = await ana.req('PUT', `/api/attempts/${sheet}/responses/q_p1`, { a: 'a' });
  assert.equal(late.status, 409, 'cannot change answers after submitting');
});

test('another candidate cannot read this attempt', async () => {
  const rohan = client();
  await login(rohan, '261000000002', 'Demo@123');
  assert.equal((await rohan.req('GET', `/api/attempts/${sheet}`)).status, 404);
  assert.equal((await rohan.req('GET', `/api/attempts/${sheet}/result`)).status, 404);
  assert.equal((await rohan.req('GET', '/api/admin/overview')).status, 403);
});

test('signing in on a second device signs the first one out', async () => {
  const a = client();
  const b = client();
  assert.equal((await login(a, '261000000002', 'Demo@123')).status, 200);
  assert.equal((await a.req('GET', '/api/auth/me')).status, 200);
  assert.equal((await login(b, '261000000002', 'Demo@123')).status, 200);
  const old = await a.req('GET', '/api/auth/me');
  assert.equal(old.status, 401);
  assert.equal(old.body.error, 'session_replaced');
  assert.equal((await b.req('GET', '/api/auth/me')).status, 200);
});

test('repeated wrong passwords lock the account for a while', async () => {
  const c = client();
  for (let i = 0; i < 5; i++) assert.equal((await login(c, '261001000007', 'wrong')).status, 401);
  const locked = await login(c, '261001000007', 'wrong');
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error, 'too_many_attempts');
});

const admin = client();

test('admin signs in and sees the control room', async () => {
  const r = await login(admin, 'admin', 'Admin@123');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.mustChangePassword, true);
  const ov = await admin.req('GET', '/api/admin/overview');
  assert.equal(ov.status, 200);
  assert.equal(ov.body.exams, 2);
  const an = await admin.req('GET', '/api/admin/exams/ex_pmt01/analytics');
  assert.equal(an.status, 200);
  assert.equal(an.body.cohort.n, 64);
  assert.equal(an.body.histogram.bins.length, 12);
  assert.equal(an.body.questions.length, 18);
  const csv = await admin.req('GET', '/api/admin/exams/ex_pmt01/results.csv');
  assert.equal(csv.status, 200);
  assert.equal(csv.raw.split('\r\n').length, 65);
});

test('dropping a question re-scores submitted papers', async () => {
  const drop = await admin.req('POST', '/api/admin/exams/ex_spr01/questions/q_p3/key', { drop: true });
  assert.equal(drop.status, 200);
  const res = await ana.req('GET', `/api/attempts/${sheet}/result`);
  assert.equal(res.body.score.total, 16); // the -1 became +4
  assert.equal(res.body.questions.find((x) => x.id === 'q_p3').status, 'bonus');
});

test('answer-key challenge: raise, resolve, re-score', async () => {
  const start = await ana.req('POST', '/api/exams/ex_pmt01/start');
  const id = start.body.attemptId;
  await ana.req('PUT', `/api/attempts/${id}/responses/q_p1`, { a: 'a', v: true }); // wrong: -1
  await ana.req('POST', `/api/attempts/${id}/submit`);
  assert.equal((await ana.req('GET', `/api/attempts/${id}/result`)).body.score.total, -1);

  const bad = await ana.req('POST', `/api/attempts/${id}/challenges`, { questionId: 'q_p1', claim: 'a', reason: 'short' });
  assert.equal(bad.status, 400);
  const ok = await ana.req('POST', `/api/attempts/${id}/challenges`, {
    questionId: 'q_p1',
    claim: 'a',
    reason: 'Option A is also 9 J if the mass is read as 2 kg.',
  });
  assert.equal(ok.status, 201);
  const dup = await ana.req('POST', `/api/attempts/${id}/challenges`, { questionId: 'q_p1', claim: 'a', reason: 'Trying the same thing again.' });
  assert.equal(dup.status, 409);

  const list = await admin.req('GET', '/api/admin/challenges');
  const pending = list.body.challenges.find((c) => c.id === ok.body.challenge.id);
  assert.equal(pending.status, 'pending');
  const resolved = await admin.req('POST', `/api/admin/challenges/${pending.id}/resolve`, { decision: 'accept', answer: ['a', 'c'] });
  assert.equal(resolved.status, 200);

  const after = await ana.req('GET', `/api/attempts/${id}/result`);
  assert.equal(after.body.score.total, 4); // both A and C are now accepted
  assert.equal(after.body.questions.find((x) => x.id === 'q_p1').challenge.status, 'accepted');
  assert.equal((await admin.req('POST', `/api/admin/challenges/${pending.id}/resolve`, { decision: 'reject' })).status, 409);
});

test('time runs out on the server, not the browser', async () => {
  const imp = await admin.req('POST', '/api/admin/exams', {
    title: 'Expiry test paper',
    durationMin: 0.02, // 1.2 seconds
    sections: [{ name: 'Only', questions: [{ type: 'MCQ', text: 'Pick b', options: ['x', 'y'], answer: 'b' }] }],
  });
  assert.equal(imp.status, 201);
  const examId = imp.body.exam.id;
  const made = await admin.req('POST', '/api/admin/candidates/bulk', { count: 1, names: ['Timer Tester'] });
  const { applicationNo, password } = made.body.created[0];

  const cand = client();
  assert.equal((await login(cand, applicationNo, password)).status, 200);
  const { body: s } = await cand.req('POST', `/api/exams/${examId}/start`);
  const exam = db.data.exams.find((e) => e.id === examId);
  const qid = exam.sections[0].questions[0].id;
  assert.equal((await cand.req('PUT', `/api/attempts/${s.attemptId}/responses/${qid}`, { a: 'b' })).status, 200);

  await sleep(1700); // past the deadline and the grace period
  const late = await cand.req('PUT', `/api/attempts/${s.attemptId}/responses/${qid}`, { a: 'a' });
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'time_over');
  const done = await cand.req('GET', `/api/attempts/${s.attemptId}`);
  assert.equal(done.body.attempt.status, 'submitted');
  const stored = db.data.attempts.find((a) => a.id === s.attemptId);
  assert.equal(stored.submitReason, 'timeout');
  assert.equal(stored.score.total, 4, 'the answer saved before the deadline is the one that counts');
});

test('exam import reports problems clearly', async () => {
  const r = await admin.req('POST', '/api/admin/exams', {
    title: 'Bad',
    durationMin: 10,
    sections: [{ name: 'S', questions: [{ type: 'MCQ', text: 'Q', options: ['only one'], answer: 'a' }] }],
  });
  assert.equal(r.status, 422);
  assert.ok(r.body.details.some((d) => /options/.test(d)));
  const difficulty = await admin.req('POST', '/api/admin/exams', {
    title: 'Difficulty test paper',
    durationMin: 10,
    sections: [{ name: 'S', questions: [{ type: 'MCQ', text: 'Question', options: ['A', 'B'], answer: 'a', difficulty: 'impossible' }] }],
  });
  assert.equal(difficulty.status, 422);
  assert.ok(difficulty.body.details.some((d) => /difficulty must be easy, medium or hard/.test(d)));
});
