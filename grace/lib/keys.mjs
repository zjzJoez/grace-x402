/**
 * GRACE demo wallets.
 *
 * Three roles, three keys:
 *   buyer    — holds XSGD, needs NO gas (cancellation is a meta-tx someone else broadcasts)
 *   merchant — holds AVAX for settlement gas, receives the XSGD
 *   relayer  — broadcasts cancellations on the buyer's behalf (defaults to the funded
 *              hackathon wallet via AGENT_PRIVATE_KEY, since it already has AVAX)
 *
 * buyer/merchant are generated once and persisted to grace/.keys.json (gitignored).
 * These are throwaway demo wallets that will only ever hold demo amounts.
 * The hackathon wallet's key is NEVER written to disk — env var only.
 */

import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const KEYS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.keys.json')

export function demoWallets() {
  let keys
  if (existsSync(KEYS_PATH)) {
    keys = JSON.parse(readFileSync(KEYS_PATH, 'utf8'))
  } else {
    keys = { buyer: generatePrivateKey(), merchant: generatePrivateKey() }
    writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2), { mode: 0o600 })
  }
  return {
    buyer: privateKeyToAccount(keys.buyer),
    merchant: privateKeyToAccount(keys.merchant),
  }
}

/** The funded hackathon wallet — env only, used as funder and cancel-relayer. */
export function relayerAccount() {
  const pk = process.env.AGENT_PRIVATE_KEY
  if (!pk) return null
  return privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)
}
