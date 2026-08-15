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
    padding: 16px 34px;
    border-radius: 26px;
    /* Light glass, iOS style: the bubble takes the colour of whatever paper it
       sits on and lifts it slightly, with a hairline of light around the edge.
       Captions always land over the paper, so dark ink text stays readable. */
    background: rgba(255, 253, 248, 0.62);
    border: 1px solid rgba(60, 49, 33, 0.10);
    box-shadow: 0 1px 2px rgba(60,49,33,.10), 0 16px 38px -16px rgba(60,49,33,.32),
                inset 0 1px 0 rgba(255,255,255,.8);
    color: rgba(24, 20, 15, 0.95);
    font: 590 26px/1.42 -apple-system, BlinkMacSystemFont, "SF Pro Display", ui-sans-serif, "Segoe UI", sans-serif;
    letter-spacing: .002em;
    text-align: center;
    text-wrap: balance;
    opacity: 0;
    transition: opacity .28s ease, transform .28s ease;
    pointer-events: none;
  }
  #cap.on { opacity: 1; transform: translateX(-50%) translateY(0); }
  #cap.tall { border-radius: 28px; }
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
