import { createPublicClient, http, toFunctionSelector, encodeFunctionData, toHex, keccak256, encodeAbiParameters } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'

const NETS = [
  { n: 'MAINNET 43114', chain: avalanche,     token: '0xb2F85b7AB3c2b6f62DF06dE6aE7D09c010a5096E' },
  { n: 'FUJI    43113', chain: avalancheFuji, token: '0xd769410dc8772695a7f55a304d2125320a65c2a5' },
]

const SIGS = [
  'transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)',
  'receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)',
  'cancelAuthorization(address,bytes32,uint8,bytes32,bytes32)',
  'authorizationState(address,bytes32)',
  'isBlacklisted(address)',
  'balanceOf(address)',
  'version()',
  'DOMAIN_SEPARATOR()',
]
const ZEPPELINOS = '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3'

for (const net of NETS) {
  const c = createPublicClient({ chain: net.chain, transport: http() })
  const slot = await c.getStorageAt({ address: net.token, slot: ZEPPELINOS })
  const impl = '0x' + slot.slice(-40)
  const code = await c.getCode({ address: impl })
  console.log(`\n=== ${net.n} ===`)
  console.log(`  proxy ${net.token}\n  impl  ${impl}  (${(code.length - 2) / 2} bytes)`)
  for (const sig of SIGS) {
    const sel = toFunctionSelector(sig)
    console.log(`  ${code.includes(sel.slice(2)) ? '✓' : '✗'} ${sel}  ${sig.split('(')[0]}`)
  }
  // EIP-712 domain version: try version() getter
  try {
    const v = await c.readContract({ address: net.token, abi: [{ name: 'version', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }], functionName: 'version' })
    console.log(`  version() => "${v}"`)
  } catch { console.log('  version() => (absent — must confirm domain version empirically)') }
}
