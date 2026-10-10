// Shared DOM helpers for tests that drive the full <App />.
import { screen } from "@testing-library/react";

// The deck card is a `role="region"` landmark named "Deck <id>", so its hidden
// file input is one query away — no DOM-walking needed, and the settings
// importer (an earlier file input in DOM order) can't be grabbed by mistake.
export function deckFileInput(id) {
  return screen
    .getByRole("region", { name: new RegExp(`^Deck ${id}`) })
    .querySelector('input[type="file"]');
}
