import { h, mount, spinner, initials, toast } from '../dom.js';
import { get, put } from '../api.js';
import { store } from '../store.js';
import { appHeader, showError } from './shell.js';

export async function profileView({ root, user }) {
  document.title = 'My profile | Pariksha';
  mount(root, appHeader(user), h('main', { class: 'page' }, spinner('Loading your profile')));

  let profile;
  try {
    profile = (await get('/profile')).profile;
  } catch (error) {
    showError(error);
    return;
  }

  const errorBox = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const name = h('input', { class: 'input', id: 'profile-name', value: profile.name, maxlength: 80, autocomplete: 'name', required: true });
  const email = h('input', { class: 'input', id: 'profile-email', type: 'email', value: profile.email, maxlength: 254, autocomplete: 'email', required: true });
  const phone = h('input', { class: 'input', id: 'profile-phone', value: profile.phone, maxlength: 20, autocomplete: 'tel', inputmode: 'tel', placeholder: 'Optional' });
  const photo = h('input', { class: 'file-input', type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  const avatar = h('div', { class: 'profile-avatar-large' }, profile.photoURL ? h('img', { src: profile.photoURL, alt: profile.name }) : initials(profile.name));
  let photoURL = profile.photoURL;

  photo.addEventListener('change', () => {
    const file = photo.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast('Choose a JPEG, PNG or WebP image.', 'error');
      photo.value = '';
      return;
    }
    if (file.size > 650 * 1024) {
      toast('The photo must be smaller than 650 KB.', 'error');
      photo.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      photoURL = String(reader.result);
      avatar.replaceChildren(h('img', { src: photoURL, alt: name.value || profile.name }));
    };
    reader.readAsDataURL(file);
  });

  const saveButton = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save changes');
  const form = h('form', { class: 'profile-edit-form', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    if (name.value.trim().length < 2 || !email.value.trim()) {
      errorBox.textContent = 'Enter your name and a valid email address.';
      errorBox.hidden = false;
      return;
    }
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    try {
      const result = await put('/profile', { name: name.value, email: email.value, phone: phone.value, photoURL });
      Object.assign(store.user, { name: result.profile.name, email: result.profile.email, phone: result.profile.phone, photoURL: result.profile.photoURL });
      avatar.replaceChildren(result.profile.photoURL ? h('img', { src: result.profile.photoURL, alt: result.profile.name }) : initials(result.profile.name));
      toast('Profile updated successfully.', 'ok');
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Save changes';
    }
  }},
    errorBox,
    h('div', { class: 'profile-photo-field' }, avatar, h('div', null, h('label', { for: 'profile-photo' }, 'Profile photo'), h('p', { class: 'muted small' }, 'JPEG, PNG or WebP · Maximum 650 KB'), photo)),
    h('div', { class: 'profile-form-grid' },
      h('div', { class: 'field' }, h('label', { for: 'profile-name' }, 'Full name'), name),
      h('div', { class: 'field' }, h('label', { for: 'profile-email' }, 'Email address'), email),
      h('div', { class: 'field' }, h('label', { for: 'profile-phone' }, 'Phone number'), phone)),
    h('div', { class: 'profile-form-actions' }, saveButton));
  photo.id = 'profile-photo';

  mount(root, appHeader(store.user), h('main', { class: 'page profile-page', id: 'main' },
    h('div', { class: 'page-head profile-heading' },
      h('span', { class: 'eyebrow' }, 'MY ACCOUNT'),
      h('h1', null, 'Candidate profile'),
      h('p', { class: 'muted' }, 'View your official details and update your editable information.')),
    h('div', { class: 'profile-layout' },
      h('section', { class: 'profile-card profile-details' },
        h('h2', null, 'Official details'),
        h('p', { class: 'muted small' }, 'These details are managed by the examination centre.'),
        h('dl', { class: 'profile-detail-list' },
          h('div', null, h('dt', null, 'Application number'), h('dd', null, profile.applicationNo || 'Not assigned')),
          h('div', null, h('dt', null, 'Roll number'), h('dd', null, profile.rollNo || 'Not assigned')),
          h('div', null, h('dt', null, 'Examination centre'), h('dd', null, profile.centre || 'Not assigned')))),
      h('section', { class: 'profile-card profile-edit-card' }, h('h2', null, 'Editable information'), form))));
}
