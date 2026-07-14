import { ObjectId } from 'mongodb';
import { getDatabase } from './db';

export async function seedMessageTestChat(
  chatId: ObjectId,
  participantIds: ObjectId[],
  type: 'direct' | 'group' = 'direct'
) {
  const now = new Date();
  await getDatabase().collection('chats').updateOne(
    { _id: chatId },
    {
      $set: {
        type,
        participants: participantIds,
        admins: [],
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}
