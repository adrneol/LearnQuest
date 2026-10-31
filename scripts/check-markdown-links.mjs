/**
 * Dependency-free local Markdown link checker.
 *
 * Scans every Markdown file under the repository root and verifies that each
 * relative link resolves to an existing file or directory. External URLs,
 * mail links, anchor-only links, and fragment suffixes on local paths are
 * ignored. It never reads `.env` or prints file contents.
 *
 * Usage (from the repository root or any working directory):
 *   node scripts/check-markdown-links.mjs
 *
 * Exit codes:
 *   0  every local link resolves
 *   1  one or more local links are missing
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const skippedDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage', '.cache']);
const markdownFiles = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      markdownFiles.push(fullPath);
    }
  }
}

await walk(root);

const failures = [];
let checked = 0;

for (const file of markdownFiles) {
  const text = await readFile(file, 'utf8');
  const linkPattern = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of text.matchAll(linkPattern)) {
    let target = match[2].trim();
    if (!target || target.startsWith('#') || /^(https?|mailto|tel|data):/i.test(target)) continue;

    target = target.replace(/^<|>$/g, '');
    const hashIndex = target.indexOf('#');
    if (hashIndex >= 0) target = target.slice(0, hashIndex);
    if (!target) continue;

    try {
      target = decodeURIComponent(target);
    } catch {
      // Leave malformed percent escapes unchanged; existsSync will report them
      // as missing rather than crashing the checker.
    }

    const resolved = target.startsWith('/')
      ? path.join(root, target.replace(/^\/+/, ''))
      : path.resolve(path.dirname(file), target);
    checked += 1;
    if (!existsSync(resolved)) {
      failures.push({
        file: path.relative(root, file),
        target,
        resolved: path.relative(root, resolved),
      });
    }
  }
}

console.log(`Markdown files: ${markdownFiles.length}`);
console.log(`Local links checked: ${checked}`);

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} local link(s) do not resolve`);
  for (const failure of failures) {
    console.error(`${failure.file} -> ${failure.target} (${failure.resolved})`);
  }
  process.exitCode = 1;
} else {
  console.log('PASS: all local links resolve');
}
