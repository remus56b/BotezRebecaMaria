(() => {
  const root = document.documentElement;
  const form = document.querySelector('#rsvp-form');
  const status = document.querySelector('#form-status');

  const eventDate = new Date('2026-09-13T15:00:00+03:00').getTime();
  const countdownNodes = {
    days: document.querySelector('[data-countdown-days]'),
    hours: document.querySelector('[data-countdown-hours]'),
    minutes: document.querySelector('[data-countdown-minutes]'),
  };

  const updateCountdown = () => {
    const difference = eventDate - Date.now();
    if (difference <= 0) return;
    const days = Math.floor(difference / 86400000);
    const hours = Math.floor((difference / 3600000) % 24);
    const minutes = Math.floor((difference / 60000) % 60);
    if (countdownNodes.days) countdownNodes.days.textContent = String(days).padStart(2, '0');
    if (countdownNodes.hours) countdownNodes.hours.textContent = String(hours).padStart(2, '0');
    if (countdownNodes.minutes) countdownNodes.minutes.textContent = String(minutes).padStart(2, '0');
  };
  updateCountdown();
  window.setInterval(updateCountdown, 60000);

  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries, instance) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          instance.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      status.textContent = '';
      status.className = 'form-status';
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.classList.add('is-loading');

      try {
        const formData = new URLSearchParams(new FormData(form));
        const response = await fetch(window.location.pathname, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: formData,
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.message || 'Nu am putut trimite răspunsul.');
        form.reset();
        status.textContent = payload.message;
        status.classList.add('is-success');
      } catch (error) {
        status.textContent = error.message;
        status.classList.add('is-error');
      } finally {
        submitButton.disabled = false;
        submitButton.classList.remove('is-loading');
      }
    });
  }

  const lightbox = document.querySelector('#lightbox');
  const lightboxImage = document.querySelector('#lightbox-image');
  const lightboxCaption = document.querySelector('#lightbox-caption');
  const closeLightbox = () => {
    if (lightbox?.open) lightbox.close();
    root.classList.remove('has-lightbox');
  };

  document.querySelectorAll('[data-lightbox]').forEach((button) => {
    button.addEventListener('click', () => {
      lightboxImage.src = button.dataset.lightbox;
      lightboxImage.alt = button.dataset.caption || '';
      lightboxCaption.textContent = button.dataset.caption || '';
      root.classList.add('has-lightbox');
      lightbox.showModal();
    });
  });
  document.querySelector('[data-lightbox-close]')?.addEventListener('click', closeLightbox);
  lightbox?.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  lightbox?.addEventListener('close', () => root.classList.remove('has-lightbox'));
})();
