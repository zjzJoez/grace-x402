/**
 * Generate the narration from grace/video/script.json via ElevenLabs.
 *
 *   ELEVENLABS_API_KEY=... node grace/video/voice.mjs            # list voices
 *   ELEVENLABS_API_KEY=... node grace/video/voice.mjs <voiceId>  # render
 *
 * Each beat is rendered to its own mp3 and measured, so the demo script can
 * hold each on-screen action for exactly as long as its line takes to say.
 * A combined track is written too, for muxing over the final capture.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'audio')

/** env var first, then the gitignored .env at the project root */
function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY
  const envFile = join(HERE, '..', '..', '.env')
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^\s*ELEVENLABS_API_KEY\s*=\s*(.+)$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

const KEY = apiKey()
if (!KEY) {
  console.error('no ELEVENLABS_API_KEY — export it, or put it in the gitignored .env at the project root')
  process.exit(1)
}

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.elevenlabs.io/v1${path}`, {
    ...init,
    headers: { 'xi-api-key': KEY, ...(init.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res
}

const script0 = JSON.parse(readFileSync(join(HERE, 'script.json'), 'utf8'))
const voiceId = process.argv[2] ?? script0.voice?.id

if (!voiceId) {
  const { voices } = await (await api('/voices')).json()
  console.log('\nAvailable voices — pick a calm, low, unhurried male read:\n')
  for (const v of voices) {
    const l = v.labels ?? {}
    console.log(`  ${v.voice_id}  ${v.name.padEnd(14)} ${[l.gender, l.age, l.accent, l.descriptive ?? l.description].filter(Boolean).join(' · ')}`)
  }
  console.log('\nthen: node grace/video/voice.mjs <voiceId>\n')
  process.exit(0)
}

const script = script0
mkdirSync(OUT, { recursive: true })

const durationOf = (f) =>
  parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim())

const manifest = []
let total = 0

for (const beat of script.beats) {
  const file = join(OUT, `${beat.id}.mp3`)
  process.stdout.write(`  ${beat.id.padEnd(10)} `)
  const res = await api(`/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: beat.text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: script.voice.settings,
    }),
  })
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  const d = durationOf(file)
  total += d
  manifest.push({ ...beat, file, seconds: +d.toFixed(2), startsAt: +(total - d).toFixed(2) })
  console.log(`${d.toFixed(2)}s`)
}

// one continuous track for the final mux
const listFile = join(OUT, 'concat.txt')
writeFileSync(listFile, manifest.map((m) => `file '${m.file}'`).join('\n'))
execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', join(OUT, 'narration.mp3')], { stdio: 'ignore' })

writeFileSync(join(HERE, 'timing.json'), JSON.stringify({ voiceId, totalSeconds: +total.toFixed(2), beats: manifest }, null, 2))

console.log(`\n  total ${total.toFixed(1)}s  →  ${join(OUT, 'narration.mp3')}`)
if (total > 62) console.log(`  ⚠ over 60s — trim the longest beats in script.json and re-run`)
console.log(`  timing written to grace/video/timing.json\n`)
