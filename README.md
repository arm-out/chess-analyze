# Chess.com to Lichess Import

Chrome extension that detects supported Chess.com game pages and imports the current game into Lichess with one click.

## How it works

1. On a Chess.com game page, the content script watches for the Share button.
2. When the button is available, the extension badge shows `PGN`.
3. Clicking the extension action opens the Share modal, switches to the PGN tab, reads the PGN text directly from the page, and opens a relay page.
4. The relay page submits the PGN to `https://lichess.org/import`, which redirects to the imported Lichess game.

This avoids using the clipboard, avoids requiring a Lichess API token, and avoids matching the game through Chess.com's monthly archive API.

## Load the extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder.

## Notes

- The extension is currently scoped to Chess.com game pages.
- Lichess imports created through this flow are public, matching the normal import page behavior.