import { drawText, measure, wrap } from './font.ts';
import { Raster } from './png.ts';

/**
 * The share card for a changelog entry.
 *
 * A link to a release is often pasted somewhere that shows a preview, and a preview that shows
 * the product's homepage screenshot tells the reader nothing about what was released. This card
 * shows the release itself: its title, its date, what it says, and where it lives.
 *
 * It is drawn here, on the API, with no browser and no image library — the same constraint the
 * site's other share image follows.
 */

const COLOUR = {
  background: Raster.rgb('#0b0c0b'),
  grid: Raster.rgb('#151715'),
  panel: Raster.rgb('#151715'),
  text: Raster.rgb('#f2efe6'),
  muted: Raster.rgb('#a9a9a0'),
  accent: Raster.rgb('#ff5a1f'),
  ink: Raster.rgb('#1a1b18'),
  cream: Raster.rgb('#f2efe6'),
} as const;

const WIDTH = 1200;
const HEIGHT = 630;
const MARGIN = 72;
const CONTENT = WIDTH - MARGIN * 2;

/** What a card needs to know about a release. */
export interface CardRelease {
  slug: string;
  title: string;
  summary: string;
  /** The date the reader sees. A release without one shows the day the card was drawn. */
  releaseDate?: string | null;
  categories?: string[];
}

/** Typographic characters the bitmap font does not have, folded into ones it does. */
function normalise(text: string): string {
  return text
    .replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/·/g, '-')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7e]/g, '');
}

/** "2026-10-29" as "29 OCTOBER 2026". */
export function formatReleaseDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  return `${parsed.getUTCDate()} ${months[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

/** The Intake mark: a dot and two bars, the same shape the site uses. */
function drawMark(raster: Raster, x: number, y: number, size: number): void {
  const unit = size / 64;
  raster.rounded(x, y, size, size, 16 * unit, COLOUR.panel);
  raster.circle(x + 32 * unit, y + 19 * unit, 7 * unit, COLOUR.accent);
  raster.rounded(x + 18 * unit, y + 32 * unit, 28 * unit, 7 * unit, 3.5 * unit, COLOUR.text);
  raster.rounded(x + 18 * unit, y + 44 * unit, 18 * unit, 7 * unit, 3.5 * unit, Raster.rgb('#6f6f68'));
}

/** A faint grid, the way the product's own card carries one. */
function drawGrid(raster: Raster): void {
  for (let x = 0; x < WIDTH; x += 48) raster.fill(x, 0, 1, HEIGHT, COLOUR.grid);
  for (let y = 0; y < HEIGHT; y += 48) raster.fill(0, y, WIDTH, 1, COLOUR.grid);
}

/**
 * The card.
 *
 * The title is the headline and is never truncated: a card that hides the title of the release
 * it is a card for is worse than no card. The summary below it is shortened to fit, and says so
 * with an ellipsis when it is.
 */
export function renderChangelogCard(release: CardRelease): Buffer {
  const raster = new Raster(WIDTH, HEIGHT);
  raster.fill(0, 0, WIDTH, HEIGHT, COLOUR.background);
  drawGrid(raster);

  // Header: the mark, the product, and the date.
  drawMark(raster, MARGIN, 56, 46);
  drawText(raster, 'INTAKE', MARGIN + 66, 64, 3, COLOUR.text, { spacing: 2 });
  const intakeWidth = measure('INTAKE', 3, 2);
  drawText(raster, 'CHANGELOG', MARGIN + 66 + intakeWidth + 24, 64, 3, COLOUR.accent, { spacing: 2 });

  const date = formatReleaseDate(release.releaseDate ?? new Date().toISOString().slice(0, 10));
  drawText(raster, date, WIDTH - MARGIN - measure(date, 3, 2), 64, 3, COLOUR.muted, { spacing: 2 });

  // The title, in the largest size that still fits three lines.
  const title = normalise(release.title);
  const titleLines = wrap(title, CONTENT, 6, 1).slice(0, 3);
  const titleTop = 156;
  titleLines.forEach((line, index) => {
    drawText(raster, line, MARGIN, titleTop + index * 54, 6, COLOUR.text, { spacing: 1, bold: true });
  });

  // A rule, then the release's own words in a cream panel.
  const ruleY = titleTop + (titleLines.length - 1) * 54 + 42 + 36;
  raster.fill(MARGIN, ruleY, CONTENT, 2, Raster.rgb('#2a2c28'));

  const summary = normalise(release.summary);
  const summaryLines = wrap(summary, CONTENT - 96, 3, 1);
  const shown = summaryLines.slice(0, 3);
  if (summaryLines.length > shown.length) {
    const last = shown[shown.length - 1] ?? '';
    shown[shown.length - 1] = `${last.replace(/[ ,.]+$/, '')}...`;
  }

  const panelTop = ruleY + 32;
  const panelHeight = 40 + shown.length * 33 + 36;
  raster.rounded(MARGIN, panelTop, CONTENT, panelHeight, 18, COLOUR.cream);

  let textY = panelTop + 34;
  for (const line of shown) {
    drawText(raster, line, MARGIN + 48, textY, 3, COLOUR.ink, { spacing: 1 });
    textY += 33;
  }

  // The footer: what kind of release it is, and where it lives.
  const category = (release.categories?.[0] ?? 'release').toUpperCase();
  const address = `intake.app/changelog/${release.slug}`;
  // The footer sits at the foot of the card, so the space between the panel and it is breathing
  // room rather than a hole.
  const footerY = HEIGHT - 58;
  drawText(raster, category, MARGIN, footerY, 2, COLOUR.accent, { spacing: 2 });
  drawText(raster, address, WIDTH - MARGIN - measure(address, 2, 1), footerY, 2, COLOUR.muted, { spacing: 1 });

  return raster.toPNG();
}

/**
 * The card for the changelog itself: the newest release, which is what a reader of the index
 * is about to click.
 */
export function renderChangelogIndexCard(releases: CardRelease[]): Buffer {
  const newest = releases[0];
  if (!newest) return renderChangelogCard({
    slug: 'changelog',
    title: 'The Intake changelog',
    summary: 'Every release Intake has shipped, each with its own permanent page.',
    releaseDate: new Date().toISOString().slice(0, 10),
    categories: ['changelog'],
  });
  const raster = new Raster(WIDTH, HEIGHT);
  raster.fill(0, 0, WIDTH, HEIGHT, COLOUR.background);
  drawGrid(raster);

  drawMark(raster, MARGIN, 56, 46);
  drawText(raster, 'INTAKE', MARGIN + 66, 64, 3, COLOUR.text, { spacing: 2 });
  const intakeWidth = measure('INTAKE', 3, 2);
  drawText(raster, 'CHANGELOG', MARGIN + 66 + intakeWidth + 24, 64, 3, COLOUR.accent, { spacing: 2 });

  drawText(raster, 'What shipped, and when.', MARGIN, 170, 6, COLOUR.text, { spacing: 1, bold: true });
  drawText(raster, 'Every release has a page of its own.', MARGIN, 240, 3, COLOUR.muted, { spacing: 1 });

  const panelTop = 310;
  const panelHeight = 200;
  raster.rounded(MARGIN, panelTop, CONTENT, panelHeight, 18, COLOUR.cream);

  const newestLines = wrap(normalise(newest.summary), CONTENT - 96, 3, 1).slice(0, 3);
  let textY = panelTop + 34;
  drawText(raster, `LATEST - ${normalise(newest.title).toUpperCase()}`, MARGIN + 48, textY, 2, Raster.rgb('#b4541f'), { spacing: 2 });
  textY += 40;
  for (const line of newestLines) {
    drawText(raster, line, MARGIN + 48, textY, 3, COLOUR.ink, { spacing: 1 });
    textY += 33;
  }

  drawText(raster, 'intake.app/changelog', MARGIN, HEIGHT - 58, 2, COLOUR.muted, { spacing: 1 });

  return raster.toPNG();
}
