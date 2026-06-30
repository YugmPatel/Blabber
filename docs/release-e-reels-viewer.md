# Release E Reels Viewer

Batch 2 adds the Reels viewer layer on top of the short-video foundation:

- `/reels` on web and the mobile Reels tab show a newest-first Browse feed of eligible public, opted-in Reels.
- Creators can explicitly include a public Reel in Reels Browse and select one to three topics.
- Viewers can react, comment, save privately, report, mark not interested, and mute a Reel creator.
- Safe watch signals use short-lived event tokens and coarse buckets.
- Account export/deletion covers Reel reactions, comments, saves, and watch signals.
- The notifications service supports Reel activity preferences and cooldowns.

Out of scope for this batch:

- Personalized Reels ranking.
- Trending or popularity ranking.
- Remixing, stitching, duets, or creator monetization.

Validation is tracked by `pnpm smoke:release-e-reels-viewer`.

