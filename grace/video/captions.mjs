/**
 * The caption layer, injected into the page so it is captured in-frame.
 *
 * Rendering captions in the page (rather than burning them in afterwards) buys
 * two things: real CSS — a rounded, blurred, semi-transparent plate that sits
 * over the design instead of punching a rectangle through it — and frame-exact
 * sync, because the same clock drives the caption and the on-screen action.
 */

export const CAPTION_CSS = `
  #cap {
    position: fixed; left: 50%; bottom: 54px; transform: translateX(-50%) translateY(8px);
    z-index: 2147483647;
    max-width: min(1140px, 78vw);
    padding: 17px 40px;
    border-radius: 999px;
    /* Headless Chromium does not composite backdrop-filter into the capture, so
       the plate is a deliberate ink wash rather than glass: dark enough to hold
       white text over any part of the page, warm enough to belong to the paper. */
    background: linear-gradient(180deg, rgba(33,29,24,.90), rgba(24,21,17,.94));
    box-shadow: 0 2px 10px rgba(0,0,0,.18), 0 22px 54px -20px rgba(40,32,22,.55),
                inset 0 1px 0 rgba(255,255,255,.12);
    color: #fdfcfa;
    font: 500 27px/1.4 ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
    letter-spacing: -.008em;
    text-align: center;
    text-wrap: balance;
    text-shadow: 0 1px 2px rgba(0,0,0,.35);
    opacity: 0;
    transition: opacity .28s ease, transform .28s ease;
    pointer-events: none;
  }
  #cap.on { opacity: 1; transform: translateX(-50%) translateY(0); }
  /* two-line captions get a softer shape than a pure pill */
  #cap.tall { border-radius: 30px; }
`

/** Injected once; the driver calls window.__cap(text) to change the line. */
export const CAPTION_JS = `
  (() => {
    const el = document.createElement('div');
    el.id = 'cap';
    document.body.appendChild(el);
    let hideTimer = null;
    window.__cap = (text) => {
      clearTimeout(hideTimer);
      if (!text) { el.classList.remove('on'); return; }
      // swap while faded out so lines never cross-fade into each other
      el.classList.remove('on');
      hideTimer = setTimeout(() => {
        el.textContent = text;
        el.classList.toggle('tall', text.length > 62);
        el.classList.add('on');
      }, el.textContent ? 180 : 0);
    };
  })()
`

/**
 * Split a beat's speaking time across its caption lines, weighted by length so
 * a long line is not on screen for the same time as three words.
 */
export function planLines(beat, seconds) {
  const lines = beat.lines?.length ? beat.lines : [beat.text]
  const weights = lines.map((l) => Math.max(l.length, 14))
  const total = weights.reduce((a, b) => a + b, 0)
  return lines.map((text, i) => ({ text, seconds: (weights[i] / total) * seconds }))
}
