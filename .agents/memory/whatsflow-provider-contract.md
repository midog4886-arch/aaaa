---
name: Whatsflow provider contract
description: Durable boundaries for the hosted Whatsflow API provider alongside Meta, WAHA, and legacy WhatsApp.
---

Treat `whatsflow` as an explicit provider, never as a WAHA URL or compatibility mode. Its `INSTANCE` is provisioned by Whatsflow and is used unchanged; the app can read connection state and request QR, but must not expose WAHA start, stop, restart, or logout controls.

**Why:** Whatsflow and WAHA have different session lifecycle and request contracts. Treating them as interchangeable can call destructive or nonexistent lifecycle routes and can bind the wrong branch.

**How to apply:** Store the Whatsflow instance and encrypted API key per branch. Match Webhooks against the exact tenant, branch, and instance. Use the shared atomic daily campaign quota for hosted-session providers, while keeping automated notifications outside that quota.

Whatsflow media sending accepts a direct URL or Base64 content, so locally uploaded campaign images and PDFs can be sent as Base64 without publishing a temporary unauthenticated file URL.

**Why:** A public temporary media URL adds unnecessary exposure and deployment-host assumptions.

**How to apply:** Validate type, signature, and size before encoding; permit only JPG, PNG, and PDF under the established campaign limits.

Automatic payment receipts should be a single private media message with a short caption, not a text followed by an independent image.

**Why:** A two-send sequence can deliver only the text and makes retries duplicate the payment confirmation. Server-side rendering also covers payments completed without an open browser.

**How to apply:** Render from the saved invoice values, not current subscription values. Do not call a generated payment receipt a compliant tax invoice without implementing its required tax fields and QR. Preserve other providers' existing template contracts.

Customer transactional WhatsApp notices should include Arabic and English together, rather than select only one language.

**Why:** The user requested both languages, explicitly including attendance confirmations.

**How to apply:** Include both languages when adding automatic notices and receipt labels. Preserve operator-authored campaign content and saved custom reminder text; build English transactional summaries from structured facts rather than guessing translations of names.

The manual “send reminders now” action requires a recipient preview and explicit confirmation; this does not disable the separately configured daily scheduler.

**Why:** The user needs to inspect subscription expiry and attended-session counts before authorizing a manual send.

**How to apply:** Bind confirmation to the previewed tenant, branch, recipient and subscription facts. Count attendance using the existing subscription-quota rules, not lifetime attendance. Never dispatch a fresh unrestricted audience after confirmation.

Phone-originated outgoing messages must be reflected in the inbox; receiving an outgoing echo is not an incoming unread notification.

**Why:** Staff answer on the linked phone and expect the web inbox to reflect that response. Delayed reply events must not hide newer customer messages, and outgoing pushName identifies the branch, not the customer.

**How to apply:** Preserve the customer's name, use message timestamps for reply ordering, and deduplicate by branch/provider/message ID, including the race where an echo arrives before the API send returns. Do not claim historical phone replies were imported when only new webhook events are supported.