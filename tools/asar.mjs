// Minimal asar archive reader: list paths and selectively extract files.
// Usage:
//   node tools/asar.mjs list  <archive> [substringFilter...]
//   node tools/asar.mjs extract <archive> <outDir> <substringFilter...>
import fs from 'node:fs';
import path from 'node:path';

const [cmd, archive, ...rest] = process.argv.slice(2);

function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const size0 = head.readUInt32LE(0); // always 4
  const size1 = head.readUInt32LE(4); // header pickle payload size
  const headerStringSize = head.readUInt32LE(8);

  // Read a generous window and carve out the balanced JSON object.
  const windowSize = Math.max(size1, headerStringSize) + 64;
  const win = Buffer.alloc(windowSize);
  fs.readSync(fd, win, 0, windowSize, 8);
  const text = win.toString('utf8');
  const start = text.indexOf('{');
  if (start < 0) throw new Error('asar: no JSON header found');
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error('asar: unterminated JSON header');
  const header = JSON.parse(text.slice(start, end));
  // File data starts after the 8-byte size preamble plus the header region.
  const candidates = [8 + size1, 16 + size1, 8 + headerStringSize + 8];
  const dataOffset = candidates[0];
  return { fd, header, dataOffset, size0, size1, headerStringSize };
}

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (entry.files) walk(entry, p, out);
    else out.push({ path: p, size: Number(entry.size ?? 0), offset: Number(entry.offset ?? 0), unpacked: !!entry.unpacked });
  }
}

const { fd, header, dataOffset, size0, size1, headerStringSize } = readHeader(archive);
const all = [];
walk(header, '', all);

function readFile(f) {
  const buf = Buffer.alloc(f.size);
  if (f.size > 0) fs.readSync(fd, buf, 0, f.size, dataOffset + f.offset);
  return buf;
}

if (cmd === 'list') {
  const filters = rest;
  const hits = filters.length ? all.filter((f) => filters.some((s) => f.path.includes(s))) : all;
  for (const f of hits) console.log(`${String(f.size).padStart(9)}  ${f.path}`);
  console.error(`[asar] size0=${size0} size1=${size1} headerStringSize=${headerStringSize} total=${all.length} matched=${hits.length}`);
  if (hits.length) {
    // self-check: verify offsets by reading the first match
    const probe = readFile(hits[0]);
    const looksText = !probe.includes(0) || probe.slice(0, 200).toString('utf8').includes('{');
    console.error(`[asar] probe ${hits[0].path}: first bytes=${JSON.stringify(probe.slice(0, 80).toString('utf8'))} textish=${looksText}`);
  }
} else if (cmd === 'extract') {
  const [outDir, ...restFilters] = rest;
  const all_ = restFilters.includes('--all');
  const filters = restFilters.filter((f) => f !== '--all');
  if (!filters.length && !all_) throw new Error('extract requires at least one path filter (or --all)');
  const hits = all_ && !filters.length ? all : all.filter((f) => filters.some((s) => f.path.includes(s)));
  let n = 0;
  for (const f of hits) {
    if (f.unpacked) continue;
    const dest = path.join(outDir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, readFile(f));
    n++;
  }
  console.log(`[asar] extracted ${n} files to ${outDir}`);
} else {
  throw new Error(`unknown command: ${cmd}`);
}
fs.closeSync(fd);
