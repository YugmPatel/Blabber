import { MongoClient, Db } from 'mongodb';
import { loadDatabaseConfig } from '@repo/config';
import { logger } from '@repo/utils';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
  if (db) {
    return db;
  }

  const config = loadDatabaseConfig();

  try {
    client = new MongoClient(config.MONGO_URI);
    await client.connect();
    db = client.db(config.MONGO_DB_NAME);

    logger.info({ dbName: config.MONGO_DB_NAME }, 'Connected to MongoDB');

    return db;
  } catch (error) {
    logger.error({ error }, 'Failed to connect to MongoDB');
    throw error;
  }
}

export function getDatabase(): Db {
  if (!db) {
    throw new Error('Database not initialized. Call connectToDatabase() first.');
  }
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('Closed MongoDB connection');
  }
}
