import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { createPublicClient, http, toHex, parseAbi } from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'
import crypto from 'node:crypto'

const ABI = parseAbi([
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
])
const account = privateKeyToAccount(generatePrivateKey())   // empty burner

for (const [label, chain, token] of [
  ['FUJI', avalancheFuji, '0xd769410dc8772695a7f55a304d2125320a65c2a5'],
  ['MAINNET', avalanche, '0xb2F85b7AB3c2b6f62DF06dE6aE7D09c010a5096E'],
]) {
  const c = createPublicClient({ chain, transport: http() })
  const now = Math.floor(Date.now() / 1000)

  for (const [caseName, validAfter] of [['FUTURE (+1h)', BigInt(now + 3600)], ['NOW (0)', 0n]]) {
    const msg = {
      from: account.address,
      to: '0x99a2B2962a6AC463FBe04664027Fdb3F68bd4Cc8',
      value: 1000000n,
      validAfter,
      validBefore: BigInt(now + 7200),
      nonce: toHex(crypto.randomBytes(32)),
    }
    const sig = await account.signTypedData({
      domain: { name: 'XSGD', version: '2', chainId: chain.id, verifyingContract: token },
      types: { TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
      primaryType: 'TransferWithAuthorization',
      message: msg,
    })
    const r = `0x${sig.slice(2, 66)}`, s = `0x${sig.slice(66, 130)}`, v = parseInt(sig.slice(130, 132), 16)

    let out
    try {
      await c.simulateContract({ address: token, abi: ABI, functionName: 'transferWithAuthorization',
        args: [msg.from, msg.to, msg.value, msg.validAfter, msg.validBefore, msg.nonce, v, r, s],
        account: '0x4B9E841a1A86730B3f42c7e963c86c4767847202' })
      out = 'NO REVERT (unexpected)'
    } catch (e) {
      const m = (e.shortMessage || e.message || '').match(/reverted with the following reason:\s*\n?(.+)/)
      out = m ? m[1].trim() : (e.details || e.shortMessage || '').slice(0, 120)
    }
    console.log(`${label.padEnd(8)} validAfter=${caseName.padEnd(12)} -> ${out}`)
  }
}
