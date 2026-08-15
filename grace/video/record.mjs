/**
 * Drive the demo, caption it, and capture it — all off one clock.
 *
 *   node grace/video/record.mjs [--server http://13.212.242.21] [--dry]
 *
 * grace/video/timing.json (from voice.mjs) says how long each spoken beat runs.
 * This holds each on-screen action for exactly that long and shows the beat's
 * caption lines across it, so the finished mux lines up without nudging.
 *
 * The order is real: a live Avalanche mainnet purchase, a real contract refusal,
 * a real cancellation. Nothing in the video is staged.
 */

import { chromium } from 'playwright'
import { readFileSync, mkdirSync, existsSync, renameSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAPTION_CSS, CAPTION_JS, planLines } from './captions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
const SERVER = arg('server', 'http://13.212.242.21').replace(/\/$/, '')
const OUT = join(HERE, 'capture')
mkdirSync(OUT, { recursive: true })

const script = JSON.parse(readFileSync(join(HERE, 'script.json'), 'utf8'))
if (!existsSync(join(HERE, 'timing.json'))) {
  console.error('no timing.json — run: node grace/video/voice.mjs')
  process.exit(1)
}
const timing = JSON.parse(readFileSync(join(HERE, 'timing.json'), 'utf8'))
const beat = (id) => timing.beats.find((b) => b.id === id)
const wait = (s) => new Promise((r) => setTimeout(r, Math.max(0, s) * 1000))

console.log(`\nGRACE capture — ${SERVER}`)
console.log(`  voice ${timing.voiceId} · narration ${timing.totalSeconds}s`)
for (const b of timing.beats) console.log(`   ${b.id.padEnd(10)} ${b.seconds.toFixed(2)}s  ${b.lines?.length ?? 1} caption(s)`)
if (process.argv.includes('--dry')) process.exit(0)

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  recordVideo: { dir: OUT, size: { width: 1600, height: 1000 } },
})
const page = await ctx.newPage()
await page.addStyleTag({ content: CAPTION_CSS }).catch(() => {})

await page.goto(`${SERVER}/`)
await page.waitForTimeout(2200)                 // let the first /api/state land
await page.addStyleTag({ content: CAPTION_CSS })
await page.evaluate(CAPTION_JS)

const cap = (t) => page.evaluate((x) => window.__cap(x), t).catch(() => {})

/**
 * Run a beat: kick off its action immediately, then walk its caption lines so
 * the last one clears exactly as the spoken line ends.
 */
async function runBeat(id, action) {
  const b = beat(id)
  const src = script.beats.find((x) => x.id === id)
  process.stdout.write(`  ${id.padEnd(10)} ${b.seconds.toFixed(2)}s `)
  const started = Date.now()
  const acting = action ? action() : Promise.resolve()

  for (const line of planLines(src, b.seconds)) {
    await cap(line.text)
    await wait(line.seconds - 0.18)             // 0.18s is the caption's swap fade
  }
  await acting
  const over = (Date.now() - started) / 1000 - b.seconds
  console.log(over > 0.4 ? `(+${over.toFixed(1)}s over)` : 'ok')
}

// 1 — the problem, over the idle screen
await runBeat('problem')

// 2 — a real purchase: Bedrock decides, the agent signs, the window opens
await runBeat('mechanism', async () => {
  const { spawn } = await import('node:child_process')
  await new Promise((res) => spawn('node',
    [join(HERE, '..', 'agent.mjs'), '--sku', 'tee-agentix', '--server', SERVER, '--brain',
     '--instruction', 'Buy me one hackathon tee, budget S$6'],
    { env: { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? '688060218394_AdministratorAccess' }, stdio: 'ignore' })
    .on('exit', res))
  await page.waitForTimeout(2200)
})

const { active } = await fetch(`${SERVER}/api/state`).then((r) => r.json())
if (!active) { console.error('\nno active order — is the buyer funded?'); await browser.close(); process.exit(1) }
console.log(`  order ${active.id}`)

// 3-4 — the merchant tries anyway; the chain answers in its own words
await runBeat('settle', async () => { await page.click('.bSettle').catch(() => {}); await page.waitForTimeout(1800) })
await runBeat('verdict')

// 5 — the human vetoes; this broadcasts a real cancelAuthorization
await runBeat('cancel', async () => { await page.click('.bCancel').catch(() => {}); await page.waitForTimeout(6500) })
await page.waitForTimeout(1500)                 // let VOID settle on screen before we move on

// 6 — the balances, which did not move
await runBeat('money', async () => { await page.locator('.money').scrollIntoViewIfNeeded() })

// 7 — close on the coupling strip, then lift back to the headline
await runBeat('close', async () => {
  await page.locator('.pieces').scrollIntoViewIfNeeded()
  await page.waitForTimeout(2000)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
})

await cap('')
await page.waitForTimeout(1400)                 // a clean tail to hold under the last word

await ctx.close()
await browser.close()

const vids = readdirSync(OUT).filter((f) => f.endsWith('.webm')).map((f) => join(OUT, f))
const latest = vids.sort().pop()
const named = join(OUT, 'demo-raw.webm')
if (latest && latest !== named) renameSync(latest, named)
console.log(`\n  captured → ${named}\n  next: node grace/video/mux.mjs\n`)
