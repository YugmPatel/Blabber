#!/usr/bin/env node
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const [, , userIdOrEmail, role] = process.argv;
const allowedRoles = new Set(['user', 'moderator', 'admin']);

if (!userIdOrEmail || !allowedRoles.has(role)) {
  console.error('Usage: node scripts/grant-platform-role.mjs <userId-or-email> <user|moderator|admin>');
  process.exit(1);
}

const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017';
const dbName = process.env.MONGO_DB_NAME || process.env.MONGODB_DB || 'blabber';

const client = new MongoClient(mongoUri);

try {
  await client.connect();
  const db = client.db(dbName);
  const query = ObjectId.isValid(userIdOrEmail)
    ? { _id: new ObjectId(userIdOrEmail) }
    : { email: userIdOrEmail.toLowerCase() };
  const result = await db.collection('users').findOneAndUpdate(
    query,
    { $set: { platformRole: role, updatedAt: new Date() } },
    { returnDocument: 'after', projection: { _id: 1, email: 1, platformRole: 1 } }
  );

  if (!result) {
    console.error('User not found');
    process.exit(1);
  }

  console.log(JSON.stringify({
    userId: result._id.toString(),
    platformRole: result.platformRole,
  }));
} finally {
  await client.close();
}
