# Release A Smoke Harness

`scripts/release-a-smoke.mjs` is the durable Release A end-to-end API regression smoke harness. It replaces the prior temporary `/private/tmp/blabber-release-a-smoke.mjs` runner and must remain tracked in this repository.

## Purpose And Scope

The harness verifies the Release A feature surface through the Docker gateway/API with isolated throwaway test data. It is intended for local Release B Foundation acceptance and future regression checks before user-facing batches.

Run it only against an obvious local development gateway unless a future production-safe smoke policy is designed.

## Required Stack

Start the full Docker stack first:

```sh
docker compose -f docker-compose.full.yml up -d --build
```

Confirm:

```sh
docker compose -f docker-compose.full.yml ps
curl http://localhost:3000/healthz
curl http://localhost:3000/readyz
```

## Command

```sh
pnpm smoke:release-a
```

Optional environment variables:

- `SMOKE_GATEWAY_URL`: gateway URL, default `http://localhost:3000`.
- `SMOKE_CLEANUP=true|false`: documents cleanup intent. There is no account-delete endpoint, so smoke users/chats are isolated by unique run IDs instead of broadly deleted.
- `SMOKE_VERBOSE=true|false`: prints safe request method/path/status lines.
- `SMOKE_ALLOW_UNSAFE_TARGET=true`: bypasses the local-target guard. Do not use for production.

## Output

The runner prints one `PASS` or `FAIL` line per named case and a final total such as:

```text
Release A smoke complete: 74 passed, 0 failed (12.3s)
```

Any failed assertion exits non-zero.

## No-Secrets Logging Policy

The harness must not print raw credentials, access tokens, refresh cookies, raw invite URLs, invite tokens, push endpoints, full private message bodies, private AI content, or private Action content. Failure output is limited to safe case names, HTTP status, route shape with sensitive path tokens redacted, and safe error/message fields.

## 74-Case Coverage

1. Gateway liveness is healthy.
2. Gateway readiness is healthy.
3. Authenticated registration/login flow works for A.
4. Authenticated registration/login flow works for B.
5. Authenticated registration/login flow works for outsider D.
6. Unauthorized protected API request is rejected safely.
7. Create direct chat.
8. Create group chat.
9. Send text message in direct chat.
10. Send text message in group chat.
11. Chat-scoped search finds authorized direct-chat message.
12. Global search finds authorized group message.
13. Outsider cannot search private direct-chat content.
14. Outsider cannot search inaccessible group content.
15. Reply to same-chat message succeeds.
16. Reply response includes safe original-message metadata.
17. Cross-chat reply target is rejected.
18. Forward text message to authorized destination succeeds.
19. Forwarded message is marked forwarded.
20. Forwarded payload does not expose original source chat/sender metadata.
21. Group @mention of B by A succeeds.
22. Structured mention metadata contains only valid current group participant data.
23. B receives a mention-unread signal.
24. Direct-chat mention metadata is rejected.
25. Forwarded message does not retain original mention metadata.
26. Group admin/owner can pin a message.
27. Pin list returns the pinned message to authorized group member.
28. Standard group member cannot pin message.
29. Standard group member cannot unpin admin-owned pin without permission.
30. User B can save an authorized message.
31. B can retrieve own saved message.
32. A cannot query B's saved-message records.
33. B can archive a chat.
34. Archived chat is hidden from B's default chat list.
35. Archived chat appears in B's archived list.
36. New message in archived chat auto-unarchives it for B.
37. Archive state remains private and does not hide the chat for A.
38. Authorized user can retrieve Shared Links.
39. Authorized user can retrieve Shared Documents when a document message exists.
40. Authorized user can retrieve Shared Media when an image message exists.
41. Shared Content response includes valid safe Source Jump identifiers.
42. Outsider/non-member is denied Shared Content.
43. Unsafe URL scheme is excluded or non-openable in Shared Links.
44. Group owner/admin can create an invite link.
45. Regular member cannot create/manage invite link.
46. Invite creation response provides the raw token only in the one-time authorized creation result.
47. Invite storage/API normal list payload does not expose raw token.
48. Authenticated user E can preview valid invite safely.
49. Preview does not expose member list or chat history.
50. Authenticated E can join through invite.
51. Joined E becomes standard member, not admin/owner.
52. Already-member join does not consume additional invite use.
53. Regenerating invite revokes earlier invite.
54. Revoked/expired/exhausted invite fails safely.
55. Create valid single-choice poll.
56. Create valid multiple-choice poll.
57. Reject empty or normalized-duplicate options.
58. Single-choice poll rejects multiple selected options.
59. Multiple-choice poll accepts multiple selected options.
60. Vote change is rejected when disabled.
61. Vote change succeeds when enabled.
62. Anonymous poll does not expose voter identities.
63. Poll creator can close poll and non-creator cannot.
64. Closed poll rejects vote and forwarded Poll has independent zero-vote state.
65. Create valid Event with valid IANA timezone.
66. Invalid timezone, invalid temporal range, or unsafe meeting URL is rejected.
67. Authorized B RSVP Going succeeds.
68. Authorized C RSVP Maybe succeeds.
69. Non-member RSVP is rejected.
70. Event creator can edit/cancel while non-creator cannot.
71. Cancelled Event rejects future RSVP changes.
72. Event reminder worker marks only Going/Maybe users eligible and is idempotent on second run.
73. Authorized Event `.ics` export returns safe calendar content with valid DTSTART/timezone and no RSVP/email/private AI/Action data.
74. Unauthorized or cancelled Event `.ics` export is rejected safely.

The final case also asserts the Release A privacy isolation requirements for private direct Actions and AI/private Action data exclusion from search and shared content without increasing the visible case count.

## Test Data Isolation

The harness creates unique users, chats, messages, media records, invite links, polls, events, and Actions with a generated run ID. The app does not currently expose a safe account-delete endpoint, so the harness does not perform broad database cleanup and does not connect to MongoDB directly for cleanup. Remove accumulated local smoke data only with a deliberate test-environment cleanup workflow.

## Reminder Probe

All product behavior is exercised through the gateway/API except case 72. Event reminders have no production-safe HTTP trigger endpoint, so the harness uses the existing `EventReminderProcessor` inside the running `blabber-full-messages` container and returns only scoped delivery counts for the event created by that run.

## Troubleshooting

- If readiness fails, check `docker compose -f docker-compose.full.yml ps` and service logs.
- If local `curl` works but the harness cannot connect, verify `SMOKE_GATEWAY_URL`.
- If the reminder case fails with Docker socket permissions, rerun the smoke command with permission to execute Docker against the local stack.
