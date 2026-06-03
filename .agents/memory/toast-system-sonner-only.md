---
name: Toast system — only sonner is mounted
description: Two toast systems coexist in the frontend; only sonner's Toaster is rendered, so shadcn useToast silently swallows all notifications.
---

# Only sonner toasts render

The frontend ships TWO toast systems but mounts only ONE `<Toaster/>`:
- **sonner** — its `<Toaster/>` IS mounted in `App.js`. This is the app-wide standard.
- **shadcn `useToast`** (`../hooks/use-toast`) — its `<Toaster/>` is mounted NOWHERE.

**Symptom:** any page importing `useToast` and calling `toast({ title, description, variant })`
produces NO visible notification — every toast (including validation errors) is silently swallowed.
Users perceive this as "the button does nothing / no message at all."

**Rule:** never use shadcn `useToast` in this codebase. Always use sonner:
- `import { toast } from 'sonner';`
- success → `toast.success('msg')` or `toast.success('msg', { description })`
- error (was `variant: 'destructive'`) → `toast.error('msg')`

**Why:** the shadcn Toaster was never wired up; adding it would duplicate the toast UI.
sonner is already global, so migrating offending pages to sonner is the correct fix.

**How to apply:** when a page's buttons "do nothing" with no feedback, first
`rg "hooks/use-toast"` — any match is a latent silent-failure bug. After migrating,
remove the `const { toast } = useToast()` line and drop `toast` from any useCallback
dep arrays (sonner's `toast` is a stable module import).

Migrated so far: DailyVideosPage, LoyaltyPage, AdvertisementsPage.
