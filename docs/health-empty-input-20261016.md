# Empty Health input: 2026-10-16

Related: `mizuidekazuhiro/notion-diary-automation` Issues
[#330](https://github.com/mizuidekazuhiro/notion-diary-automation/issues/330),
[#331](https://github.com/mizuidekazuhiro/notion-diary-automation/issues/331),
[#332](https://github.com/mizuidekazuhiro/notion-diary-automation/issues/332).

At upstream main `7ec1b500b8f0ed87bdd2e3e004f36c7cdc187b1f`,
normalization maps missing/unparseable numeric input to null. Validation allows
optional fields to be absent. `upsertHealthDailyPage` can then create a page
with Date/Source only and return `ok: true`, or report an existing page as updated
without any measurement. A mocked request with only metadata and empty/invalid
sleep fields reproduced `action: created` and two Notion calls.

The change rejects requests without any finite numeric measurement or valid
sleep_start/sleep_end with HTTP 422 and `error_code=health_measurements_empty`,
before querying or writing Notion. Individual measurements remain optional.
Weight-only, nutrition-only, additional sleep metrics, sleep timestamps and
explicit numeric zero retain their existing behavior. Missing fields are never
filled or cleared. The response does not echo the submitted health values.

This prevents false successful Health writes; it does **not** restore measurements.
Production sender payloads, HTTP responses, deployed Worker version and environment
database IDs have not been inspected. It is not established that this route caused
the three production incidents. The separate supplement intake route can also
create a metadata-only Health page for relations; that behavior and existing
unmerged PR #16 are outside this fix.

Authentication for this endpoint uses `HEALTH_API_KEY`, not the downstream diary
Worker's `WORKERS_BEARER_TOKEN`. Source storage prefers `HEALTH_DB_ID`, falling
back to `DAILY_LOG_DB_ID`. Operators should check the actual sender URL, HTTP
response and Worker logs, then compare source/destination database settings.
The new warning log is `HEALTH_DAILY_NO_MEASUREMENTS` and includes only date and
reason code. A 200 response still does not guarantee all downstream major Health
fields or a usable target-date sleep candidate; weight-only updates are legitimate.

Validation (Node 24.19.0):

- Health tests: 19 passed, including four no-data shapes with zero Notion calls
  and five valid partial inputs through both create and update paths.
- Mocked actual HTTP handler smoke: empty input 422/no Notion calls, bad auth 401,
  valid input 200.
- Full upstream suite: 68 passed, 2 failed; main baseline: 54 passed, the same
  2 app-usage day-boundary tests failed. Those existing 03:00/04:00 expectation
  failures were not changed.
- Strict TypeScript check on this service: both main and modified code report the
  same existing `scalePercent` union-property error in `buildHealthPartialProps`.
  The check is not claimed as passing.
- Downstream Health/freshness/canary/sleep/quality/workflow-contract tests:
  39 passed, with downstream generation code unchanged.
- `git diff --check` passed.

No production requests, Notion writes, deployment, secret changes, mail resend,
warning suppression, historical-value filling, or automatic merge were performed.
After review and deployment, test using current actual measurements and inspect
the same-date Health page. Do not populate historical incidents using another
day's measurements.
