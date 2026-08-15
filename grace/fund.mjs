/**
 * Split demo funds out of the hackathon wallet.
 *
 *   AGENT_PRIVATE_KEY=0x... node grace/fund.mjs            # mainnet
 *   AGENT_PRIVATE_KEY=0x... GRACE_NETWORK=fuji node grace/fund.mjs
 *
 * buyer   gets XSGD only  (cancel is a meta-tx — the buyer never needs gas)
 * merchant gets AVAX only (it pays settlement gas; it RECEIVES the XSGD)
 *
 * XSGD moving buyer -> merchant during demos is our own money moving between
 * our own wallets: net burn is zero, so rehearsals on mainnet cost only gas.
 */

import { erc20Abi, parseUnits, parseEther, formatUnits, formatEther } from 'viem'
import { pickNetwork } from './lib/xsgd.mjs'
import { publicClientFor, walletClientFor } from './lib/settle.mjs'
import { demoWallets, relayerAccount } from './lib/keys.mjs'

const net = pickNetwork()
const funder = relayerAccount()
if (!funder) {
  console.error('set AGENT_PRIVATE_KEY (the funded hackathon wallet). Never hardcode it.')
  process.exit(1)
}

const { buyer, merchant } = demoWallets()
const client = publicClientFor(net)
const wallet = walletClientFor(net, funder)

const XSGD_TO_BUYER = parseUnits(process.env.FUND_XSGD ?? '12', 6)
const AVAX_TO_MERCHANT = parseEther(process.env.FUND_AVAX ?? '0.05')

console.log(`\nGRACE fund — ${net.label}`)
console.log(`  funder   ${funder.address}`)
console.log(`  buyer    ${buyer.address}   <- ${formatUnits(XSGD_TO_BUYER, 6)} XSGD`)
console.log(`  merchant ${merchant.address}   <- ${formatEther(AVAX_TO_MERCHANT)} AVAX\n`)

const bal = (addr) => client.readContract({ address: net.token, abi: erc20Abi, functionName: 'balanceOf', args: [addr] })

const buyerHas = await bal(buyer.address)
if (buyerHas >= XSGD_TO_BUYER) {
  console.log(`  buyer already holds ${formatUnits(buyerHas, 6)} XSGD — skipping`)
} else {
  const hash = await wallet.writeContract({
    address: net.token, abi: erc20Abi, functionName: 'transfer',
    args: [buyer.address, XSGD_TO_BUYER - buyerHas],
  })
  await client.waitForTransactionReceipt({ hash })
  console.log(`  XSGD -> buyer     ${net.explorer}/tx/${hash}`)
}

const merchantHas = await client.getBalance({ address: merchant.address })
if (merchantHas >= AVAX_TO_MERCHANT) {
  console.log(`  merchant already holds ${formatEther(merchantHas)} AVAX — skipping`)
} else {
  const hash = await wallet.sendTransaction({ to: merchant.address, value: AVAX_TO_MERCHANT - merchantHas })
  await client.waitForTransactionReceipt({ hash })
  console.log(`  AVAX -> merchant  ${net.explorer}/tx/${hash}`)
}

console.log(`\n  buyer XSGD    ${formatUnits(await bal(buyer.address), 6)}`)
console.log(`  merchant AVAX ${formatEther(await client.getBalance({ address: merchant.address }))}`)
console.log(`  funder AVAX   ${formatEther(await client.getBalance({ address: funder.address }))}  (also the cancel relayer)\n`)
