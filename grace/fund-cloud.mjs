/**
 * Fund the CLOUD demo wallets from the LOCAL demo wallets.
 *
 *   node grace/fund-cloud.mjs http://13.212.242.21
 *
 * The cloud instance generated its own keys at boot (they never traveled).
 * Its addresses are public via /api/orders. The local merchant wallet holds
 * the XSGD it earned in rehearsal settlements plus gas — recycle both.
 * No hackathon-wallet key involved.
 */

import { erc20Abi, parseUnits, parseEther, formatUnits, formatEther } from 'viem'
import { pickNetwork } from './lib/xsgd.mjs'
import { publicClientFor, walletClientFor } from './lib/settle.mjs'
import { demoWallets } from './lib/keys.mjs'

const SERVER = (process.argv[2] ?? 'http://13.212.242.21').replace(/\/$/, '')
const net = pickNetwork('mainnet')
const { merchant: localMerchant } = demoWallets()
const client = publicClientFor(net)
const wallet = walletClientFor(net, localMerchant)

const remote = await fetch(`${SERVER}/api/orders`).then((r) => r.json())
console.log(`cloud buyer    ${remote.buyer}`)
console.log(`cloud merchant ${remote.merchant}`)

const xsgd = await client.readContract({ address: net.token, abi: erc20Abi, functionName: 'balanceOf', args: [localMerchant.address] })
const avax = await client.getBalance({ address: localMerchant.address })
console.log(`local merchant has ${formatUnits(xsgd, 6)} XSGD, ${formatEther(avax)} AVAX`)

const XSGD_SEND = parseUnits(process.env.SEND_XSGD ?? '4', 6)
const AVAX_SEND = parseEther(process.env.SEND_AVAX ?? '0.02')
if (xsgd < XSGD_SEND) throw new Error('not enough XSGD on local merchant')

let hash = await wallet.writeContract({
  address: net.token, abi: erc20Abi, functionName: 'transfer', args: [remote.buyer, XSGD_SEND],
})
await client.waitForTransactionReceipt({ hash })
console.log(`XSGD -> cloud buyer     ${net.explorer}/tx/${hash}`)

hash = await wallet.sendTransaction({ to: remote.merchant, value: AVAX_SEND })
await client.waitForTransactionReceipt({ hash })
console.log(`AVAX -> cloud merchant  ${net.explorer}/tx/${hash}`)

const after = await fetch(`${SERVER}/api/orders`).then((r) => r.json())
console.log(`\ncloud buyer XSGD now: ${after.buyerXsgd}`)
