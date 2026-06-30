# Communities Privacy

Release D Communities are authenticated-only social spaces. Community membership is separate from chat participation and profile following, and Community posts are stored separately from profile feed posts.

## Visibility

- Private Communities return a generic unavailable response to nonmembers.
- Open and approval-required Communities expose only minimal preview data to nonmembers.
- Community posts, comments, reactions, member lists, requests, invites, and moderation activity require authenticated access and server-side authorization.
- Block relationships override Community relationships. Blocked users do not see or interact with each other's Community contributions.

## Invites

Community invite links use opaque random tokens. Only token hashes are stored. Invite tokens are returned only once to authorized owners/admins and are not included in exports, reports, activity logs, or moderation metadata.

## Media

Community avatars and Community post images must be approved images owned by the actor. They are serialized through authorized Community routes, not raw media URLs. Raw local media access treats Community references as private social media.

## Reports And Logs

Community reports use server-generated evidence. Evidence excludes invite tokens, raw URLs, storage paths, member rosters, private chat/Moment/AI data, and full Community content beyond bounded snapshots for review.

Community moderation activity records action type, actor/target display identity, minimal metadata, and timestamp. It avoids message bodies, invite data, emails, sessions, raw media paths, AI content, and private report details.

## Account Export And Deletion

Exports include only the account holder's safe Community data:

- `communities-owned-by-me.json`
- `my-community-memberships.json`
- `community-posts-authored-by-me.json`
- `my-community-comments.json`
- `my-community-reactions.json`

Exports do not include rosters, invites, moderation logs, reports evidence, AI data, Moments data, chats, blocks beyond the user's own block export, sessions beyond account-security metadata, or raw media paths.

Final account deletion removes the user's Community memberships, requests, bans, restrictions, authored Community content, and reactions. If the deleted account owns a Community, ownership transfers to the oldest active admin, then moderator, then member. If no successor exists, the Community is safely deleted.
