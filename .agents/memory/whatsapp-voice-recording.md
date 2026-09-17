---
name: WhatsApp voice recording
description: Browser recording format and safe voice delivery boundaries.
---

Treat browser MediaRecorder WebM as a streaming container: it can contain valid Opus audio while ffprobe reports no source duration. Decode into bounded local OGG/Opus, then validate the decoded duration, allowing small codec padding at the advertised time limit. Normalize to mono and use provider-required Opus MIME metadata.

**Why:** Checking only source format.duration rejects genuine browser recordings; exact post-conversion duration checks also reject recordings at the advertised limit because Opus adds padding. WhatsApp providers have stricter voice-note contracts than generic file uploads.

**How to apply:** Keep conversion tools in deployment dependencies, disallow network protocols in uploaded containers, bound processing time and output size, and retain real streaming-WebM fixtures. Use Whatsflow's dedicated voice-note endpoint rather than image/document sendMedia. A preview or recording stop never authorizes sending; only the explicit send action does. Never automatically retry an uncertain provider outcome or clear needs-reply without accepted human-reply evidence.