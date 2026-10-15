/**
 * Rasterises scripts/icon.svg into the PWA icon set in public/icons/.
 * Run with: npm run icons
 *
 * The generated PNGs are committed, so neither CI nor a plain `npm run build`
 * needs sharp installed.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'public', 'icons');

// Maskable icons need their art inside a safe circle of ~80% of the canvas,
// so the launcher can crop to any shape. We scale the art down and pad it.
const MASKABLE_SAFE_RATIO = 0.78;
const BACKDROP = '#0d1117';

async function main() {
  await mkdir(outDir, { recursive: true });
  const svg = await readFile(resolve(here, 'icon.svg'));

  const plain = [192, 512, 180];
  for (const size of plain) {
    const png = await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain', background: BACKDROP })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
    await writeFile(resolve(outDir, name), png);
    console.log(`wrote icons/${name}`);
  }

  for (const size of [192, 512]) {
    const inner = Math.round(size * MASKABLE_SAFE_RATIO);
    const pad = Math.round((size - inner) / 2);
    const art = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer();
    const png = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: BACKDROP,
      },
    })
      .composite([{ input: art, top: pad, left: pad }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(resolve(outDir, `maskable-${size}.png`), png);
    console.log(`wrote icons/maskable-${size}.png`);
  }

  // Favicon: reuse the SVG directly, browsers handle it fine.
  await writeFile(resolve(root, 'public', 'favicon.svg'), svg);
  console.log('wrote favicon.svg');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
