/* Small progressive enhancements for the admin. Everything works without JS too. */
(function () {
  // Mobile menu
  const btn = document.querySelector('.menu-btn');
  const side = document.getElementById('side');
  if (btn && side) {
    btn.addEventListener('click', () => {
      const open = side.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  }

  // Confirm destructive actions
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-confirm]');
    if (el && !window.confirm(el.dataset.confirm)) e.preventDefault();
  });

  // Copy media links
  document.querySelectorAll('[data-copy]').forEach((b) => {
    b.addEventListener('click', async () => {
      const url = new URL(b.dataset.copy, window.location.origin).href;
      try { await navigator.clipboard.writeText(url); b.textContent = 'Copied'; } catch (_) { window.prompt('Copy this link:', url); }
      setTimeout(() => { b.textContent = 'Copy link'; }, 1500);
    });
  });

  // Auto-submit role selects
  document.querySelectorAll('[data-autosubmit]').forEach((s) => s.addEventListener('change', () => s.form.submit()));

  // Cover image picker
  const cover = document.getElementById('coverImage');
  const prev = document.getElementById('cover-preview');
  document.querySelectorAll('[data-cover]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!cover) return;
      cover.value = b.dataset.cover;
      prev.innerHTML = b.dataset.cover ? `<img src="${b.dataset.cover}" alt="Selected cover">` : '<span class="muted small">No cover image</span>';
      document.querySelectorAll('.thumb').forEach((t) => t.classList.toggle('selected', t === b));
      cover.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // Show stored UTC times in the viewer's local time
  document.querySelectorAll('[data-localtime]').forEach((el) => {
    el.textContent = new Date(el.dataset.localtime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  });
}());
