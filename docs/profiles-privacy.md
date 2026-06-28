# Profiles Privacy

Release D profiles are authenticated-only and private by default. Account usernames remain internal account identifiers; public profile handles are optional, canonical lowercase, and never assigned to existing users automatically.

## Visibility

- Private profiles expose full profile details only to the owner and accepted followers.
- Non-followers see a locked profile containing only display name, handle, avatar, relationship action state, and a private-profile message.
- Public profiles are viewable by authenticated, non-blocked users and expose display name, handle, avatar, bio, website, and follower/following counts.
- Anonymous users cannot access profile APIs.
- Blocked, deactivated, deleted, or unknown profiles return a generic unavailable response.

## Handles

Handles are stored as `profileHandle` on users and must match `^[a-z][a-z0-9_]{2,29}$`. Reserved app, route, infrastructure, and moderation words are rejected. Handles are unique in canonical lowercase form.

Users can change handles once every 14 days. Released handles are reserved for 30 days in `profile_handle_reservations` without storing the former owner.

## Follow Graph

Follow state lives in `profile_relationships` with:

- `followerUserId`
- `targetUserId`
- `state`: `following` or `requested`
- timestamps for create/update/approval

Public profiles create `following` immediately. Private profiles create `requested` until the owner approves. Decline, cancel, unfollow, and remove-follower operations are idempotent and do not affect chats, groups, or Moment snapshots.

## Blocking And Deletion

Blocking deletes follow/request relationships in both directions and profile access is denied without exposing block direction. Unblocking does not restore relationships.

Final account deletion removes profile relationships, settings, and the user record. If a deleted account had a profile handle, the handle is placed in a 30-day non-attributed reservation.

## Moments, Search, Realtime, Export

The follow graph is not a Moment contact graph. Moments still derive audience from direct chats, close friends, snapshots, and block checks.

Profiles are not added to global search or discovery. Realtime events are private invalidation events sent only to affected user rooms:

- `profile:updated`
- `follow:updated`
- `follow:request-updated`

Data export includes safe profile and follow files only:

- `profile.json`
- `following.json`
- `incoming-follow-requests.json`

Exports exclude other-user private profile data, block direction, Moments, chat content, push endpoints, raw media paths, AI content, and moderation details.
