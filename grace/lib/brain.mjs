/**
 * GRACE agent brain — a real purchase decision from Claude on Amazon Bedrock.
 *
 * Before signing anything, the agent shows Claude the instruction it was given,
 * the merchant's 402 challenge, and its wallet state, and asks for a decision.
 * The brain's judgment is advisory on top of a hard rail: even when it approves,
 * the human still gets the cooling-off window. GRACE assumes agents WILL be
 * wrong sometimes — that is the whole point.
 *
 * Uses the aws CLI (SigV4 etc. for free) so this file has zero dependencies.
 * Hackathon account note: the org SCP only allows in-region on-demand models,
 * hence claude-3-5-sonnet-20240620 rather than an inference profile.
 */

import { execFile } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MODEL = process.env.BRAIN_MODEL ?? 'anthropic.claude-3-5-sonnet-20240620-v1:0'
const REGION = process.env.BRAIN_REGION ?? 'ap-southeast-1'

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout)
    )
  })

/**
 * @returns {Promise<{approve: boolean, reason: string, model: string}>}
 */
export async function decidePurchase({ instruction, challenge, walletXsgd }) {
  const prompt = `You are the purchasing brain of an autonomous shopping agent. Decide whether to proceed with this purchase.

USER INSTRUCTION: ${instruction}

MERCHANT OFFER (x402 challenge):
- item: ${challenge.extra?.description ?? challenge.extra?.sku}
- price: ${Number(challenge.amount) / 1e6} XSGD (Singapore dollar stablecoin)
- cooling-off period: ${challenge.extra?.coolingOffSeconds}s (after you pay, the human can unilaterally cancel on-chain during this window; the merchant cannot settle until it closes)
- network: ${challenge.network}

WALLET: ${walletXsgd} XSGD available.

Rules: reject if the price is unreasonable for the item, exceeds the wallet, or does not plausibly satisfy the instruction. A nonzero cooling-off period protects your human, favor merchants that offer one.

Respond with ONLY a JSON object: {"approve": true/false, "reason": "<one sentence>"}`

  const parse = (out, model) => {
    const m = out.match(/\{[\s\S]*\}/)
    if (!m) throw new Error(`unparseable brain output: ${out.slice(0, 120)}`)
    const d = JSON.parse(m[0])
    return { approve: !!d.approve, reason: String(d.reason ?? ''), model }
  }

  // Primary: Claude on Amazon Bedrock.
  const messages = JSON.stringify([{ role: 'user', content: [{ text: prompt }] }])
  const payloadPath = join(tmpdir(), `grace-brain-${process.pid}.json`)
  writeFileSync(payloadPath, messages)
  try {
    const out = await run('aws', [
      'bedrock-runtime', 'converse',
      '--model-id', MODEL,
      '--messages', `file://${payloadPath}`,
      '--inference-config', '{"maxTokens":200,"temperature":0}',
      '--region', REGION,
      ...(process.env.AWS_PROFILE ? [] : ['--profile', process.env.BRAIN_PROFILE ?? '688060218394_AdministratorAccess']),
      '--query', 'output.message.content[0].text',
      '--output', 'text',
    ])
    return parse(out, `bedrock:${MODEL}`)
  } catch (bedrockErr) {
    // Fallback: local Claude CLI. The brain is model-agnostic by design — on
    // accounts where the org SCP blocks Bedrock marketplace subscriptions
    // (like this hackathon org), the same decision runs anywhere Claude does.
    try {
      const out = await run('claude', ['-p', prompt, '--output-format', 'text', '--model', 'haiku'])
      return parse(out, 'local:claude-haiku')
    } catch {
      throw bedrockErr // report the primary failure, it is the actionable one
    }
  } finally {
    rmSync(payloadPath, { force: true })
  }
}
