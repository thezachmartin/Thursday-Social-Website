# Thursday Social website

The static site is deployed with GitHub Pages. The subscriber signup is at `/`,
and the authenticated SMS broadcast portal is at `/admin/`.

## Admin frontend configuration

Public browser configuration lives in `config.js`:

- AWS region: `us-east-1`
- Cognito user pool: `us-east-1_MgIIQ8dKB`
- Cognito web client: `7g5h92qh2k10tv7edrnsqlk50n`
- Active count:
  `GET https://gacse1myqa.execute-api.us-east-1.amazonaws.com/prod/admin/active-count`
- Broadcast submission:
  `POST https://gacse1myqa.execute-api.us-east-1.amazonaws.com/prod/admin/sendMessages`
- Job progress:
  `GET https://gacse1myqa.execute-api.us-east-1.amazonaws.com/prod/admin/jobs/{jobId}`
- Send-enabled host allowlist: `thezachmartin.github.io` over HTTPS

These identifiers and HTTPS endpoints are safe frontend configuration. Do not add
AWS IAM credentials, Cognito client secrets, Twilio credentials, or other secrets
to this repository.

## Admin workflow

Administrators sign in through Cognito `USER_SRP_AUTH`. The portal restores the
Cognito session from session storage, requires membership in the `admins` group,
and sends the Cognito ID token in every admin API request.

The composer preserves the entered text exactly and accepts only GSM-7 content
that fits in one segment. It refreshes the active subscriber count and displays
the recipient count, septets, segments, total segments, and estimated maximum
cost. A separate final dialog displays the exact message and requires an explicit
confirmation before any submission occurs.

Only explicitly allowlisted HTTPS production hosts can confirm and submit.
Localhost, `file://`, LAN, test, and staging previews can validate and estimate
messages, but cannot send a production broadcast.

Confirmed submissions use a browser-generated, cryptographically random
idempotency key. A retry of the same uncertain request reuses its key; editing the
message or intentionally beginning another broadcast creates a new key. The
current job ID is stored locally so polling resumes after a refresh. Completed or
failed results remain until the administrator dismisses them or confirms another
broadcast.

Run `npm test` for the mocked admin integration tests. Tests use only local mock
URLs and never call the production broadcast endpoint.
