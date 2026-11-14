# Suku brand guide

The identity for Suku, a lightweight TypeScript backend framework. This folder holds the source
SVGs; `apps/docs/public/` holds the copies the documentation site serves.

## The name

"Suku" was picked for its sound, and it turns out to carry meanings that fit the framework. The
brand is built on two of them.

| Language          | Word          | Meaning                                    | How the brand uses it            |
| ----------------- | ------------- | ------------------------------------------ | -------------------------------- |
| Japanese          | 空く (_suku_) | to become uncrowded, to have room to spare | The main story and the tagline.  |
| Malay, Indonesian | _suku_        | a part; a quarter; a clan                  | The four-slot grid of the mark.  |
| Japanese          | 透く (_suku_) | to be see-through, to leave gaps           | Supporting: no hidden machinery. |
| Finnish           | _suku_        | family, kin                                | Not used.                        |

Suku has four concepts (routes, features, middlewares, services) and no runtime dependencies.
The point of the brand is what the framework leaves out.

## The mark

A two-by-two grid with three tiles placed and the fourth slot left empty.

- The grid is the "quarter" sense: four equal slots.
- The empty slot is the "room to spare" sense. It is the top-right slot, always.
- Two tiles are neutral and one, bottom-right, is terracotta.

Construction, on a 32 × 32 canvas:

- Each tile is 14 × 14 with a corner radius of 4.
- The gap between tiles is 2, and the margin around the grid is 1.
- Tiles sit at (1, 1), (1, 17) and (17, 17). The slot at (17, 1) stays empty.

The mark has no strokes and no detail smaller than a tile, so it holds at 16 px.

## The wordmark

Lowercase "suku", drawn for the logo rather than set in a font. Every letter is a single stroke
of weight 5 on an x-height of 20, with square ends and small, tight curves, so the letters have
the same blocky weight as the tiles. In the lockup the wordmark sits 10 units to the right of the
mark and shares its baseline with the bottom row of tiles.

Don't retype the wordmark in a font. Use the SVG.

## Files

| File                 | Use                                                 |
| -------------------- | --------------------------------------------------- |
| `suku-logo.svg`      | Mark and wordmark, for light backgrounds.           |
| `suku-logo-dark.svg` | Mark and wordmark, for dark backgrounds.            |
| `suku-mark.svg`      | Mark alone, for light backgrounds.                  |
| `suku-mark-dark.svg` | Mark alone, for dark backgrounds.                   |
| `favicon.svg`        | Mark alone; switches colours with the system theme. |

## Colour

| Name              | Hex       | Use                                                                                                         |
| ----------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| Terracotta        | `#C14F38` | The accent on light backgrounds: one tile, links, primary buttons. White text on it passes WCAG AA (4.7:1). |
| Terracotta, light | `#E2725B` | The accent on dark backgrounds. Ink text on it passes AA (about 6:1).                                       |
| Ink               | `#17140F` | Text and neutral tiles on light backgrounds; the dark page background.                                      |
| Paper             | `#FAF7F2` | The light page background; text and neutral tiles on dark backgrounds.                                      |
| Stone             | `#6B6258` | Secondary text on paper.                                                                                    |
| Sand              | `#A89F94` | Secondary text on ink.                                                                                      |
| Card, light       | `#F4EFE7` | Cards and panels on paper.                                                                                  |
| Card, dark        | `#1E1A15` | Cards and panels on ink.                                                                                    |

The neutrals are warm, never pure grey, black or white. Terracotta was chosen to sit apart from
the reds, greens and blues that most backend frameworks use. Use it sparingly: one accent tile,
one primary button per view, links. Most of any page should be ink, paper and empty space.

The documentation site sets these as Fumadocs theme variables in `apps/docs/src/styles/app.css`.

## Typography

- **Wordmark:** the drawn SVG only.
- **Headings and text:** a geometric sans. Geist is the first choice, Inter the second, and the
  system UI font the fallback. The documentation site uses the system UI stack and loads no web
  font, in keeping with a framework that ships no dependencies.
- **Code:** the system monospace stack; Geist Mono where a font can be chosen.
- Headings are semibold with tight tracking (about -0.02em). Body text is regular weight.
- Sentence case everywhere. No all-caps headings.

## Tagline and voice

**Tagline:** Room to spare.

**One-line description:** A lightweight TypeScript backend framework built from four ideas:
routes, features, middlewares and services.

Voice:

- Plain and specific. Say what a thing does and give the number: "four concepts", "zero runtime
  dependencies".
- No superlatives. Not "blazing fast", "powerful", "next-generation" or "revolutionary".
- Describe Suku on its own terms. Compare with another framework only when the comparison is
  measured and stated.
- Short sentences, with space around them. The writing should feel as uncrowded as the name.

## Usage

Do:

- Keep clear space around the logo of at least one tile width on every side.
- Use the light files on light backgrounds and the dark files on dark ones.
- Use the mark alone where space is tight: favicons, avatars, small badges.
- Keep the mark at 16 px or larger and the full logo at 20 px high or larger.

Don't:

- Fill the empty slot, or move it to another corner.
- Recolour the tiles, or make more than one tile terracotta.
- Rotate, stretch, outline or add shadows and gradients to the logo.
- Set the wordmark in a font, capitalise it in the logo, or change its spacing from the mark.
- Place the logo on a busy photograph or on a colour that is not ink, paper or one of the cards.
- Add a flame, an animal or any other second symbol.
