/**
 * Combine the capture and the narration into the file we submit.
 *
 *   node grace/video/mux.mjs
 *
 * Produces grace/video/GRACE-demo.mp4 — H.264/AAC, 1600x1000, which every
 * browser and every submission form accepts. If the capture runs longer than
 * the narration the tail is kept (a beat of silence on the closing frame reads
 * as deliberate); if it runs short, the video is held on its last frame.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const VIDEO = join(HERE, 'capture', 'demo-raw.webm')
const AUDIO = join(HERE, 'audio', 'narration.mp3')
const OUT = join(HERE, 'GRACE-demo.mp4')

for (const [label, f] of [['capture', VIDEO], ['narration', AUDIO]]) {
  if (!existsSync(f)) { console.error(`missing ${label}: ${f}`); process.exit(1) }
}

const dur = (f) => parseFloat(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim())

const v = dur(VIDEO), a = dur(AUDIO)
console.log(`\n  video ${v.toFixed(1)}s · audio ${a.toFixed(1)}s`)

const args = ['-y', '-i', VIDEO, '-i', AUDIO]
if (a > v) {
  // hold the last frame rather than cutting the narration off mid-sentence
  args.splice(2, 0, '-vf', `tpad=stop_mode=clone:stop_duration=${(a - v + 0.6).toFixed(2)}`)
  console.log('  holding the final frame so the closing line lands')
}
args.push(
  '-map', '0:v:0', '-map', '1:a:0',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart',
  '-shortest',
  OUT,
)

execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] })
const out = dur(OUT)
console.log(`\n  → ${OUT}  (${out.toFixed(1)}s)`)
if (out > 62) console.log('  ⚠ over 60s — trim a beat in script.json, re-run voice.mjs and record.mjs')
console.log()
