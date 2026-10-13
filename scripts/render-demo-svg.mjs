import { readFileSync, writeFileSync } from 'node:fs'

// Renders docs/demo.svg from docs/demo-check.txt.
// The transcript is stdout from `node dist/cli.js check`, captured against the public npm registry on 2026-10-13.
const source = new URL('../docs/demo-check.txt', import.meta.url)
const target = new URL('../docs/demo.svg', import.meta.url)
const width = 980
const wrapAt = 104
const lineHeight = 20
const raw = readFileSync(source, 'utf8').replace(/\n$/, '').split('\n')
const lines = raw.flatMap((line) => wrap(line, wrapAt))
const height = 56 + lines.length * lineHeight + 20

let inBullet = false
const body = lines
  .map((line, index) => {
    if (line.startsWith('  • ')) inBullet = true
    else if (line.trim() !== '' && !line.startsWith('    ')) inBullet = false
    const y = 64 + index * lineHeight
    const fill = inBullet && line.startsWith('    ') ? '#e6d3a1' : color(line)
    return `<text x="24" y="${y}" fill="${fill}">${escapeXml(line || ' ')}</text>`
  })
  .join('\n')

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <title>slopgate blocks react-codeshift and allows react</title>
  <desc>Output of node dist/cli.js check react-codeshift and node dist/cli.js check react on 2026-10-13.</desc>
  <rect width="${width}" height="${height}" rx="14" fill="#1c1915"/>
  <circle cx="28" cy="24" r="6" fill="#c4554a"/>
  <circle cx="48" cy="24" r="6" fill="#d2b06a"/>
  <circle cx="68" cy="24" r="6" fill="#7ea37a"/>
  <text x="88" y="29" fill="#a39a8c" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="13">slopgate — public npm registry, 13 Oct 2026</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14">
${body}
  </g>
</svg>
`

writeFileSync(target, svg)
console.log(`wrote ${target.pathname} (${width}x${height})`)

function wrap(line, limit) {
  if (line.length <= limit) return [line]
  const rows = []
  let rest = line
  const indent = line.match(/^ */)?.[0] ?? ''
  const continuation = indent.length > 0 ? `${indent}  ` : ''
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit)
    if (cut < 16) cut = limit
    rows.push(rest.slice(0, cut))
    rest = continuation + rest.slice(cut).replace(/^ /, '')
  }
  if (rest) rows.push(rest)
  return rows
}

function color(line) {
  if (line.startsWith('$ ')) return '#f4efe6'
  if (line.includes('blocked') || line.includes('— block')) return '#e07a70'
  if (line.includes('— allow')) return '#8fbf88'
  if (line.startsWith('  • ')) return '#e6d3a1'
  return '#d9d0c1'
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
