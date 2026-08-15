/**
 * Recycle demo funds on the cloud instance: merchant -> buyer.
 *
 *   node grace/recycle-cloud.mjs [amount] [server]
 *
 * Demo settlements move XSGD from the buyer wallet to the merchant wallet, and
 * both belong to us — so a rehearsal costs nothing but gas. This asks the
 * instance to send it back, which keeps the demo runnable indefinitely without
 * ever touching the hackathon wallet. Keys never leave the instance.
 */

import { execFileSync } from 'node:child_process'

const AMOUNT = process.argv[2] ?? '8'
const SERVER = (process.argv[3] ?? 'http://13.212.242.21').replace(/\/$/, '')
const INSTANCE = process.env.GRACE_INSTANCE ?? 'i-0afb3e543be83b321'
const PROFILE = process.env.AWS_PROFILE ?? '688060218394_AdministratorAccess'
const REGION = process.env.AWS_REGION ?? 'ap-southeast-1'

const before = await fetch(`${SERVER}/api/orders`).then((r) => r.json())
console.log(`before — buyer ${before.buyerXsgd} XSGD · merchant ${before.merchantXsgd} XSGD`)

const script = `
cd /opt/grace-app && node --input-type=module -e "
import { erc20Abi, parseUnits, formatUnits } from 'viem'
import { pickNetwork } from './grace/lib/xsgd.mjs'
import { publicClientFor, walletClientFor } from './grace/lib/settle.mjs'
import { demoWallets } from './grace/lib/keys.mjs'
const net = pickNetwork('mainnet')
const { buyer, merchant } = demoWallets()
const c = publicClientFor(net), w = walletClientFor(net, merchant)
const amt = parseUnits('${AMOUNT}', 6)
const bal = await c.readContract({ address: net.token, abi: erc20Abi, functionName: 'balanceOf', args: [merchant.address] })
if (bal < amt) throw new Error('merchant holds only ' + formatUnits(bal, 6) + ' XSGD')
const hash = await w.writeContract({ address: net.token, abi: erc20Abi, functionName: 'transfer', args: [buyer.address, amt] })
await c.waitForTransactionReceipt({ hash })
console.log(net.explorer + '/tx/' + hash)
"`.trim()

const cmdId = execFileSync('aws', [
  'ssm', 'send-command', '--instance-ids', INSTANCE,
  '--document-name', 'AWS-RunShellScript',
  '--parameters', JSON.stringify({ commands: [script] }),
  '--profile', PROFILE, '--region', REGION,
  '--query', 'Command.CommandId', '--output', 'text',
]).toString().trim()

process.stdout.write('recycling')
let out = ''
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 4000))
  process.stdout.write('.')
  const res = JSON.parse(execFileSync('aws', [
    'ssm', 'get-command-invocation', '--command-id', cmdId, '--instance-id', INSTANCE,
    '--profile', PROFILE, '--region', REGION, '--output', 'json',
  ]).toString())
  if (res.Status !== 'InProgress') { out = res.StandardOutputContent + res.StandardErrorContent; break }
}
console.log('\n' + out.trim())

const after = await fetch(`${SERVER}/api/orders`).then((r) => r.json())
console.log(`after  — buyer ${after.buyerXsgd} XSGD · merchant ${after.merchantXsgd} XSGD`)
