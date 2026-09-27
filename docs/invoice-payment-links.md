# Invoice payment links

The Invoices page provides a collapsible payment-link panel. Select pending subscription invoices, choose a validity of 1–30 days, and create a single capability link. Family invoices must share a normalized phone and branch. Customer data is not exposed by predictable invoice IDs.

Payment remains unavailable until a merchant gateway account is configured. The initial adapter is Moyasar hosted invoices; available card and wallet methods depend on the merchant's enabled account methods. Never paste secret credentials into chat or a public page.

Configure the server secret `MEMBER_MOYASAR_SECRET_DEFAULT` for the default academy. Other tenant slugs use `MEMBER_MOYASAR_SECRET_<UPPERCASE_SLUG_WITH_UNDERSCORES>`. Configure `PUBLIC_BASE_URL` as the verified HTTPS academy domain. Secrets stay in the server environment, never in frontend bundles or the public link response. Test using merchant test credentials before enabling a live key; no live payment has been attempted during implementation.

Reference: https://docs.moyasar.com/guides/invoices/creating-invoices and https://docs.moyasar.com/api/invoices/06-cancel-invoice.

The callback uses a random per-link capability and fetches the authoritative invoice from Moyasar with the server secret. It verifies provider invoice ID, SAR currency, exact minor-unit amount and academy-link metadata. Redirect parameters and callback bodies are never payment proof. Settlement claims are atomic; each child's original invoice uses the existing payment and subscription flow. Public receipts are rendered separately for each original invoice after payment.

Online checkout reserves invoices against other online checkouts and manual marking as paid. Cancel the provider invoice before releasing a reservation. A creation timeout or partial settlement moves the link to review and is never automatically retried or released. Review uncertain provider creations in the merchant dashboard, identify the actual provider invoice, and reconcile the durable record before clearing a reservation. Partial settlements require checking original invoices and subscription projections individually; do not run another charge.

Optional reminders run with existing daily checks and are disabled when no gateway is configured. They make at most two attempts, after one and three days, and stop on payment, expiry or cancellation. The WhatsApp branch must be connected. Unconfirmed delivery is recorded and not silently repeated by the scheduler. Manual sends record actor/time/outcome; opening a prepared message is not claimed as sent.
