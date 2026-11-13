import { h, mount, rich, spinner, toast } from '../dom.js';
import { get, post } from '../api.js';
import { appHeader } from './shell.js';

const LEVELS = ['easy', 'medium', 'hard'];
const TYPE_LABEL = { MCQ: 'Choose one', MSQ: 'Choose all that apply', NUMERICAL: 'Enter a number' };

function shuffled(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function answerText(question, answer) {
  if (question.type === 'NUMERICAL') return [].concat(answer).join(' or ');
  const ids = [].concat(answer);
  return ids.map((id) => {
    const option = question.options.find((item) => item.id === id);
    return option ? `${id.toUpperCase()}. ${option.text}` : id;
  }).join(' · ');
}

export async function practiceView({ root, user }) {
  document.title = 'Practice | Pariksha';
  mount(root, appHeader(user), h('main', { class: 'page practice-page' }, spinner('Loading your practice bank')));

  let bank;
  try {
    ({ subjects: bank } = await get('/practice/bank'));
  } catch (error) {
    mount(root, appHeader(user), h('main', { class: 'page practice-page' },
      h('div', { class: 'empty' }, h('strong', null, 'Practice questions did not load'), h('p', null, error.message))));
    return;
  }

  const subjectSelect = h('select', { class: 'select', 'aria-label': 'Choose a subject' },
    h('option', { value: '' }, 'All subjects'),
    bank.map((subject) => h('option', { value: subject.name }, `${subject.name} · ${subject.count}`)));
  const difficultySelect = h('select', { class: 'select', 'aria-label': 'Choose a difficulty' },
    h('option', { value: 'all' }, 'All levels'),
    LEVELS.map((level) => h('option', { value: level }, level[0].toUpperCase() + level.slice(1))));
  const questionCard = h('section', { class: 'practice-question-card', 'aria-live': 'polite' });
  const scoreCorrect = h('strong', null, '0');
  const scoreDone = h('strong', null, '0');
  const bankCount = h('strong', null, '0');
  let questions = [];
  let deck = [];
  let cursor = 0;
  let current = null;
  let currentAnswer = null;
  let generation = 0;
  let correctCount = 0;
  let answeredCount = 0;
  
  // Get bookmarked question IDs
  function getBookmarks() {
    return JSON.parse(
      localStorage.getItem('bookmarkedQuestions') || '[]'
    );
  }

  // Check whether a question is bookmarked
  function isBookmarked(questionId) {
    return getBookmarks().includes(String(questionId));
  }

  // Toggle bookmark status
  function toggleBookmark(questionId, button) {
    let bookmarks = getBookmarks();
    const id = String(questionId);

    if (bookmarks.includes(id)) {
      bookmarks = bookmarks.filter(item => item !== id);
    } else {
      bookmarks.push(id);
    }

    localStorage.setItem(
      'bookmarkedQuestions',
      JSON.stringify(bookmarks)
    );

    const active = bookmarks.includes(id);

    button.classList.toggle('active', active);
    button.setAttribute(
      'aria-pressed',
      String(active)
    );

    button.title = active
      ? 'Remove bookmark'
      : 'Bookmark this question';
  }
  function showEmpty(message) {
    questionCard.replaceChildren(
      h('div', { class: 'practice-empty' },
        h('span', { class: 'practice-empty-mark', 'aria-hidden': 'true' }, '↗'),
        h('h2', null, 'No questions match those filters'),
        h('p', { class: 'muted' }, message))
    );
  }

  function drawQuestion() {
    if (!questions.length) {
      showEmpty(bank.length
        ? 'Try another subject or difficulty. New questions appear here when an exam is added to the question bank.'
        : 'There are no practice questions yet. Ask your exam administrator to add questions.');
      return;
    }
    if (cursor >= deck.length) {
      deck = shuffled(questions);
      if (deck.length > 1 && deck[0].id === current?.id) [deck[0], deck[1]] = [deck[1], deck[0]];
      cursor = 0;
    }
    current = deck[cursor++];
    currentAnswer = current.type === 'MSQ' ? [] : null;
    const questionGeneration = generation;
    let checking = false;

    // Create bookmark button
    const bookmarkButton = h(
      'button',
      {
        class: `practice-bookmark-btn ${
          isBookmarked(current.id) ? 'active' : ''
        }`,
        type: 'button',
        title: isBookmarked(current.id)
          ? 'Remove bookmark'
          : 'Bookmark this question',
        'aria-label': 'Bookmark this question',
        'aria-pressed': String(isBookmarked(current.id))
      },
      h('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '23',
        height: '23',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true'
      },
        h('path', {
          d: 'M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4z'
        })
      )
    );

    bookmarkButton.addEventListener('click', () => {
      toggleBookmark(current.id, bookmarkButton);
    });
    const checkButton = h('button', { class: 'btn btn-primary', type: 'button', disabled: true });
    const nextButton = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Skip question');
    const feedback = h('div', { class: 'practice-feedback', hidden: true, role: 'status' });
    const inputControls = [];
    const hasAnswer = () => currentAnswer !== null && currentAnswer !== '' &&
      !(Array.isArray(currentAnswer) && currentAnswer.length === 0);

    if (current.type === 'NUMERICAL') {
      const input = h('input', {
        class: 'input practice-number',
        type: 'number',
        inputmode: 'decimal',
        step: 'any',
        placeholder: 'Type your answer',
        'aria-label': 'Your numerical answer',
        oninput: () => {
          currentAnswer = input.value;
          checkButton.disabled = !hasAnswer();
        },
      });
      inputControls.push(input);
      checkButton.textContent = 'Check answer';
    } else {
      current.options.forEach((option) => {
        const input = h('input', {
          type: current.type === 'MSQ' ? 'checkbox' : 'radio',
          name: 'practice-answer',
          value: option.id,
          onchange: () => {
            if (current.type === 'MSQ') {
              currentAnswer = input.checked
                ? [...currentAnswer, option.id]
                : currentAnswer.filter((id) => id !== option.id);
            } else {
              currentAnswer = option.id;
            }
            inputControls.forEach((control) => {
              const choiceInput = control.querySelector('input');
              control.classList.toggle('selected', choiceInput.checked);
            });
            checkButton.disabled = !hasAnswer();
          },
        });
        const choice = h('label', { class: 'practice-choice' },
          input,
          h('span', { class: 'practice-choice-letter', 'aria-hidden': 'true' }, option.id.toUpperCase()),
          h('span', null, rich(option.text)));
        inputControls.push(choice);
      });
      checkButton.textContent = 'Check answer';
    }

    function moveNext() {
      drawQuestion();
    }

    checkButton.addEventListener('click', async () => {
      if (!hasAnswer() || checking) return;
      checking = true;
      checkButton.disabled = true;
      nextButton.disabled = true;
      const question = current;
      const answer = currentAnswer;
      try {
        const result = await post(`/practice/questions/${question.id}/check`, { answer });
        if (questionGeneration !== generation) return;
        answeredCount++;
        if (result.status === 'correct') correctCount++;
        scoreCorrect.textContent = String(correctCount);
        scoreDone.textContent = String(answeredCount);
        feedback.hidden = false;
        feedback.className = `practice-feedback ${result.status === 'correct' ? 'is-correct' : 'is-incorrect'}`;
        feedback.replaceChildren(
          h('strong', null, result.status === 'correct'
            ? 'Correct — nice work!'
            : result.status === 'partial' ? 'Partially correct' : 'Not quite'),
          h('p', null, `Correct answer: ${answerText(question, result.correctAnswer)}`),
          result.explanation
            ? h('div', { class: 'practice-explanation' }, h('span', { class: 'eyebrow' }, 'EXPLANATION'), h('p', null, rich(result.explanation)))
            : h('p', { class: 'muted small' }, 'No explanation has been added for this question yet.')
        );
        inputControls.forEach((control) => {
          (control.matches('input') ? [control] : control.querySelectorAll('input')).forEach((input) => { input.disabled = true; });
        });
        nextButton.textContent = 'Next question';
        nextButton.disabled = false;
        checkButton.hidden = true;
      } catch (error) {
        if (questionGeneration !== generation) return;
        checking = false;
        checkButton.disabled = !hasAnswer();
        nextButton.disabled = false;
        toast(error.message, 'error');
      }
    });
    nextButton.addEventListener('click', moveNext);

    bankCount.textContent = String(questions.length);
    questionCard.replaceChildren(
      h('div', { class: 'practice-question-top' },
        h('span', { class: 'chip' }, current.subject),
        h('span', { class: `practice-difficulty ${current.difficulty}` }, current.difficulty),
        h('span', { class: 'muted small' }, TYPE_LABEL[current.type]),
        bookmarkButton
      ),
      h('h2', { class: 'practice-question-text' }, rich(current.text)),
      current.type === 'NUMERICAL'
        ? h('div', { class: 'practice-answer-area' }, inputControls)
        : h('fieldset', { class: 'practice-options' },
            h('legend', { class: 'sr-only' }, TYPE_LABEL[current.type]),
            inputControls),
      feedback,
      h('div', { class: 'practice-actions' }, nextButton, checkButton)
    );
  }

  async function loadQuestions() {
    const requestGeneration = ++generation;
    questionCard.replaceChildren(spinner('Finding questions'));
    const params = new URLSearchParams();
    if (subjectSelect.value) params.set('subject', subjectSelect.value);
    params.set('difficulty', difficultySelect.value);
    try {
      ({ questions } = await get(`/practice/questions?${params}`));
      if (requestGeneration !== generation) return;
      questions = shuffled(questions);
      deck = questions;
      cursor = 0;
      current = null;
      correctCount = 0;
      answeredCount = 0;
      scoreCorrect.textContent = '0';
      scoreDone.textContent = '0';
      drawQuestion();
    } catch (error) {
      if (requestGeneration !== generation) return;
      questionCard.replaceChildren(h('div', { class: 'empty' }, h('strong', null, 'Questions did not load'), h('p', null, error.message)));
    }
  }

  const filters = h('div', { class: 'practice-filters' },
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Subject'), subjectSelect),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Difficulty'), difficultySelect),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: loadQuestions }, 'Apply filters'));
  const content = h('main', { class: 'page practice-page', id: 'main' },
    h('section', { class: 'practice-hero' },
      h('div', null,
        h('span', { class: 'eyebrow' }, 'YOUR STUDY ROOM'),
        h('h1', null, 'Practice, at your pace.'),
        h('p', { class: 'muted' }, 'Pick a subject, choose your challenge level, and keep going for as long as you like.')),
      h('div', { class: 'practice-orbit', 'aria-hidden': 'true' }, h('span', null, '∞'))),
    h('section', { class: 'practice-workspace', 'aria-label': 'Question practice' },
      h('div', { class: 'practice-main-column' },
        filters,
        questionCard),
      h('aside', { class: 'practice-stats', 'aria-label': 'Practice session' },
        h('span', { class: 'eyebrow' }, 'THIS SESSION'),
        h('div', { class: 'practice-stat' }, h('span', null, 'Correct'), scoreCorrect),
        h('div', { class: 'practice-stat' }, h('span', null, 'Answered'), scoreDone),
        h('div', { class: 'practice-stat' }, h('span', null, 'Questions in this set'), bankCount),
        h('p', { class: 'muted small' }, 'Your practice is untimed. When you reach the end, questions shuffle and start again.'))));

  mount(root, appHeader(user), content);
  await loadQuestions();
}
