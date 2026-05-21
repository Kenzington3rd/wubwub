# Security & privacy

WAVECRAFT runs entirely in your browser. There is no backend, no analytics
endpoint, no remote logging, no CDN dependency at runtime, no account, no
subscription. The security story for this project is the local-only promise
itself: **nothing leaves your device.**

## Threat model

The thing we care about protecting is the **audio you load into the app**.
That audio is yours. We do not want it transmitted, persisted to disk
without your consent, or leaked to a third party — and we don't want a future
contributor or compromised dependency to be able to do that either.

In concrete terms:

- **No outbound network calls at runtime.** No `fetch`, no `XHR`, no
  `WebSocket`, no `sendBeacon`, no RTCPeerConnection. Enforced in code review
  via [`CONTRIBUTING.md`](CONTRIBUTING.md) and by `connect-src 'none'` in the
  Content-Security-Policy meta tag (declared in `index.html` and re-injected
  at build time by a `transformIndexHtml` hook in `vite.config.js`).
- **No persistence of user audio.** Decoded audio lives in `AudioBuffer` /
  `ArrayBuffer` objects in memory. It is **never** written to `localStorage`,
  IndexedDB, OPFS, the Cache API, or cookies. The settings export / import
  feature serializes configuration only (themes, MIDI maps, crossfade curve)
  and explicitly excludes audio.
- **No telemetry.** No analytics package, no error reporting service, no
  feature-flag service. If something breaks, you see it locally — the bug
  doesn't fly to a server.
- **CSP defense-in-depth.** The CSP forbids the dangerous APIs even if a
  future regression accidentally re-introduces them.
- **PWA precache stays local.** The Workbox config has `runtimeCaching: []`
  and never falls through to the network.

## Reporting a privacy concern

If you find anything that looks like it violates the above — a stray `fetch`,
an opaque dependency that phones home, a CSP that has been weakened, audio
data showing up in a serialized payload, anything — please:

1. Open a **GitHub Issue** on the repo and tag it `security`.
2. Include what you observed, the file path / line, and (if you have it) a
   minimal repro. A failing test is gold.

We treat `security`-tagged issues as priority work. There is no mailing list,
no PGP key, no security@ alias — the project is small enough that a public
issue is the simplest and fastest channel. If you'd prefer to disclose
privately for a particularly sensitive finding, contact the maintainer
directly via the GitHub profile listed on the repo.

## What this isn't

This document is not a promise that WAVECRAFT is immune to general web
vulnerabilities (XSS via a malicious dependency, browser bugs, OS-level
attacks). It is a statement about the design constraints the project chose
and the architectural decisions that back them up. If you find an actual
exploit — XSS, prototype pollution, CSP bypass, a way to exfiltrate audio
that we missed — please report it the same way (Issue tagged `security`).
