import { db, save, flush, id } from './db.js';
import { hashPassword } from './auth.js';
import { DEFAULT_INSTRUCTIONS, evaluateAttempt, allQuestions, buildOrder, invalidateStats } from './engine.js';
import { mulberry32 } from './util.js';

const opts = (...t) => t.map((text, i) => ({ id: 'abcdef'[i], text }));

// Formatting in question text: ^{x} is a superscript and _{x} is a subscript.
const BANK = {
  p1: { type: 'MCQ', text: 'A body of mass 2 kg moves with a speed of 3 m/s. Its kinetic energy is', options: opts('3 J', '6 J', '9 J', '18 J'), answer: 'c', difficulty: 0.05, explanation: 'KE = (1/2) m v^{2} = 0.5 x 2 x 3^{2} = 9 J.' },
  p2: { type: 'MCQ', text: 'The dimensional formula of Planck’s constant h is', options: opts('[ML^{2}T^{-2}]', '[ML^{2}T^{-1}]', '[MLT^{-1}]', '[ML^{-1}T]'), answer: 'b', difficulty: 0.15, explanation: 'E = hν, so h = E/ν = [ML^{2}T^{-2}]/[T^{-1}] = [ML^{2}T^{-1}].' },
  p3: { type: 'MCQ', text: 'A ball is dropped from a height of 20 m. Taking g = 10 m/s^{2}, the time it takes to reach the ground is', options: opts('1 s', '2 s', '3 s', '4 s'), answer: 'b', difficulty: 0.05, explanation: 't = √(2h/g) = √(2 x 20 / 10) = 2 s.' },
  p4: { type: 'MCQ', text: 'Two resistors of 6 Ω and 3 Ω are connected in parallel. The equivalent resistance is', options: opts('9 Ω', '4.5 Ω', '2 Ω', '0.5 Ω'), answer: 'c', difficulty: 0.1, explanation: 'R = (6 x 3)/(6 + 3) = 2 Ω.' },
  p5: { type: 'NUMERICAL', text: 'A car starts from rest and accelerates uniformly at 2 m/s^{2} for 5 s. The distance covered, in metres, is', answer: 25, tolerance: 0.01, difficulty: 0.1, explanation: 's = (1/2) a t^{2} = 0.5 x 2 x 25 = 25 m.' },
  p6: { type: 'NUMERICAL', text: 'A block of 10 kg is lifted vertically through 5 m at constant speed. Taking g = 10 m/s^{2}, the work done against gravity, in joules, is', answer: 500, tolerance: 0.01, difficulty: 0.15, explanation: 'W = m g h = 10 x 10 x 5 = 500 J.' },

  c1: { type: 'MCQ', text: 'The hybridisation of carbon in ethene (C_{2}H_{4}) is', options: opts('sp', 'sp^{2}', 'sp^{3}', 'sp^{3}d'), answer: 'b', difficulty: 0.1, explanation: 'Each carbon forms three sigma bonds and one pi bond, so it is sp^{2} hybridised.' },
  c2: { type: 'MCQ', text: 'The pH of a 0.001 M HCl solution at 25 °C is', options: opts('1', '2', '3', '11'), answer: 'c', difficulty: 0.05, explanation: 'HCl is a strong acid: [H^{+}] = 10^{-3} M, so pH = 3.' },
  c3: { type: 'MCQ', text: 'Which of these elements has the highest electronegativity?', options: opts('Oxygen', 'Nitrogen', 'Fluorine', 'Chlorine'), answer: 'c', difficulty: 0.05, explanation: 'Fluorine is the most electronegative element on the Pauling scale (3.98).' },
  c4: { type: 'MCQ', text: 'The number of moles in 36 g of water (molar mass 18 g/mol) is', options: opts('1', '2', '3', '4'), answer: 'b', difficulty: 0.05, explanation: 'n = 36 / 18 = 2 mol.' },
  c5: { type: 'NUMERICAL', text: 'The number of sigma (σ) bonds in a molecule of ethane (C_{2}H_{6}) is', answer: 7, tolerance: 0.01, difficulty: 0.15, explanation: 'Six C-H bonds and one C-C bond: 7 sigma bonds.' },
  c6: { type: 'NUMERICAL', text: 'The number of electrons in a Fe^{3+} ion (atomic number of Fe = 26) is', answer: 23, tolerance: 0.01, difficulty: 0.2, explanation: 'Neutral Fe has 26 electrons; losing three gives 23.' },

  m1: { type: 'MCQ', text: 'The derivative of sin x · cos x with respect to x is', options: opts('sin 2x', 'cos 2x', '2 cos 2x', '-cos 2x'), answer: 'b', difficulty: 0.15, explanation: 'sin x cos x = (1/2) sin 2x, so the derivative is cos 2x.' },
  m2: { type: 'MCQ', text: 'The sum of the roots of x^{2} - 5x + 6 = 0 is', options: opts('5', '6', '-5', '-6'), answer: 'a', difficulty: 0.05, explanation: 'Sum of roots = -b/a = 5.' },
  m3: { type: 'MCQ', text: 'The value of the integral of 2x dx from 0 to 1 is', options: opts('0', '1', '2', '1/2'), answer: 'b', difficulty: 0.1, explanation: '[x^{2}] from 0 to 1 = 1.' },
  m4: { type: 'MCQ', text: 'If A = [[1, 2], [3, 4]], then the determinant of A is', options: opts('-2', '2', '10', '-10'), answer: 'a', difficulty: 0.1, explanation: 'det A = (1)(4) - (2)(3) = -2.' },
  m5: { type: 'NUMERICAL', text: 'The number of distinct arrangements of the letters of the word LEVEL is', answer: 30, tolerance: 0.01, difficulty: 0.25, explanation: '5! / (2! x 2!) = 120 / 4 = 30.' },
  m6: { type: 'NUMERICAL', text: 'The sum of the first 20 natural numbers is', answer: 210, tolerance: 0.01, difficulty: 0.1, explanation: 'n(n+1)/2 = 20 x 21 / 2 = 210.' },
};

const q = (key) => ({ ...BANK[key], id: `q_${key}` });

function buildExam(now, { code, title, description, durationMin, picks, shuffleQuestions, challengeOpen }) {
  return {
    id: `ex_${code.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    code,
    title,
    description,
    durationMin,
    window: { start: now - 864e5, end: now + 365 * 864e5 },
    // MCQ +4 / -1, numerical +4 / 0. All of this is configurable per exam.
    scheme: { MCQ: { correct: 4, wrong: -1 }, NUMERICAL: { correct: 4, wrong: 0 } },
    instructions: DEFAULT_INSTRUCTIONS,
    shuffleQuestions,
    maxViolations: 0,
    resultsPublished: true,
    challengeOpen,
    createdAt: now - 2 * 864e5,
    sections: [
      { id: 'phy', name: 'Physics', questions: picks.phy.map(q) },
      { id: 'chem', name: 'Chemistry', questions: picks.chem.map(q) },
      { id: 'math', name: 'Mathematics', questions: picks.math.map(q) },
    ],
  };
}

const FIRST = ['Aarav', 'Vihaan', 'Ishaan', 'Kabir', 'Arjun', 'Reyansh', 'Advait', 'Dhruv', 'Ananya', 'Diya', 'Saanvi', 'Myra', 'Kiara', 'Navya', 'Riya', 'Meera', 'Tanvi', 'Ira', 'Rohan', 'Siddharth', 'Aditi', 'Pranav', 'Nikhil', 'Sneha'];
const LAST = ['Sharma', 'Patel', 'Iyer', 'Nair', 'Reddy', 'Gupta', 'Singh', 'Mehta', 'Joshi', 'Kulkarni', 'Das', 'Bose', 'Menon', 'Rao', 'Chopra', 'Verma', 'Shah', 'Pillai'];

async function syntheticCohort(exam, count) {
  const rnd = mulberry32(20261020);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const now = Date.now();
  const qs = allQuestions(exam);
  for (let i = 0; i < count; i++) {
    const user = {
      id: id('u_'),
      role: 'candidate',
      loginId: `2610${String(1000 + i + 1).padStart(8, '0')}`,
      name: `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`,
      rollNo: `PK26-${String(1000 + i + 1).padStart(6, '0')}`,
      centre: 'Pariksha Online Centre 0142',
      passwordHash: '!', // cannot sign in
      synthetic: true,
    };
    db.data.users.push(user);

    const ability = gauss();
    const startedAt = now - Math.floor(rnd() * 5 * 864e5) - 3600e3;
    const seed = Math.floor(rnd() * 2 ** 30) + 1;
    const responses = {};
    for (const { q: question } of qs) {
      const attempts = rnd() < Math.min(0.97, Math.max(0.4, 0.78 + 0.08 * ability));
      const resp = { a: null, m: rnd() < 0.08, v: true, t: Math.floor((20 + rnd() * 110) * 1000) };
      if (attempts) {
        const right = rnd() < Math.min(0.96, Math.max(0.08, 0.66 + 0.2 * ability - (question.difficulty || 0)));
        if (question.type === 'MCQ') {
          const wrongs = question.options.map((o) => o.id).filter((x) => x !== question.answer);
          resp.a = right ? question.answer : wrongs[Math.floor(rnd() * wrongs.length)];
        } else {
          resp.a = String(right ? question.answer : question.answer + 1 + Math.floor(rnd() * 9));
        }
      }
      responses[question.id] = resp;
    }
    const attempt = {
      id: id('at_'),
      examId: exam.id,
      userId: user.id,
      status: 'submitted',
      startedAt,
      endsAt: startedAt + exam.durationMin * 60000,
      extraMs: 0,
      seed,
      order: buildOrder(exam, seed),
      responses,
      violations: rnd() < 0.1 ? 1 + Math.floor(rnd() * 3) : 0,
      events: [],
      lastSeenAt: startedAt,
      submitReason: 'manual',
      submittedAt: startedAt + Math.floor((0.55 + rnd() * 0.42) * exam.durationMin * 60000),
    };
    attempt.score = evaluateAttempt(exam, attempt);
    db.data.attempts.push(attempt);
  }
  invalidateStats(exam.id);
}


export async function seedDemo() {
  // Prevent duplicate demo records
  if (db.data.users.some((u) => u.loginId === '261000000001') ||
      db.data.exams.some((e) => e.code === 'PMT-01')) {
    console.log('Demo data already exists. Skipping seed.');
    return;
  }

  const now = Date.now();

  const [adminHash, demoHash] = await Promise.all([
    hashPassword('Admin@123'),
    hashPassword('Demo@123'),
  ]);

  db.data.users.push(
    {
      id: id('u_'),
      role: 'admin',
      loginId: 'admin',
      name: 'Exam controller',
      passwordHash: adminHash,
      mustChangePassword: true,
    },
    {
      id: id('u_'),
      role: 'candidate',
      loginId: '261000000001',
      name: 'Ananya Rao',
      rollNo: 'PK26-000001',
      centre: 'Pariksha Online Centre 0142',
      passwordHash: demoHash,
    },
    {
      id: id('u_'),
      role: 'candidate',
      loginId: '261000000002',
      name: 'Rohan Iyer',
      rollNo: 'PK26-000002',
      centre: 'Pariksha Online Centre 0142',
      passwordHash: demoHash,
    },
  );

  const mock = buildExam(now, {
    code: 'PMT-01',
    title: 'Pariksha Mock 01, JEE Main pattern',
    description: 'Physics, Chemistry and Mathematics. Multiple choice and numerical questions with negative marking on multiple choice.',
    durationMin: 60,
    picks: {
      phy: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      chem: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      math: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'],
    },
    shuffleQuestions: true,
    challengeOpen: true,
  });

  const sprint = buildExam(now, {
    code: 'SPR-01',
    title: 'Ten-minute sprint',
    description: 'Six questions in ten minutes. A quick way to try the exam screen and the timer.',
    durationMin: 10,
    picks: {
      phy: ['p1', 'p3'],
      chem: ['c1', 'c3'],
      math: ['m2', 'm5'],
    },
    shuffleQuestions: false,
    challengeOpen: false,
  });

  db.data.exams.push(mock, sprint);

  await syntheticCohort(mock, 64);

  // Persist everything to MongoDB before returning
  await flush();

  console.log('Demo data saved successfully.');
}
