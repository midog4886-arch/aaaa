---
name: Frontend jest setup quirks
description: How to make craco test (CRA5/jest 27) work in this repo
---

`craco test` needs the jest section in `frontend/craco.config.js` (webpack untouched):
- `resetMocks: false` — CRA defaults it to true, which strips mock implementations between tests; lazily-created Proxy API mocks silently return undefined in test 2+.
- moduleNameMapper for packages using package-`exports` subpaths jest 27 can't resolve: `react-router/dom`, `react-router`, `@radix-ui/primitive/is-development`, plus the `@/` alias.
- `src/setupTests.js` polyfills TextEncoder/TextDecoder (react-router v7), matchMedia, observers, pointer capture.

Component-test gotchas:
- Radix portal Dialog does NOT mount under jsdom in this app — mock `components/ui/dialog` with a plain `open ? <div role="dialog"> : null` stand-in (add a close button wired to onOpenChange).
- `userEvent.setup({ pointerEventsCheck: 0 })` needed when a dialog overlay would block clicks.
- Tab labels like `invoices ({n})` are split across text nodes — query by role+accessible-name regex, not getByText.
- Race-guard regression tests live in `frontend/src/pages/__tests__/MembersPage.race.test.js`; they were mutation-verified (removing the gen/active-member guards makes them fail).
