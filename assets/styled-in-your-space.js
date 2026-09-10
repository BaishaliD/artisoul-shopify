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
 * Click or tap the image to zoom to the point you clicked, drag to pan, click
 * again or press Esc to zoom back out. Zoom resets on slide change and close.
 *
 * Slide images render with the grid tile's 800px URL (a cache hit, so no empty
 * box on open) and carry the 1600px version in data-src. Only the current slide
 * and its two neighbours are upgraded, so a long set doesn't pull every full-
 * size image up front.
 */
const SIYS_ZOOM_SCALE = 2.5;
/* pointer travel under this counts as a click, not a drag */
const SIYS_CLICK_SLOP = 5;

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
        this.bindZoom();

        this.addEventListener('click', (event) => {
          // a pan that ended off the image resolves its click to the overlay
          if (this.dragged) return;
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

            if (this.zoomed) return; // a horizontal drag is a pan, not a slide change
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

      /**
       * Pointer events cover mouse and touch in one path. A press that barely
       * moves is a click (toggle zoom).
       *
       * While zoomed, a mouse or trackpad pans on hover alone — no button held
       * down, the pointer position simply maps onto the image. Touch has no
       * hover, so it pans by dragging instead.
       */
      bindZoom() {
        const stage = this.querySelector('.siys-modal__stage');
        if (!stage) return;

        this.zoomed = false;
        this.pan = { x: 0, y: 0 };
        let drag = null;

        stage.addEventListener('pointerdown', (event) => {
          const media = event.target.closest('.siys-modal__media');
          if (!media) return;

          drag = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: 0,
            panX: this.pan.x,
            panY: this.pan.y,
          };

          if (this.zoomed) {
            media.setPointerCapture(event.pointerId);
            event.preventDefault();
          }
        });

        stage.addEventListener('pointermove', (event) => {
          if (drag && event.pointerId === drag.id) {
            drag.moved = Math.max(
              drag.moved,
              Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y)
            );
          }

          if (!this.zoomed) return;

          if (event.pointerType === 'mouse') {
            const media = event.target.closest('.siys-modal__media');
            if (media) this.panToPointer(event, media);
            return;
          }

          if (!drag || event.pointerId !== drag.id) return;

          const media = this.currentMedia();
          if (media) media.classList.add('is-panning');

          // screen px -> image px: the translate is applied inside scale()
          this.pan = {
            x: drag.panX + (event.clientX - drag.x) / SIYS_ZOOM_SCALE,
            y: drag.panY + (event.clientY - drag.y) / SIYS_ZOOM_SCALE,
          };
          this.applyZoom();
        });

        const endDrag = (event) => {
          if (!drag || event.pointerId !== drag.id) return;

          const wasClick = drag.moved < SIYS_CLICK_SLOP;
          drag = null;

          const media = this.currentMedia();
          if (media) media.classList.remove('is-panning');

          if (!wasClick) {
            this.dragged = true;
            setTimeout(() => {
              this.dragged = false;
            }, 0);
            return;
          }

          if (this.zoomed) this.resetZoom();
          else this.zoomInAt(event);
        };

        stage.addEventListener('pointerup', endDrag);
        stage.addEventListener('pointercancel', endDrag);
      }

      currentMedia() {
        return this.slides[this.index].querySelector('.siys-modal__media');
      }

      currentImg() {
        return this.slides[this.index].querySelector('.siys-modal__img');
      }

      /** Zoom so the clicked point ends up in the middle of the frame. */
      zoomInAt(event) {
        const img = this.currentImg();
        const media = this.currentMedia();
        if (!img || !media) return;

        const rect = img.getBoundingClientRect();
        const offsetX = event.clientX - (rect.left + rect.width / 2);
        const offsetY = event.clientY - (rect.top + rect.height / 2);

        if (img.dataset.zoomSrc) {
          img.src = img.dataset.zoomSrc;
          img.removeAttribute('data-zoom-src');
        }

        this.zoomed = true;
        this.pan = { x: -offsetX, y: -offsetY };
        media.classList.add('is-zoomed');
        this.applyZoom();
      }

      /**
       * Hover pan: map the pointer's position over the frame straight onto the
       * pan range, so the left edge of the frame shows the left edge of the
       * image. Drops the zoom easing on the first move so tracking is exact.
       */
      panToPointer(event, media) {
        const rect = media.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        media.classList.add('is-panning');

        const fractionX = (event.clientX - rect.left) / rect.width;
        const fractionY = (event.clientY - rect.top) / rect.height;
        const limitX = ((SIYS_ZOOM_SCALE - 1) * rect.width) / (2 * SIYS_ZOOM_SCALE);
        const limitY = ((SIYS_ZOOM_SCALE - 1) * rect.height) / (2 * SIYS_ZOOM_SCALE);

        this.pan = {
          x: -(fractionX - 0.5) * 2 * limitX,
          y: -(fractionY - 0.5) * 2 * limitY,
        };
        this.applyZoom();
      }

      /** Clamp the pan so an edge of the image can never come inside the frame. */
      applyZoom() {
        const img = this.currentImg();
        const media = this.currentMedia();
        if (!img || !media || !this.zoomed) return;

        const rect = media.getBoundingClientRect();
        const limitX = ((SIYS_ZOOM_SCALE - 1) * rect.width) / (2 * SIYS_ZOOM_SCALE);
        const limitY = ((SIYS_ZOOM_SCALE - 1) * rect.height) / (2 * SIYS_ZOOM_SCALE);

        this.pan.x = Math.min(limitX, Math.max(-limitX, this.pan.x));
        this.pan.y = Math.min(limitY, Math.max(-limitY, this.pan.y));

        img.style.transform = `scale(${SIYS_ZOOM_SCALE}) translate(${this.pan.x}px, ${this.pan.y}px)`;
      }

      resetZoom() {
        this.zoomed = false;
        this.pan = { x: 0, y: 0 };

        this.slides.forEach((slide) => {
          const media = slide.querySelector('.siys-modal__media');
          if (media) media.classList.remove('is-zoomed', 'is-panning');
          const img = slide.querySelector('.siys-modal__img');
          if (img) img.style.transform = '';
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
        this.resetZoom();
        this.removeAttribute('open');
        document.body.classList.remove('overflow-hidden');
        document.removeEventListener('keydown', this.onKeydown);
        removeTrapFocus(this.openedBy);
      }

      go(index) {
        const total = this.slides.length;
        this.resetZoom();
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
            if (this.zoomed) this.resetZoom();
            else this.close();
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
