---
name: Feature request
about: Pitch a new feature. Please read the constraints below first.
title: "[feature] "
labels: enhancement
---

### What problem are you solving?

<!-- Describe the user need, not the implementation. -->

### How does this respect WAVECRAFT's hard constraints?

<!-- Required. Confirm explicitly: -->

- [ ] **No network calls at runtime.** This feature does not introduce `fetch`, `XHR`, `WebSocket`, or any outbound socket.
- [ ] **No audio persistence.** User-loaded audio is not written to disk / `localStorage` / IndexedDB / OPFS / the Cache API.
- [ ] **No telemetry.** No analytics / error reporting / remote logging added.

If you ticked all three, great. If you can't tick one, explain why the trade
-off is worth breaking a constraint that the entire project is built around.

### Sketch of the UX

<!-- Wireframe, screen description, or rough flow. Don't worry about pixels. -->

### Complexity estimate

<!-- Rough guess: small (a day), medium (a week), large (multi-week). -->

### Relevant prior art / references (optional)

<!-- Existing DJ apps, audio research, related GitHub issues, etc. -->

### Open questions

<!-- Things you're not sure about that you'd want feedback on. -->
