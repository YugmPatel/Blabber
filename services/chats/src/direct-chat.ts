import { ObjectId } from 'mongodb';
import { getChatsCollection } from './models/chat';
import { serializeChat } from './serialize-chat';

/**
 * Returns the existing direct chat between the two users if one is already
 * live, otherwise creates it. Shared by create-chat.ts's "everyone" path and
 * the message-request accept handler, so both end up with an identical chat
 * document shape.
 */
export async function getOrCreateDirectChat(userA: ObjectId, userB: ObjectId) {
  const collection = getChatsCollection();
  const existing = await collection.findOne({
    type: 'direct',
    participants: { $all: [userA, userB] },
    deletedAt: { $exists: false },
    endedAt: { $exists: false },
  });
  if (existing) return serializeChat(existing, { includeParticipants: true });

  const now = new Date();
  const chat = {
    type: 'direct' as const,
    participants: [userA, userB],
    admins: [],
    createdAt: now,
    updatedAt: now,
  };
  const result = await collection.insertOne(chat as any);
  const created = await collection.findOne({ _id: result.insertedId });
  return serializeChat(created!, { includeParticipants: true });
}
