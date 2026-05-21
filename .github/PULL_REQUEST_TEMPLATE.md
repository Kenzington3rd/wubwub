<!-- Thanks for contributing! Please run through this checklist. -->

## Summary

<!-- One paragraph: what changes and why. -->

## Checklist

- [ ] Tests added / updated and `npm test` is green locally.
- [ ] Tests are tagged with the relevant `@us USxx` user-story id (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).
- [ ] **No network calls introduced** (`fetch`, `XHR`, `WebSocket`, `sendBeacon`, RTCPeerConnection, EventSource, …).
- [ ] **No audio persistence introduced** (audio is not written to `localStorage`, IndexedDB, OPFS, the Cache API, or cookies).
- [ ] All AudioParam changes use `setTargetAtTime` / scheduled ramps (no `setTimeout` for audio).
- [ ] `npm run size` is green (bundle-size budget not exceeded — or budget raised deliberately with justification below).
- [ ] `npm run build` and `npm run build:single` both succeed.
- [ ] Docs updated (`CLAUDE.md`, `README.md`, `docs/USER_STORIES.md`, etc.) if behavior changed.

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Documentation
- [ ] Build / tooling / CI

## Screenshots or recordings (optional)

<!-- Drag in images / GIFs / audio for UX-visible changes. -->

## Bundle-size impact

<!-- Paste the `npm run size` output if your change affects bundle size. -->

## Anything else reviewers should know?

<!-- Tradeoffs, follow-ups, known limitations. -->
