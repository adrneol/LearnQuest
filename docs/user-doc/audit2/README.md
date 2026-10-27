# LearnQuest Audit Archive

This is the single archive index for audit reports in `docs/user-doc/audit2/`.

| Report | Date | Scope | Outcome |
|---|---|---|---|
| [13 — MongoDB TLS Recheck](13_LEARNQUEST_MONGODB_TLS_RECHECK_2026-10-28.md) | 2026-10-28 | Local MongoDB TLS connectivity, startup safety, tests/build, and live deployment recheck | `TLS_FAILURE` (`internal_error`) persisted at that time; root cause was external; no source code changed |
| [14 — MongoDB Startup Recovery](14_LEARNQUEST_MONGODB_STARTUP_RECOVERY_2026-10-28.md) | 2026-10-28 | Supervised startup/readiness/reconnect, fail-closed database routes, sanitized errors, Node runtime verification, tests/build, and production recheck | Local lifecycle fixes implemented and verified; `TLS_FAILURE` (`internal_error`) persisted at that time under Node 24.22.1 |
| [15 — Account Page and Email Pipeline Repair](15_LEARNQUEST_ACCOUNT_PAGE_AND_EMAIL_PIPELINE_REPAIR_2026-10-28.md) | 2026-10-28 | Account shell isolation, recovery notice scoping, live MongoDB recheck, complete Brevo delivery diagnosis, crypto/session audit, tests/builds, and live deployment recheck | Account header and recovery notice leaks fixed; MongoDB **CONNECTED** with a successful ping under Node 24.11.0 and 24.22.1; email blocked externally by Brevo HTTP 401 unauthorized source IP plus stale Render/Vercel deployments; no delivery claimed |
| [16 — Reset-Link Expiry and Public-Origin Fix](16_LEARNQUEST_RESET_LINK_EXPIRY_AND_ORIGIN_FIX_2026-10-28.md) | 2026-10-28 | Server-side reset-token expiry/atomic consumption verification, non-consuming link validation, single TTL source, production `APP_ORIGIN` validation, tests/builds, read-only MongoDB and live deployment checks | Expired link only rendered the form; server rejects 37-minute-old tokens while records remain; validation/expired/unavailable UI added; production origin now explicit, HTTPS-only, non-local, header-independent, and exact-origin enforced in the email builder; MongoDB check currently **TLS_FAILURE**; Render/Vercel remain stale and undeployed |

## Availability note

Report 12
(`12_LEARNQUEST_MONGODB_CONNECTIVITY_RECOVERY_2026-10-28.md`) and any earlier
version of this index were not present in the working tree or in Git history
when report 13 was produced. Report 13 therefore verifies the prior claims
directly against the current source code and diagnostic output rather than
quoting report 12.

No duplicate report or second archive index was created.
