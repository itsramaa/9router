# Identity Rotation — Rate Limit Bypass Specs

## ADDED Requirements

### Requirement: MiMo Fingerprint Pool

Provider `mimo-free` MUST support pool of virtual fingerprints to distribute JWT identity across multiple upstream rate limit buckets.

#### Scenario: Single fingerprint fallback

- Given: All pool fingerprints exhausted
- When: New request arrives
- Then: Fallback to machine fingerprint, no error thrown

#### Scenario: Pool fingerprint rotation on 429

- Given: POOL_SIZE = 32 fingerprint pool initialized
- When: Upstream returns HTTP 429
- Then: Current fingerprint JWT invalidated, next fingerprint selected round-robin, request retried
- And: Log emitted at WARN level with fp=[...last8] identifier

#### Scenario: Pre-implementation test gate

- Given: 2 different fingerprint hashes sent to /bootstrap
- When: Both requests complete
- Then: MUST receive 2 different JWT tokens — if same JWT, scenario DROPPED

---

### Requirement: OpenCode Header Identity Pool

Provider `opencode` MUST rotate x-opencode-client and User-Agent headers per request.

#### Scenario: Round-robin header rotation

- Given: 8 CLIENT_VARIANTS and 5 USER_AGENTS defined
- When: Consecutive requests sent
- Then: x-opencode-client cycles through all 8 variants in order
- And: User-Agent cycles through all 5 values in order

#### Scenario: Single client header backward compat

- Given: Single connection, no pool configured
- When: Request sent
- Then: x-opencode-client desktop sent as original behavior

#### Scenario: Pre-implementation test gate

- Given: 8 requests sent with 8 different x-opencode-client values
- When: Rate limit hit on 1 client value
- Then: Other client values MUST still return 200 — if all rate limited simultaneously, scenario effectiveness REDUCED

---

### Requirement: Grok Web Cookie Pool

Provider `grok-web` MUST support inline multi-cookie pool parsed from credentials.apiKey field.

#### Scenario: Multi-cookie pool parsed from comma-separated input

- Given: apiKey = "abc123,def456,ghi789"
- When: Provider initialized
- Then: Pool of 3 cookies created, requests rotate round-robin

#### Scenario: Automatic rotation on 429

- Given: Cookie pool with 3 entries, cookie[0] active
- When: Upstream returns 429 for cookie[0]
- Then: cookie[0] marked cooldown 60 seconds, cookie[1] selected, request retried in same call

#### Scenario: All cookies in cooldown

- Given: All cookies in pool have active cooldown
- When: New request arrives
- Then: Error message includes pool size count

#### Scenario: Pre-implementation test gate

- Given: Cookie-A reaches 429 rate limit
- When: Same request sent with Cookie-B
- Then: Cookie-B MUST return 200 — if also 429, IP-based limit, effectiveness REDUCED

---

### Requirement: Perplexity Web Cookie Pool

Provider `perplexity-web` MUST support inline multi-cookie pool with unified auth flow.

#### Scenario: Bearer token path unchanged

- Given: credentials.accessToken present
- When: Request sent
- Then: Authorization Bearer token set, no cookie pool logic applied

#### Scenario: Multi-cookie rotation on 429

- Given: Pool of 3 cookies, cookie[0] active, 429 received
- When: Rotation triggered
- Then: cookie[0] cooldown 60s, cookie[1] selected, request retried

#### Scenario: Pre-implementation test gate

- Given: Token-A reaches 429
- When: Same request sent with Token-B
- Then: Token-B MUST return 200 — if also 429, IP-based limit, effectiveness REDUCED

---

### Requirement: Antigravity Per-Model Quota Rotation

Provider `antigravity` MUST attempt model rotation when a model quota is exhausted.

#### Scenario: Model rotation on quota exhaustion

- Given: gemini-2.5-pro quota exhausted (429 with quota error)
- When: Rotation enabled
- Then: Next model tried in priority order: gemini-2.5-flash, gemini-3-flash-preview, gemini-3.1-flash-lite-preview
- And: Log emitted with exhausted model name and next model name

#### Scenario: All models exhausted

- Given: All models in rotation pool have quota exhausted
- When: New request arrives
- Then: Standard account-level error returned

#### Scenario: Pre-implementation test gate

- Given: Model A quota exhausted for account X
- When: Same account sends request with Model B
- Then: Model B MUST return 200 — if also exhausted, per-account quota, scenario DROPPED

---

### Requirement: GitHub Copilot Header Rotation Conditional

Provider `github` MUST only rotate copilot-integration-id header if probe test confirms separate rate limit buckets. Implementation SHALL be skipped if test fails.

#### Scenario: Test probe for header bucket isolation

- Given: Request with copilot-integration-id vscode-chat rate limited
- When: Same request sent with copilot-integration-id jetbrains
- Then: IF 200 returned, implement header rotation
- And: IF 429 returned, scenario DROPPED, not implemented

#### Scenario: NO-GO branch

- Given: Probe test shows shared bucket
- When: Implementation decision made
- Then: Scenario dropped from roadmap, proposal updated with test result

---

### Requirement: NVIDIA Backoff Level Reset

Provider `nvidia` MUST prevent backoff escalation to account pause via level management.

#### Scenario: Escalation prevention via successful request

- Given: backoffLevel approaching ESCALATION_THRESHOLD 8
- When: Lightweight request succeeds
- Then: backoffLevel reset to 0, account NOT paused

#### Scenario: Multi-key rotation via existing fallback

- Given: N NVIDIA API keys registered as separate connections
- When: Key-A rate limited
- Then: filterAvailableAccounts plus runWithFallback auto-select Key-B
- And: Key-A backoffLevel independent from Key-B

---

### Requirement: Cloudflare Multi-AccountId Linear Scaling

Provider `cloudflare-ai` MUST support N connections with different accountId values for linear quota scaling.

#### Scenario: Multi-accountId rotation via existing fallback

- Given: N Cloudflare connections with different accountIds
- When: AccountId-A quota exhausted
- Then: runWithFallback auto-selects AccountId-B connection with no custom executor changes needed

#### Scenario: Single accountId backward compat

- Given: 1 Cloudflare connection
- When: Request sent
- Then: URL resolved to accounts/accountId-A/ai/v1 as before

---

### Requirement: Blackbox 403 Cooldown Classification

Provider `blackbox` error handling MUST correctly classify 403 responses based on error body text.

#### Scenario: 403 without bad-credentials text

- Given: Blackbox returns HTTP 403, body does NOT contain bad-credentials
- When: classifyError processes response
- Then: Cooldown = 2 minutes, account resumes after 2 minutes

#### Scenario: 403 with bad-credentials text

- Given: Blackbox returns HTTP 403, body contains bad-credentials
- When: classifyError processes response
- Then: Cooldown = 1 hour

#### Scenario: Multi-key pool automatic rotation

- Given: N Blackbox API keys registered
- When: Key-A gets 403 with 2min cooldown
- Then: Key-B immediately selected, Key-A available again after 2 minutes

---

### Requirement: HTTP2 Burst Conditional

Universal rate counter bypass via HTTP/2 single-packet attack MUST only be implemented for providers confirmed to use non-atomic counters. Implementation SHALL be skipped for providers with WAF or atomic counters.

#### Scenario: Non-atomic counter provider confirmed

- Given: Provider confirmed to use non-atomic check-then-increment counter
- When: 20 requests sent in single TCP segment via HTTP/2
- Then: More than rate_limit_per_window responses return 200

#### Scenario: NO-GO for WAF providers

- Given: OpenAI or Anthropic as target
- Then: HTTP/2 burst NOT attempted, scenario permanently DROPPED for these providers

#### Scenario: Pre-implementation test gate

- Given: Burst of 20 requests sent
- When: Responses received
- Then: IF N > documented RPM limit succeed, counter bypass WORKS
- And: IF only rate_limit responses succeed, atomic counter confirmed, scenario DROPPED
