---
name: Invoices page duplicate tables
description: Which component actually renders the /invoices list — two lookalike implementations exist
---
The `/invoices` route renders `pages/InvoicesPage.js` (self-contained tabs: invoices / credit notes / registration forms). The lookalike `pages/invoices/` folder (`InvoiceList.js`, `components/InvoicesTable.jsx`, dialogs, printUtils) is a parallel implementation — `printUtils.js` and dialogs ARE reused elsewhere, but the list table in that folder is NOT what the invoices page shows.

**Why:** Edited `pages/invoices/components/InvoicesTable.jsx` to add a time column; build succeeded but the user saw no change because the live page is `pages/InvoicesPage.js`.

**How to apply:** For any invoices-list UI change, edit `pages/InvoicesPage.js`; check `App.js` routing before assuming a folder component is live. Verify built chunks contain the new data-testid.
