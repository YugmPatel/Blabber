import { ObjectId } from 'mongodb';
import { getDatabase } from './db';

export async function seedChatUsers(userIds: ObjectId[]) {
  if (userIds.length === 0) return;

  const now = new Date();
  await getDatabase().collection('users').bulkWrite(
    userIds.map((id, index) => ({
      updateOne: {
        filter: { _id: id },
        update: {
          $set: {
            username: `user_${id.toString()}`,
            email: `user_${id.toString()}@example.com`,
            name: `User ${index + 1}`,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        upsert: true,
      },
    }))
  );
}
