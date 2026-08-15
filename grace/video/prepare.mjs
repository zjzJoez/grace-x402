/**
 * Set the stage: clear the book, place order A, wait for the autopilot to
 * settle it. That settled order is the video's scene-six evidence — settled by
 * EventBridge on its own, minutes before the take.
 *
 *   node grace/video/prepare.mjs [--server http://13.212.242.21]
 */

import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
const SERVER = arg('server', 'http://13.212.242.21').replace(/\/$/, '')
const PROFILE = process.env.AWS_PROFILE ?? '688060218394_AdministratorAccess'
const REGION = 'ap-southeast-1'
const INSTANCE = 'i-0afb3e543be83b321'

// clear the order book on the instance
console.log('→ clearing the order book')
const params = join(HERE, 'clear-params.json')
writeFileSync(params, JSON.stringify({ commands: ["cd /opt/grace-app && echo '[]' > grace/orders.json && systemctl restart grace && sleep 3 && systemctl is-active grace"] }))
const cid = execFileSync('aws', ['ssm', 'send-command', '--instance-ids', INSTANCE,
  '--document-name', 'AWS-RunShellScript', '--parameters', `file://${params}`,
  '--profile', PROFILE, '--region', REGION, '--query', 'Command.CommandId', '--output', 'text']).toString().trim()
await new Promise((r) => setTimeout(r, 12000))
console.log('  ' + execFileSync('aws', ['ssm', 'get-command-invocation', '--command-id', cid,
  '--instance-id', INSTANCE, '--profile', PROFILE, '--region', REGION,
  '--query', 'StandardOutputContent', '--output', 'text']).toString().trim())

// order A — the one the autopilot will settle while we set up
console.log('→ placing order A (the autopilot will settle it)')
await new Promise((res) => spawn('node',
  [join(HERE, '..', 'agent.mjs'), '--sku', 'tee-agentix', '--server', SERVER,
   '--instruction', 'setup order for the take'],
  { env: { ...process.env, AWS_PROFILE: PROFILE }, stdio: 'inherit' }).on('exit', res))

process.stdout.write('→ waiting for EventBridge to settle it ')
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 8000))
  const s = await fetch(`${SERVER}/api/state`).then((r) => r.json())
  const settled = s.orders.find((o) => o.status === 'settled')
  if (settled) {
    console.log(`\n  ✓ order ${settled.id} settled on its own — tx ${settled.txs.settle.slice(0, 14)}…`)
    console.log(`\nstage is set. roll with: node grace/video/record.mjs\n`)
    process.exit(0)
  }
  process.stdout.write('.')
}
console.error('\nautopilot did not settle within 5 minutes — check the Lambda logs')
process.exit(1)
