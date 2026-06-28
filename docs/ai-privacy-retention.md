# AI Privacy And Retention

Users control personal AI access from Settings under `AI privacy`. The default remains enabled for existing behavior. When disabled, AI intelligence routes reject requests for that user.

Users can clear private AI history with `DELETE /api/intelligence/history/me`. This removes persisted summaries, decisions, and waiting-on artifacts generated for that user, and scrubs generated Action source fields without deleting normal Actions.

Group admins can control group AI with `PATCH /api/chats/:id/intelligence/settings`. When `aiEnabled` is false, Catch Me Up, Group Brain, AI decision extraction, AI waiting-on extraction, and AI Action suggestions are blocked for the group. Disabling the group setting deletes persisted group summaries, decisions, and waiting-on artifacts and scrubs generated Action source fields. Normal Actions remain.

Group Brain Q&A remains transient and is not persisted as a chat artifact.
