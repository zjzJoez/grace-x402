/**
 * Top up any demo wallet straight from the hackathon wallet.
 *
 *   AGENT_PRIVATE_KEY=0x... node grace/topup.mjs 10           # -> cloud buyer
 *   AGENT_PRIVATE_KEY=0x... node grace/topup.mjs 5 0xAddr...  # -> explicit address
 *
 * Demo XSGD circulates between wallets we own, so this is topping up a float,
 * not spending. Never hardcode the key; env var only.
 */

import { erc20Abi, parseUnits, formatUnits } from 'viem'
import { pickNetwork } from './lib/xsgd.mjs'
import { publicClientFor, walletClientFor } from './lib/settle.mjs'
import { relayerAccount } from './lib/keys.mjs'

const CLOUD_BUYER = '0x855A4b2085B16065204c379439773a4F9Ef7F424'
const amountSgd = process.argv[2] ?? '10'
const to = process.argv[3] ?? CLOUD_BUYER

const funder = relayerAccount()
if (!funder) {
  console.error('set AGENT_PRIVATE_KEY (the funded hackathon wallet)')
  process.exit(1)
}

const net = pickNetwork('mainnet')
const client = publicClientFor(net)
const wallet = walletClientFor(net, funder)
const bal = (a) => client.readContract({ address: net.token, abi: erc20Abi, functionName: 'balanceOf', args: [a] })

console.log(`from ${funder.address}  (${formatUnits(await bal(funder.address), 6)} XSGD)`)
console.log(`to   ${to}  (${formatUnits(await bal(to), 6)} XSGD)`)
console.log(`sending ${amountSgd} XSGD…`)

const hash = await wallet.writeContract({
  address: net.token, abi: erc20Abi, functionName: 'transfer',
  args: [to, parseUnits(String(amountSgd), 6)],
})
await client.waitForTransactionReceipt({ hash })
console.log(`${net.explorer}/tx/${hash}`)
console.log(`recipient now holds ${formatUnits(await bal(to), 6)} XSGD`)
