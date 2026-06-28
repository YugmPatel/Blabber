# Release C Moment Interactions

Moment reactions and replies are private interaction surfaces.

## Reactions

- Allowed reactions are `❤️`, `😂`, `😮`, `😢`, and `🙌`.
- A viewer can have one current reaction per Moment.
- Authors cannot react to their own Moments.
- Feed and Moment detail responses expose only the current viewer's own `myReaction`.
- Other viewers never receive reaction counts, emoji lists, identities, or timestamps.
- Authors can view Moment interactions through the author-only interactions endpoint. That response may include viewer profile, viewed time, reaction emoji, and reaction time.
- Reactions are denied when the Moment is expired, deleted, blocked, no longer in audience, or tied to a deactivated/deleted account.

## Replies

- Moment replies are text-only direct messages.
- The server finds an existing eligible direct chat between the viewer and Moment author.
- The reply path never creates a direct chat and never trusts client-provided recipient, chat, author, or Moment metadata.
- Reply failures use the generic message `This reply is unavailable.`
- Stored messages use normal text message bodies plus safe `momentReply` metadata.
- Serialized messages expose only `{ isMomentReply: true, label: "Replied to a Moment" }`.
- Moment IDs, author IDs, media, captions, text, audience, viewers, and source jumps are not exposed through message serialization.

## Notifications

- `momentUpdatesEnabled` defaults to `false`.
- `momentActivityEnabled` defaults to `true`.
- Moment reply notifications use the existing direct-message notification path only.
- New Moment notifications use content-safe copy and a six-hour cooldown per author-recipient pair.
- Reaction activity notifications use content-safe copy and a five-minute cooldown per viewer-Moment pair.

## Search, AI, Sharing, And Account Data

- Moment reply message bodies remain normal direct-message text.
- Moment reply metadata is not part of the message text index.
- Forwarding strips Moment reply metadata.
- Shared content, saved messages, and pinned-message previews can show the generic Moment reply label but do not include Moment source data.
- Chat intelligence and source-reference materialization exclude Moment reply messages as AI evidence/source links.
- Account export includes a user's own Moment reaction activity without Moment content.
- Account deletion removes Moment reactions, cooldown records, and Moment reply source metadata related to deleted users or deleted authored Moments.

## Smoke

Run:

```sh
pnpm smoke:release-c-moment-interactions
```

The smoke verifies private reactions, author-only interactions, safe reply serialization, notification preference defaults/ownership, and generic denial behavior.
