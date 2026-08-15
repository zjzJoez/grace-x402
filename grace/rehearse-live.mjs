/**
 * Live-demo rehearsal against prod + README screenshot capture.
 * Exercises the exact path a judge would ask for on stage:
 *   terminal buy (Bedrock brain) → merchant screen cooling → SETTLE anyway
 *   refused by the chain → phone /pay/latest one-tap cancel → events ledger.
 * Cancel path costs zero XSGD — nothing ever moves.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SERVER = 'http://13.212.242.21'
const SHOTS = '/Users/joez/Desktop/StaritsX Hacks Project/grace/shots'
mkdirSync(SHOTS, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

// ── 1 · the terminal buy (real agent on the box, real Bedrock decision) ──────
await page.goto(`${SERVER}/stage/terminal`)
await page.evaluate(() => window.__type('buy me the hackathon tee — budget S$6', 25))
await wait(1500)
let orderId = null
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
    await page.evaluate(([l, c]) => window.__term(l, c), [line, cls]).catch(() => {})
    const m = line.match(/order ([0-9a-f]{8}) accepted/)
    if (m) orderId = m[1]
  }
}
if (!orderId) { console.error('no order accepted — abort'); process.exit(1) }
console.log('order', orderId)
await wait(600)
await page.screenshot({ path: join(SHOTS, 'terminal.png') })

// ── 2 · merchant screen: claim held, chain-blocked ───────────────────────────
await page.goto(`${SERVER}/`)
await page.waitForSelector('text=cannot cash it', { timeout: 15000 })
await wait(1200)
await page.screenshot({ path: join(SHOTS, 'merchant-cooling.png') })

// ── 3 · SETTLE anyway → the token contract itself refuses ───────────────────
await page.click('.bSettle')
await wait(2400)
await page.screenshot({ path: join(SHOTS, 'chain-refusal.png') })

// ── 4 · the payer's phone: /pay/latest, one tap ──────────────────────────────
const phone = await browser.newContext({
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
})
const ppage = await phone.newPage()
await ppage.goto(`${SERVER}/pay/latest`)
await wait(1800)
await ppage.screenshot({ path: join(SHOTS, 'phone-pending.png') })
await ppage.click('.cancel')
console.log('cancel tapped — broadcasting real cancelAuthorization…')
await wait(8000)
await ppage.screenshot({ path: join(SHOTS, 'phone-cancelled.png') })
await phone.close()

// ── 5 · back on the merchant screen: vetoed + events ledger ──────────────────
await page.reload()
await page.waitForSelector('text=vetoed', { timeout: 20000 }).catch(() => console.log('note: "vetoed" not seen'))
await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight }))
await wait(1500)
await page.screenshot({ path: join(SHOTS, 'events-ledger.png') })

const st = await fetch(`${SERVER}/api/orders/${orderId}`).then((r) => r.json())
console.log('final status:', st.status, '· cancel tx:', st.txs?.cancel ?? 'none')
await browser.close()
