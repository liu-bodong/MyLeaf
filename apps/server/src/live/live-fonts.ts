import type { LiveBinaryMessage, LiveServerMessage } from '@myleaf/api';
import type { LivePdfFont } from '@myleaf/live-preview';

/**
 * Font bytes a connection sends before it tells the browser to forget them
 * (`fonts-reset`). A document's fonts take a few hundred KB; every new set
 * of glyphs (a character typed for the first time) is a new font program.
 */
export const LIVE_FONT_BUDGET = 32 * 1024 * 1024;

/**
 * The font programs one connection has sent, so that each goes to the
 * browser once (see `LivePdfPageMessage.fonts`).
 */
export class LiveFonts {
  readonly #sent = new Set<string>();
  #bytes = 0;
  readonly #budget: number;

  constructor(budget = LIVE_FONT_BUDGET) {
    this.#budget = budget;
  }

  /**
   * The messages that make `fonts` available to the browser, in order:
   * those not sent yet, after a `fonts-reset` if they would go over the budget.
   */
  send(fonts: readonly LivePdfFont[]): (LiveBinaryMessage | LiveServerMessage)[] {
    let missing = fonts.filter((font) => !this.#sent.has(font.id));
    if (missing.length === 0) return [];
    const messages: (LiveBinaryMessage | LiveServerMessage)[] = [];
    const size = missing.reduce((sum, font) => sum + font.data.length, 0);
    if (this.#bytes > 0 && this.#bytes + size > this.#budget) {
      this.#sent.clear();
      this.#bytes = 0;
      messages.push({ type: 'fonts-reset' });
      // All of the page's fonts are sent again.
      missing = [...fonts];
    }
    for (const font of missing) {
      if (this.#sent.has(font.id)) continue;
      this.#sent.add(font.id);
      this.#bytes += font.data.length;
      messages.push({ type: 'font', id: font.id, data: font.data });
    }
    return messages;
  }
}
