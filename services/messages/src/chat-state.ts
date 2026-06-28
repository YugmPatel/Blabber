import { ObjectId } from 'mongodb';
import { getDatabase } from './db';

export async function unarchiveChatForParticipants(chatId: ObjectId, participantIds: ObjectId[]) {
  if (participantIds.length === 0) return;
  await getDatabase().collection('userChatPreferences').updateMany(
    { chatId, userId: { $in: participantIds }, archived: true },
    { $set: { archived: false, updatedAt: new Date() }, $unset: { archivedAt: '' } }
  );
}
