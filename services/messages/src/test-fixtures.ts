import { ObjectId } from 'mongodb';
import { getDatabase } from './db';

export async function seedMessageTestChat(chatId: ObjectId, participantIds: ObjectId[]) {
  const now = new Date();
  await getDatabase().collection('chats').updateOne(
    { _id: chatId },
    {
      $set: {
        type: 'direct',
        participants: participantIds,
        admins: [],
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}
