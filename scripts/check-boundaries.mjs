import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
export async function violations(root) {
  const errors = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.next'].includes(entry.name)) continue;
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.[cm]?[jt]sx?$/.test(path)) {
        const source = await readFile(path, 'utf8');
        const file = relative(root, path).replaceAll('\\', '/');
        for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
          const spec = match[1];
          if (spec.includes('/src/') || spec.includes('/apps/') || (file.startsWith('packages/') && spec.startsWith('@vcp/web'))) errors.push(`${file}: forbidden import ${spec}`);
        }
        if (!file.startsWith('packages/market-data/') && /https?:\/\/[^\s'"`]*angelone/i.test(source)) errors.push(`${file}: broker access outside gateway`);
      }
    }
  }
  for (const dir of ['apps', 'packages']) await walk(resolve(root, dir));
  return errors;
}
if (process.argv[1]?.endsWith('check-boundaries.mjs')) {
  const errors = await violations(process.cwd());
  for (const error of errors) console.error(error);
  if (errors.length) process.exitCode = 1;
  else console.log('Package boundary checks passed');
}
