import { ObjectId } from 'mongodb';
import { getDatabase } from './db';

export async function purgeGroupIntelligenceArtifacts(chatId: ObjectId) {
  const db = getDatabase();
  const now = new Date();
  const [summaries, decisions, waitingOn, actions] = await Promise.all([
    db.collection('chat_summaries').deleteMany({ chatId }),
    db.collection('chat_decisions').deleteMany({ chatId }),
    db.collection('chat_waiting_on').deleteMany({ chatId }),
    db.collection('chat_actions').updateMany(
      { chatId, generatedByUserId: { $exists: true } },
      { $set: { updatedAt: now }, $unset: { sourceText: '', generatedByUserId: '' } } as any
    ),
  ]);

  return {
    summaries: summaries.deletedCount,
    decisions: decisions.deletedCount,
    waitingOn: waitingOn.deletedCount,
    generatedActionsScrubbed: actions.modifiedCount,
  };
}

export async function clearUserPrivateAiHistory(userId: ObjectId) {
  const db = getDatabase();
  const now = new Date();
  const [summaries, decisions, waitingOn, actions] = await Promise.all([
    db.collection('chat_summaries').deleteMany({ generatedByUserId: userId }),
    db.collection('chat_decisions').deleteMany({ generatedByUserId: userId }),
    db.collection('chat_waiting_on').deleteMany({ generatedByUserId: userId }),
    db.collection('chat_actions').updateMany(
      { generatedByUserId: userId },
      { $set: { updatedAt: now }, $unset: { sourceText: '', generatedByUserId: '' } } as any
    ),
  ]);

  return {
    summaries: summaries.deletedCount,
    decisions: decisions.deletedCount,
    waitingOn: waitingOn.deletedCount,
    generatedActionsScrubbed: actions.modifiedCount,
  };
}
