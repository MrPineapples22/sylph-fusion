#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const excluded = new Set(['node_modules', '.git', 'dist']);

function walk(directory, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(fullPath, depth + 1, maxDepth));
    else {
      const stats = fs.statSync(fullPath);
      result.push({ path: path.relative(process.cwd(), fullPath), size: stats.size, modified: stats.mtime.toISOString() });
    }
  }
  return result;
}

console.log(JSON.stringify(walk(process.cwd()).sort((a, b) => b.modified.localeCompare(a.modified)), null, 2));
