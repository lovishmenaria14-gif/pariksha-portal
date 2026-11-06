
import { h, mount, modal, toast, spinner, fmtDateTime } from '../dom.js';
import { get, post } from '../api.js';
import { appHeader, showError } from './shell.js';

const CATEGORIES = [
  'Account & Login',
  'Examination',
  'Results & Score',
  'Technical Issue',
  'Other',
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
  } catch (error) {
    showError(error);
  }
}

export async function supportView({ root, user }) {
  document.title = 'Help & Support | Pariksha';

  const subject = h('input', {
    class: 'input',
    type: 'text',
    maxlength: 120,
    required: true,
    placeholder: 'Briefly describe your issue',
  });

  const category = h('select', { class: 'input' },
    ...CATEGORIES.map((item) => h('option', { value: item }, item))
  );

  const description = h('textarea', {
    class: 'textarea',
    rows: 5,
    maxlength: 3000,
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
                h('span', {
                  class: `chip ${statusClass(ticket.status)}`,
                }, statusLabel(ticket.status))
              ),
              h('p', { class: 'muted small' },
                `${ticket.category} · Updated ${fmtDateTime(ticket.updatedAt)}`
              )
            ),
            h('button', {
              class: 'btn btn-secondary btn-sm',
              type: 'button',
              onclick: () => ticketDetails(ticket.id),
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
      h('label', null, 'Subject'),
      subject
    ),
    h('div', { class: 'field' },
      h('label', null, 'Category'),
      category
    ),
    h('div', { class: 'field' },
      h('label', null, 'Description'),
      description
    ),
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
}
