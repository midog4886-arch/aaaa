---
name: Invoice notice branding and media boundaries
description: Tenant identity and receipt details during delayed automatic invoice delivery
---

Automatic invoice receipts must resolve legal branding for the actual tenant, including delayed worker delivery. Never use the default academy's tax number or commercial registration for another tenant.

**Why:** Worker tenant context can contain only routing identity, not full branding. Treating missing fields as default-company values misidentifies the receipt issuer.

**How to apply:** Hydrate tenant branding before rendering. Keep Whatsflow receipts to one image message with clickable app/portal/branch-group links in its caption; preserve invoice identity and paid total when shortening captions, with full purchased schedule details in the image. Never resend old receipts simply to update their content.