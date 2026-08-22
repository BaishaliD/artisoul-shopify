/**
 * Styled in Your Space — shared lightbox.
 *
 * One <siys-lightbox> per block holds every slide; the grid tiles are plain
 * buttons that open it at a given index. Navigation wraps at both ends.
 *
 * Keyboard: ← / → step, Home / End jump, Esc closes. Focus is trapped in the
 * dialog while open and returned to the tile that opened it. On touch, a
 * horizontal swipe across the stage steps the same way.
 *
 * Slide images render with the grid tile's 800px URL (a cache hit, so no empty
 * box on open) and carry the 1600px version in data-src. Only the current slide
 * and its two neighbours are upgraded, so a long set doesn't pull every full-
 * size image up front.
 */
if (!customElements.get('siys-lightbox')) {
  customElements.define(
    'siys-lightbox',
    class SiysLightbox extends HTMLElement {
      connectedCallback() {
        // Appending to <body> below re-runs this callback — only wire up once.
        if (this.moved) return;
        this.moved = true;

        this.dialog = this.querySelector('[role="dialog"]');
        this.slides = Array.from(this.querySelectorAll('[data-siys-slide]'));
        this.counter = this.querySelector('[data-siys-current]');
        this.index = 0;
        this.onKeydown = this.handleKeydown.bind(this);

        // Openers live in the grid, which is earlier in the document than this
        // element, so they are already parsed by the time we get here.
        document.querySelectorAll(`[data-siys-open="${this.id}"]`).forEach((opener) => {
          opener.addEventListener('click', () => this.open(Number(opener.dataset.siysIndex) || 0, opener));
        });

        this.querySelector('[data-siys-close]').addEventListener('click', () => this.close());

        const prev = this.querySelector('[data-siys-prev]');
        const next = this.querySelector('[data-siys-next]');
        if (prev) prev.addEventListener('click', () => this.go(this.index - 1));
        if (next) next.addEventListener('click', () => this.go(this.index + 1));

        if (this.slides.length > 1) this.bindSwipe();

        this.addEventListener('click', (event) => {
          if (event.target === this) this.close();
        });

        // The accordion is a stacking context; a fixed overlay has to sit on
        // <body> to clear the header. Same move ModalDialog makes.
        document.body.appendChild(this);
      }

      /**
       * Touch-only swipe. Listeners stay passive — vertical scrolling inside
       * the caption is never blocked, so a drag that is mostly vertical, or
       * shorter than the threshold, is ignored.
       */
      bindSwipe() {
        const stage = this.querySelector('.siys-modal__stage');
        if (!stage) return;

        const THRESHOLD = 40;
        let start = null;

        stage.addEventListener(
          'touchstart',
          (event) => {
            const touch = event.changedTouches[0];
            start = { x: touch.clientX, y: touch.clientY };
          },
          { passive: true }
        );

        stage.addEventListener(
          'touchend',
          (event) => {
            if (!start) return;
            const touch = event.changedTouches[0];
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            start = null;

            if (Math.abs(dx) < THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
            if (dx < 0) this.go(this.index + 1);
            else this.go(this.index - 1);
          },
          { passive: true }
        );

        stage.addEventListener('touchcancel', () => {
          start = null;
        });
      }

      open(index, opener) {
        this.openedBy = opener;
        this.go(index);
        document.body.classList.add('overflow-hidden');
        this.setAttribute('open', '');
        document.addEventListener('keydown', this.onKeydown);
        trapFocus(this, this.dialog);
      }

      close() {
        this.removeAttribute('open');
        document.body.classList.remove('overflow-hidden');
        document.removeEventListener('keydown', this.onKeydown);
        removeTrapFocus(this.openedBy);
      }

      go(index) {
        const total = this.slides.length;
        this.index = (index + total) % total;

        this.slides.forEach((slide, i) => slide.toggleAttribute('hidden', i !== this.index));
        [this.index - 1, this.index, this.index + 1].forEach((i) => this.load((i + total) % total));

        if (this.counter) this.counter.textContent = this.index + 1;

        const label = this.slides[this.index].dataset.siysLabel;
        if (label) this.dialog.setAttribute('aria-label', label);
      }

      /** Swap in the full-size image; the 800px src stays painted until it decodes. */
      load(index) {
        const img = this.slides[index].querySelector('img[data-src]');
        if (!img) return;
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
      }

      handleKeydown(event) {
        if (!this.hasAttribute('open')) return;

        switch (event.key) {
          case 'Escape':
            this.close();
            break;
          case 'ArrowLeft':
            event.preventDefault();
            this.go(this.index - 1);
            break;
          case 'ArrowRight':
            event.preventDefault();
            this.go(this.index + 1);
            break;
          case 'Home':
            event.preventDefault();
            this.go(0);
            break;
          case 'End':
            event.preventDefault();
            this.go(this.slides.length - 1);
            break;
        }
      }
    }
  );
}
