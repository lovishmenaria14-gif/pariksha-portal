
import { h, mount, modal, toast, spinner, fmtDateTime } from '../dom.js';
import { get, post } from '../api.js';
import { appHeader, refreshNotificationBadge, showError } from './shell.js';

const CATEGORIES = [
  'Account & Login',
  'Examination',
  'Results & Score',
  'Technical Issue',
  'Other',
];

const FAQS = [
  {
    question: 'I cannot sign in. What should I check?',
    answer: 'Check that you are using the application number and password issued for your candidate account, and make sure there are no extra spaces. If you still cannot sign in, submit a support request under Account & Login.',
  },
  {
    question: 'What should I do before starting an exam?',
    answer: 'Open the exam instructions and review the duration, question navigation, and marking rules before you begin. Start only when you have enough uninterrupted time and a reliable internet connection.',
  },
  {
    question: 'What happens when the exam timer ends?',
    answer: 'The exam is time-limited. Review your answers and submit before the countdown reaches zero; do not rely on being able to continue after time expires.',
  },
  {
    question: 'The page is not responding or I lost my connection. What should I do?',
    answer: 'Check your internet connection and wait briefly for the page to respond. Avoid opening multiple exam tabs or repeatedly refreshing while an exam is in progress. If the problem continues, report it with the exam name, approximate time, and any error message.',
  },
  {
    question: 'I think my result or score is incorrect. How can I report it?',
    answer: 'Submit a request under Results & Score and include the exam name and the part of the result you want reviewed. Do not include your password.',
  },
];

const statusLabel = (status) => ({
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
}[status] || status);

const statusClass = (status) => ({
  open: 'chip-warn',
  in_progress: 'chip-lilac',
  resolved: 'chip-ok',
  closed: '',
}[status] || '');

async function ticketDetails(ticketId) {
  try {
    const { ticket } = await get(`/support-tickets/${ticketId}`);

    const conversation = h('div', { class: 'support-conversation' });

    conversation.replaceChildren(
      h('article', { class: 'support-message support-message-candidate' },
        h('div', { class: 'row' },
          h('strong', null, 'Your request'),
          h('span', { class: 'muted small' }, fmtDateTime(ticket.createdAt))
        ),
        h('p', null, ticket.description)
      ),
      ...(ticket.replies || []).map((reply) =>
        h('article', {
          class: `support-message ${reply.authorRole === 'admin' ? 'support-message-admin' : ''}`,
        },
          h('div', { class: 'row' },
            h('strong', null, reply.authorName || 'Support team'),
            h('span', { class: 'muted small' }, fmtDateTime(reply.createdAt))
          ),
          h('p', null, reply.message)
        )
      )
    );

    const m = modal({
      title: ticket.subject,
      wide: true,
      body: h('div', { class: 'stack' },
        h('div', { class: 'row' },
          h('span', { class: `chip ${statusClass(ticket.status)}` }, statusLabel(ticket.status)),
          h('span', { class: 'muted small' }, ticket.category)
        ),
        h('h3', null, 'Conversation'),
        conversation
      ),
      actions: [
        h('button', {
          class: 'btn btn-primary',
          type: 'button',
          onclick: () => m.close(),
        }, 'Close'),
      ],
    });

    try {
      await post(`/support-tickets/${ticketId}/read`);
      await refreshNotificationBadge();
    } catch (error) {
      showError(error);
    }
  } catch (error) {
    showError(error);
  }
}

export async function supportView({ root, user, params = [] }) {
  document.title = 'Help & Support | Pariksha';

  const subject = h('input', {
    id: 'support-subject',
    class: 'input',
    type: 'text',
    minlength: 5,
    maxlength: 120,
    required: true,
    placeholder: 'Briefly describe your issue',
  });

  const category = h('select', { id: 'support-category', class: 'input' },
    ...CATEGORIES.map((item) => h('option', { value: item }, item))
  );

  const description = h('textarea', {
    id: 'support-description',
    class: 'textarea',
    rows: 5,
    maxlength: 3000,
    minlength: 10,
    required: true,
    placeholder: 'Explain your issue in detail...',
  });

  const submitButton = h('button', {
    class: 'btn btn-primary',
    type: 'submit',
  }, 'Submit request');

  const ticketList = h('div', { class: 'stack' });
  const errorMessage = h('p', {
    class: 'form-error',
    role: 'alert',
    hidden: true,
  });

  async function loadTickets() {
    ticketList.replaceChildren(spinner('Loading your requests'));

    try {
      const { tickets = [] } = await get('/support-tickets');

      if (!tickets.length) {
        ticketList.replaceChildren(
          h('div', { class: 'empty' },
            h('strong', null, 'No support requests yet'),
            h('p', null, 'Your submitted requests will appear here.')
          )
        );
        return;
      }

      ticketList.replaceChildren(
        ...tickets.map((ticket) =>
          h('article', { class: 'panel support-ticket-row' },
            h('div', { class: 'support-ticket-main' },
              h('div', { class: 'row' },
                h('strong', null, ticket.subject),
                h('span', { class: `chip ${statusClass(ticket.status)}` }, statusLabel(ticket.status)),
                ticket.candidateUnread
                  ? h('span', { class: 'chip chip-warn' }, 'New update')
                  : null
              ),
              h('p', { class: 'muted small' },
                `${ticket.category} · Updated ${fmtDateTime(ticket.updatedAt)}`
              )
            ),
            h('button', {
              class: 'btn btn-secondary btn-sm',
              type: 'button',
              onclick: async () => {
                await ticketDetails(ticket.id);
                await loadTickets();
              },
            }, 'View conversation')
          )
        )
      );
    } catch (error) {
      ticketList.replaceChildren(
        h('div', { class: 'empty' }, 'Unable to load your support requests.')
      );
      showError(error);
    }
  }

  const form = h('form', {
    class: 'panel support-form stack',
    onsubmit: async (event) => {
      event.preventDefault();
      errorMessage.hidden = true;

      const subjectValue = subject.value.trim();
      const descriptionValue = description.value.trim();

      if (subjectValue.length < 5 || subjectValue.length > 120) {
        errorMessage.textContent = 'Subject must contain between 5 and 120 characters.';
        errorMessage.hidden = false;
        return;
      }

      if (descriptionValue.length < 10 || descriptionValue.length > 3000) {
        errorMessage.textContent = 'Description must contain between 10 and 3000 characters.';
        errorMessage.hidden = false;
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = 'Submitting...';

      try {
        await post('/support-tickets', {
          subject: subjectValue,
          category: category.value,
          description: descriptionValue,
        });

        subject.value = '';
        category.value = CATEGORIES[0];
        description.value = '';

        toast('Your support request has been submitted.', 'ok');
        await loadTickets();
      } catch (error) {
        showError(error);
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Submit request';
      }
    },
  },
    h('h2', null, 'Submit a support request'),
    h('div', { class: 'field' },
      h('label', { for: 'support-subject' }, 'Subject'),
      subject
    ),
    h('div', { class: 'field' },
      h('label', { for: 'support-category' }, 'Category'),
      category
    ),
    h('div', { class: 'field' },
      h('label', { for: 'support-description' }, 'Description'),
      description
    ),
    h('p', { class: 'muted small support-form-note' }, 'Include the exam name and approximate time for exam-related issues. Never include your password.'),
    errorMessage,
    h('div', { class: 'row-actions' }, submitButton)
  );

  const page = h('main', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h1', null, 'Help & Support'),
      h('p', { class: 'muted' },
        `Hello ${user.name}, submit an issue or check the progress of your existing requests.`
      )
    ),
    h('section', { class: 'panel support-faq', 'aria-labelledby': 'support-faq-heading' },
      h('div', null,
        h('h2', { id: 'support-faq-heading' }, 'Frequently asked questions'),
        h('p', { class: 'muted small' }, 'Quick answers for sign-in, exam rules, results, and common technical problems.')
      ),
      h('div', { class: 'support-faq-list' },
        ...FAQS.map(({ question, answer }) =>
          h('details', { class: 'support-faq-item' },
            h('summary', null, question),
            h('p', null, answer)
          )
        )
      )
    ),
    form,
    h('section', { class: 'stack' },
      h('div', { class: 'row' },
        h('h2', null, 'Your support requests'),
        h('button', {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onclick: () => loadTickets(),
        }, 'Refresh')
      ),
      ticketList
    )
  );

  mount(root, appHeader(user), page);
  await loadTickets();
  if (params[0]) {
    await ticketDetails(params[0]);
    await loadTickets();
  }
}
