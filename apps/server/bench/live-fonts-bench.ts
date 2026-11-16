/**
 * Bytes a live-preview session sends for pdfTeX pages, with each page's
 * fonts inside its PDF and with fonts sent once per connection (what the
 * live route does since pages leave them out). For each PDF given, it
 * replays a session that shows every page in turn (scrolling through the
 * document), then all pages again (as after edits that change them all, the
 * worst case for one run). Sizes are message payloads, before and after
 * permessage-deflate (raw DEFLATE, as `ws` does without context takeover).
 * Run with `pnpm bench:live-fonts <file.pdf>...`.
 */
import { deflateRawSync } from 'node:zlib';
import { encodeLiveBinary } from '@myleaf/api';
import type { LiveBinaryMessage, LiveServerMessage } from '@myleaf/api';
import { extractPages } from '@myleaf/live-pdftex';
import { LiveFonts } from '@myleaf/server';

interface Sizes {
  raw: number;
  deflated: number;
}
const add = (sizes: Sizes, message: LiveBinaryMessage | LiveServerMessage) => {
  const encoded =
    message.type === 'font' || (message.type === 'page' && 'pdf' in message)
      ? encodeLiveBinary(message)
      : new TextEncoder().encode(JSON.stringify(message));
  sizes.raw += encoded.length;
  sizes.deflated += deflateRawSync(encoded).length;
};
const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;
const cut = (before: number, after: number) => `${((1 - after / before) * 100).toFixed(0)}%`;

for (const path of process.argv.slice(2)) {
  const whole = await extractPages(path, 1, 1000);
  const separate = await extractPages(path, 1, 1000, () => {}, { separateFonts: true });
  const rounds = [
    {
      name: 'first view of every page',
      before: { raw: 0, deflated: 0 },
      after: { raw: 0, deflated: 0 },
    },
    { name: 'every page again', before: { raw: 0, deflated: 0 }, after: { raw: 0, deflated: 0 } },
  ];
  const fonts = new LiveFonts();
  const distinct = new Map<string, number>();
  for (const round of rounds) {
    for (const [page, { pdf }] of whole) {
      add(round.before, { type: 'page', page, pdf });
      const split = separate.get(page)!;
      for (const font of split.fonts) distinct.set(font.id, font.data.length);
      for (const message of fonts.send(split.fonts)) add(round.after, message);
      const ids = split.fonts.map((font) => font.id);
      add(round.after, { type: 'page', page, pdf: split.pdf, fonts: ids });
    }
  }
  const fontBytes = [...distinct.values()].reduce((sum, size) => sum + size, 0);
  console.log(`${path}: ${whole.size} pages, ${distinct.size} fonts (${kb(fontBytes)})`);
  for (const [page, { pdf }] of whole) {
    const split = separate.get(page)!;
    console.log(
      `  page ${page}: ${kb(pdf.length)} with fonts, ${kb(split.pdf.length)} without (${split.fonts.length} fonts)`,
    );
  }
  for (const { name, before, after } of rounds) {
    console.log(
      `  ${name}: ${kb(before.raw)} -> ${kb(after.raw)} (${cut(before.raw, after.raw)} less); ` +
        `deflated ${kb(before.deflated)} -> ${kb(after.deflated)} (${cut(before.deflated, after.deflated)} less)`,
    );
  }
}
