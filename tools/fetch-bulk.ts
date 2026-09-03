#!/usr/bin/env node
/**
 * Re-runnable fetcher for the Scryfall "default_cards" bulk data dump.
 *
 * Usage:
 *   node tools/fetch-bulk.ts [--force]
 *
 * Downloads data/raw/default-cards.jsonl.gz. Skips the download when the
 * local file already exists and is newer than the manifest's `updated_at`,
 * unless --force is passed.
 */

import { createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_PATH = path.join(ROOT, 'data/raw/default-cards.jsonl.gz');
const TMP_PATH = `${OUT_PATH}.part`;

const USER_AGENT = 'MagicCardUniverse/1.0 (+https://github.com/; offline data pipeline; contact: kyubi9tail@gmail.com)';
const HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' };

interface BulkDataEntry {
  type: string;
  updated_at: string;
  size: number;
  jsonl_download_uri: string;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

function printProgress(received: number, total: number): void {
  const pct = total > 0 ? ((received / total) * 100).toFixed(1) : '?';
  process.stderr.write(
    `\rDownloading: ${formatBytes(received)} / ${total ? formatBytes(total) : '?'} (${pct}%)   `,
  );
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  await mkdir(path.dirname(OUT_PATH), { recursive: true });

  process.stderr.write('Fetching bulk-data manifest from api.scryfall.com...\n');
  const manifestRes = await fetch('https://api.scryfall.com/bulk-data', { headers: HEADERS });
  if (!manifestRes.ok) {
    throw new Error(`bulk-data manifest request failed: ${manifestRes.status} ${manifestRes.statusText}`);
  }
  const manifest = (await manifestRes.json()) as { data: BulkDataEntry[] };
  const entry = manifest.data.find((e) => e.type === 'default_cards');
  if (!entry) throw new Error('No "default_cards" entry found in the bulk-data manifest');

  if (!force && existsSync(OUT_PATH)) {
    const stat = statSync(OUT_PATH);
    const updatedAt = Date.parse(entry.updated_at);
    if (stat.mtimeMs >= updatedAt) {
      process.stderr.write(
        `Local file (${stat.mtime.toISOString()}) is newer than manifest updated_at (${entry.updated_at}). ` +
          'Skipping download. Pass --force to re-download.\n',
      );
      return;
    }
  }

  process.stderr.write(`Downloading ${entry.jsonl_download_uri}\n  -> ${OUT_PATH}\n`);
  const res = await fetch(entry.jsonl_download_uri, { headers: HEADERS });
  if (!res.ok || !res.body) {
    throw new Error(`download request failed: ${res.status} ${res.statusText}`);
  }

  const total = Number(res.headers.get('content-length') ?? entry.size ?? 0);
  let received = 0;
  const out = createWriteStream(TMP_PATH);
  const reader = res.body.getReader();
  let lastPrint = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!out.write(value)) {
        await new Promise<void>((resolve) => out.once('drain', () => resolve()));
      }
      const now = Date.now();
      if (now - lastPrint > 200) {
        printProgress(received, total);
        lastPrint = now;
      }
    }
  } catch (err) {
    out.destroy();
    await unlink(TMP_PATH).catch(() => {});
    throw err;
  }
  printProgress(received, total);
  process.stderr.write('\n');
  out.end();
  await finished(out);

  await rename(TMP_PATH, OUT_PATH);
  process.stderr.write(`Done. Wrote ${formatBytes(received)} to ${OUT_PATH}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
