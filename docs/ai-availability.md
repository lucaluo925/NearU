# AI availability and manual review

Flyer extraction and submission moderation use DeepSeek Flash with the server-only `DEEPSEEK_API_KEY`.
The existing Anthropic SDK is a wire-format client only: requests are pinned to
`https://api.deepseek.com/anthropic` with `model: deepseek-flash`, thinking disabled,
and `authToken: null`. No request is sent to Anthropic and legacy Anthropic keys
cannot enable these features.

Official references verified on 2026-11-04:
- https://api-docs.deepseek.com/guides/vision/
- https://api-docs.deepseek.com/guides/anthropic_api/
- https://api-docs.deepseek.com/quick_start/pricing/
A Claude web/Code subscription is not an API credential. Do not copy subscription
session tokens into the application or automatically switch to an unapproved vendor.

## Failure contract

- Missing credentials, provider errors, timeouts, truncated output and invalid
  verdicts are unavailable checks, never successful safety checks.
- Moderation returns `status: unavailable`, null safety/confidence/risk/category
  values and an explicit manual-review reason. The existing submission API stores
  a null risk and keeps the listing pending; an administrator must approve it.
- Existing rows with the old unavailable reason and a numeric risk are displayed
  as incomplete checks, not low-risk verdicts. Their stored values are not rewritten.
- Flyer failures return HTTP 503 and `code: AI_UNAVAILABLE`; clients retain their
  entered fields and offer manual entry. Upload and submission remain independent.
- Provider requests use an 8-second SDK timeout and no automatic retries. Auth,
  body-size and per-user rate limits still apply. Provider error bodies are not logged.
- Set `AI_FEATURES_ENABLED=false` in the intended deployment environment to disable
  both model calls without disabling manual submissions. Redeploy for env changes.

No database migration is needed: the existing risk_score column is nullable.
The completion discriminator is internal; persisted null risk + explicit reason
carry the unavailable state through the existing schema.

## DeepSeek activation

In Vercel project Settings → Environment Variables, add `DEEPSEEK_API_KEY` as
a server-only sensitive variable in the intended environment, using a key from
your DeepSeek account. Do not put it in chat, a NEXT_PUBLIC variable, source code
or a PR. Confirm existing credits before enabling requests; this patch does not
add funds or enable recurring payments. Redeploy after configuring the key.
For preview verification, also configure a separate test Supabase environment.
User-submitted text and images are sent to DeepSeek when the feature is used.

## Recovery options

| Option | Cost and prerequisites | Operational behavior |
| --- | --- | --- |
| Keep manual entry/review | No model usage charges; requires review capacity | Reliable default when credentials or credits are unavailable |
| Enable DeepSeek Flash | Configure DEEPSEEK_API_KEY and verify existing balance; funds require owner action | Both endpoints now target the official DeepSeek API; live tests still required |
| Reuse another authorized provider | Requires an actual API credential/budget, vision support for flyers and review of data handling | Add an explicit adapter and validate both schemas; do not assume chat subscriptions include API access |

The provider is migrated to DeepSeek. No credential or billing changes are included.

## Validation and rollout

1. Run `node --test tests/ai-fallback.test.cjs` (mocked SDK and DB; no paid calls),
   `npx tsc --noEmit`, and lint the modified TS/TSX files.
2. Build with the target environment's Supabase public configuration. A build with
   placeholders checks packaging only, not connectivity or authentication.
3. Verify the production deployment's commit and configuration separately from the
   current project env list: changing project variables does not change old deployments.
4. In a preview with test accounts, disable AI and upload a flyer; confirm the manual
   entry message and retained form values. Submit a disposable listing to a test DB;
   confirm pending status, null risk and the manual-review badge. Do not seed test
   content into production.
5. After approved credentials are available, test valid extraction and moderation,
   and confirm failed calls never create an approved listing. Promote only the verified
   deployment, and keep the previous deployment available for rollback.

All 11 tests pass, including real SDK requests with a mocked transport for DeepSeek URL, credential isolation and base64/URL images. Tests also cover missing keys, the kill switch, provider failures, malformed/truncated
output, valid zero scores, high-risk flags, endpoint guards, the flyer response
contract, and pending submission persistence during a provider outage.
