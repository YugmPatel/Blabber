# Discovery Privacy

Release D Discovery is authenticated-only and opt-in. Public profiles, public posts, and open Communities do not appear in Discover unless their owner explicitly enables the relevant discovery setting.

## Controlled Topics

Discovery uses a system-owned topic catalog. Users cannot create free-form tags or hashtags, and Blabber does not infer topics from text, images, chats, Moments, or AI output. Sensitive targeting categories are deliberately excluded.

## Creator Discovery

Creator discovery is disabled by default. A creator can enable it only when the account is active, email is verified, a profile handle is claimed, the profile is public, and one to five controlled creator topics are selected.

Disabling creator discovery immediately removes the creator and their discoverable posts from Discover. It does not delete posts, alter followers, grant Moment access, create chats, or change Community membership.

## Discoverable Posts

Post discovery is disabled by default for all existing and new posts. Only the author can enable it, and only for an active public profile post with one to three controlled topics. Followers-only posts, private-profile posts, Community posts, Moments, and chat content are excluded.

Discoverable post media still uses the existing secure post media route. Raw storage URLs, storage paths, and stale object references are not discovery authorization.

## Listed Communities

Community listing is disabled by default. Only the Community owner can list an open Community with one to three controlled topics. Approval-required and private Communities cannot be listed. Community posts remain member-only and are not exposed through listing cards.

## User Controls

Users can privately follow topics, mute topics, hide a post with Not interested, mute a creator, and mute a Community. These controls are private to the current user and do not notify creators, Community owners, admins, moderators, followers, or members.

Muting never unfollows, blocks, leaves a Community, removes membership, or triggers moderation.

## Recommendation Signals

Release D Discovery collects only approved optional Discover signals for future ranking foundations. It does not implement For You ranking, Trending, popularity ranking, ML training, embeddings, collaborative filtering, or automatic topic inference.

Discover interaction events require a server-issued opaque candidate token. Tokens are random, hashed at rest, bound to the authenticated viewer, target type, target, source context, and short expiration. Candidate tokens cannot authorize media or content access and must not be logged.

Dwell telemetry uses bounded buckets only:

- `under_3_seconds`
- `3_to_10_seconds`
- `10_to_30_seconds`
- `over_30_seconds`

Raw millisecond timing, mouse movement, keystrokes, click coordinates, device fingerprinting, browser history, chat behavior, Moment behavior, and private Community behavior are not collected.

Optional discovery signal records retain only user ID, target type, target ID, controlled event type, source context, controlled topic IDs, bounded dwell bucket where applicable, a dedupe key, schema version, and timestamps. They do not store post bodies, comment bodies, media paths, emails, session data, block state, report data, AI data, rank scores, or candidate lists.

Signal events expire after 180 days and can be cleared by the user through personalization settings. Clearing personalization data removes optional signal records but preserves explicit hide and mute controls.

## Export And Deletion

Data export includes safe user-owned discovery files:

- `discovery-preferences.json`
- `my-discovery-feedback.json`
- `my-discovery-signals.json`

Exports omit candidate tokens, rank scores, raw target IDs where handles/topic keys are safer, raw media paths, private target details, other users' behavior, block data, report data, chats, Moments, and AI data.

Final account deletion removes user-owned discovery preferences, feedback, events, candidate tokens, and authored Discover eligibility. Deactivated accounts are immediately ineligible for creator discovery, discoverable posts, and listed Community ownership visibility.

## Isolation

Discovery content and signals remain separate from chat search, global message search, Shared Content, forwarding, pins, saved messages, Moments, AI source retrieval, AI prompts, group Actions, direct chats, group chats, and Community member content.

