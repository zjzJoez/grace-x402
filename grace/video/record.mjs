/**
 * The take: three stages, one clock.
 *
 *   node grace/video/record.mjs [--server http://13.212.242.21] [--dry]
 *
 * Scene cuts are real page navigations — terminal, merchant screen, the payer's
 * phone, back, end card — and everything inside them is real: the terminal
 * streams the actual agent's stdout, the phone tap broadcasts an actual mainnet
 * cancellation, and the settled order in the events list was settled by
 * EventBridge minutes earlier, on its own.
 *
 * Choreography note: run `node grace/video/prepare.mjs` first. It clears the
 * book and places order A, which the autopilot settles while you set up — that
 * settled order is scene six's evidence.
 */

import { chromium } from 'playwright'
import { readFileSync, mkdirSync, existsSync, renameSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAPTION_CSS, CAPTION_JS, planLines } from './captions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
const SERVER = arg('server', 'http://13.212.242.21').replace(/\/$/, '')
const OUT = join(HERE, 'capture')
mkdirSync(OUT, { recursive: true })

const script = JSON.parse(readFileSync(join(HERE, 'script.json'), 'utf8'))
if (!existsSync(join(HERE, 'timing.json'))) { console.error('run voice.mjs first'); process.exit(1) }
const timing = JSON.parse(readFileSync(join(HERE, 'timing.json'), 'utf8'))
const beat = (id) => timing.beats.find((b) => b.id === id)
const wait = (s) => new Promise((r) => setTimeout(r, Math.max(0, s) * 1000))

console.log(`\nGRACE take — ${SERVER} · narration ${timing.totalSeconds}s`)
for (const b of timing.beats) console.log(`   ${b.id.padEnd(10)} ${b.seconds.toFixed(2)}s`)
if (process.argv.includes('--dry')) process.exit(0)

// scene six's evidence must exist before we roll
const pre = await fetch(`${SERVER}/api/state`).then((r) => r.json())
const settled = pre.orders.find((o) => o.status === 'settled')
if (!settled) { console.error('\nno settled order in the book — run prepare.mjs and wait for autopilot'); process.exit(1) }
console.log(`  scene-6 evidence: order ${settled.id} settled by autopilot ✓`)

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  recordVideo: { dir: OUT, size: { width: 1600, height: 1000 } },
})
const page = await ctx.newPage()

/** captions live inside whichever page is on stage */
async function caps() {
  await page.addStyleTag({ content: CAPTION_CSS })
  await page.evaluate(CAPTION_JS)
}
const cap = (t) => page.evaluate((x) => window.__cap && window.__cap(x), t).catch(() => {})

/** speak a beat's captions across its measured duration; action runs alongside */
async function runBeat(id, action) {
  const b = beat(id)
  const src = script.beats.find((x) => x.id === id)
  process.stdout.write(`  ${id.padEnd(10)} ${b.seconds.toFixed(2)}s `)
  const acting = action ? action() : Promise.resolve()
  for (const line of planLines(src, b.seconds)) {
    await cap(line.text)
    await wait(line.seconds - 0.18)
  }
  await acting
  console.log('ok')
}

// ── scene 1 · the agent's terminal ───────────────────────────────────────────
await page.goto(`${SERVER}/stage/terminal`)
await caps()
let orderId = null
await runBeat('terminal', async () => {
  await page.evaluate(() => window.__type(
    `buy me the hackathon tee — budget S$6`, 30))
  // the purchase runs ON the merchant box as ITS demo buyer — the only wallet
  // the server can honestly cancel for — and streams its real stdout here
  const res = await fetch(`${SERVER}/api/demo/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku: 'tee-agentix', brain: true, instruction: 'Buy me one hackathon tee, budget S$6' }),
  })
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, nl); buf = buf.slice(nl + 1)
      line = line.replace(/\x1b\[[0-9;]*m/g, '').trimEnd()
      if (!line.trim()) continue
      const cls = /APPROVE|REJECT/.test(line) ? 'brain'
                : /accepted/.test(line) ? 'ok'
                : /confirm page/.test(line) ? 'link' : 'dim'
      page.evaluate(([l, c]) => window.__term(l, c), [line, cls]).catch(() => {})
      const m = line.match(/order ([0-9a-f]{8}) accepted/)
      if (m) orderId = m[1]
    }
  }
})
if (!orderId) { console.error('agent produced no order'); await browser.close(); process.exit(1) }
console.log(`  order ${orderId}`)

// ── scene 2 · the merchant's screen ──────────────────────────────────────────
await page.goto(`${SERVER}/`)
await page.waitForSelector('text=cannot cash it', { timeout: 15000 }).catch(() => {})
await caps()
await runBeat('cooling')

// ── scene 3 · the chain refuses ──────────────────────────────────────────────
await runBeat('refuse', async () => {
  await page.click('.bSettle').catch(() => {})
  await page.waitForTimeout(1800)
})

// ── scene 4 · the payer's phone ──────────────────────────────────────────────
await page.goto(`${SERVER}/phone?id=${orderId}`)
await page.waitForTimeout(1800)                 // let the iframe render its countdown
await caps()
await runBeat('phone', async () => {
  await wait(2.2)                               // give "this is your phone" a moment on screen
  const frame = page.frameLocator('#pf')
  await frame.locator('.cancel').click().catch(() => {})
  await page.waitForTimeout(6000)               // real broadcast + CANCELLED state
})

// ── scene 5 · the money did not move ─────────────────────────────────────────
await page.goto(`${SERVER}/`)
await page.waitForSelector('text=vetoed', { timeout: 15000 }).catch(() => {})
await caps()
await runBeat('money', async () => {
  await page.locator('.money').scrollIntoViewIfNeeded()
})

// ── scene 6 · the happy path already happened ────────────────────────────────
await runBeat('autopilot', async () => {
  // frame the whole evidence card above the caption zone
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }))
  await new Promise((r) => setTimeout(r, 900))
  // let the settled row glow so the eye lands on the right line
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.ev .used')].pop()
    if (el) { el.closest('.ev').style.transition = 'background .6s'
              el.closest('.ev').style.background = 'rgba(47,107,82,.12)'
              el.closest('.ev').style.borderRadius = '8px' }
  })
})

// ── scene 7 · the card ───────────────────────────────────────────────────────
await page.goto(`${SERVER}/stage/end`)
await caps()
await runBeat('close')
await cap('')
await wait(1.6)

await ctx.close()
await browser.close()

const vids = readdirSync(OUT).filter((f) => f.endsWith('.webm')).map((f) => join(OUT, f))
const latest = vids.sort().pop()
const named = join(OUT, 'demo-raw.webm')
if (latest && latest !== named) renameSync(latest, named)
console.log(`\n  captured → ${named}\n  next: node grace/video/mux.mjs\n`)
