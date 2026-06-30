# Reels Viewer Privacy

Release E Reels Browse is an explicit opt-in surface. A Reel can appear there only when the creator publishes it as public, enables Reels discoverability, and selects one to three discovery topics.

Viewer controls are private by default:

- Saved Reels are visible only to the saving user.
- Not interested and mute creator signals affect the viewer's Reels Browse results only.
- Watch events are recorded through short-lived event tokens instead of playback URLs.
- Reports store moderation evidence without raw playback URLs, filesystem paths, viewer lists, or raw watch tokens.
- Reaction and comment notifications use generic Reel activity copy and do not include caption bodies, comment bodies, or playback links.

Playback remains authorization-bound. Manifest, segment, fallback, and poster requests continue to require an active session that is scoped to the viewer and Reel.

