/* Rich text editor (Quill) wiring: image uploads to the media library, live word count,
   search-preview updates and timezone-safe scheduling. */
(function () {
  const holder = document.getElementById('editor');
  const form = document.getElementById('post-form');
  if (!holder || !form || !window.Quill) return;

  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const hidden = document.getElementById('content');

  const quill = new window.Quill(holder, {
    theme: 'snow',
    placeholder: 'Start writing…',
    modules: {
      toolbar: {
        container: [
          [{ header: [2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          ['blockquote', 'code-block'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link', 'image'],
          ['clean'],
        ],
        handlers: { image: pickImage },
      },
    },
  });

  function pickImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const alt = window.prompt('Describe this image for screen readers (alt text):', '') || '';
      const body = new FormData();
      body.append('file', file);
      body.append('alt', alt);
      try {
        const res = await fetch(holder.dataset.uploadUrl, { method: 'POST', body, headers: { 'x-csrf-token': csrf, Accept: 'application/json' } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        const range = quill.getSelection(true);
        quill.insertEmbed(range.index, 'image', data.url, 'user');
        const img = quill.root.querySelector(`img[src="${data.url}"]:not([alt])`);
        if (img) img.setAttribute('alt', alt);
        quill.setSelection(range.index + 1);
        sync();
      } catch (err) {
        window.alert(err.message);
      }
    };
    input.click();
  }

  const counter = document.getElementById('wordcount');
  function sync() {
    const html = quill.root.innerHTML;
    hidden.value = html === '<p><br></p>' ? '' : html;
    const words = quill.getText().trim().split(/\s+/).filter(Boolean).length;
    counter.textContent = `${words} words · about ${Math.max(1, Math.round(words / 220))} min read`;
  }
  quill.on('text-change', sync);
  sync();

  // Keep alt text Quill strips on load: re-apply from the saved HTML.
  const tmp = document.createElement('div');
  tmp.innerHTML = hidden.value;
  tmp.querySelectorAll('img[alt]').forEach((src) => {
    const live = quill.root.querySelector(`img[src="${CSS.escape(src.getAttribute('src'))}"]`);
    if (live && !live.getAttribute('alt')) live.setAttribute('alt', src.getAttribute('alt'));
  });

  // Live search preview + character counts.
  const titleIn = form.querySelector('[name="title"]');
  const metaTitle = form.querySelector('[name="metaTitle"]');
  const metaDesc = form.querySelector('[name="metaDescription"]');
  const excerpt = form.querySelector('[name="excerpt"]');
  const serpTitle = document.querySelector('[data-serp-title]');
  const serpDesc = document.querySelector('[data-serp-desc]');
  function preview() {
    if (serpTitle) serpTitle.textContent = metaTitle.value || titleIn.value || 'Your post title';
    if (serpDesc) serpDesc.textContent = metaDesc.value || excerpt.value || 'Your meta description shows here.';
  }
  [titleIn, metaTitle, metaDesc, excerpt].forEach((el) => el && el.addEventListener('input', preview));
  form.querySelectorAll('[data-count]').forEach((el) => {
    const out = document.createElement('span');
    out.className = 'counter';
    el.insertAdjacentElement('afterend', out);
    const update = () => { out.textContent = `${el.value.length} characters`; };
    el.addEventListener('input', update);
    update();
  });

  // Scheduling: the browser's local time is converted to an exact UTC timestamp before submit.
  const local = document.getElementById('publishAtLocal');
  const iso = document.getElementById('publishAt');
  if (local && iso) {
    if (local.dataset.iso) {
      const d = new Date(local.dataset.iso);
      local.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    local.addEventListener('input', () => { iso.value = local.value ? new Date(local.value).toISOString() : ''; });
  }

  // Warn before leaving with unsaved changes.
  let dirty = false;
  quill.on('text-change', () => { dirty = true; });
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('submit', (e) => {
    const action = e.submitter && e.submitter.value;
    if (action === 'schedule' && !iso.value) {
      e.preventDefault();
      window.alert('Pick a date and time first.');
      local.focus();
      return;
    }
    sync();
    dirty = false;
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
}());
