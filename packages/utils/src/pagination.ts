/**
 * Cursor-based pagination helpers for MongoDB
 */

export interface CursorPaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Encode cursor from MongoDB document
 * Cursor format: base64(createdAt_id)
 */
export function encodeCursor(createdAt: Date, id: string): string {
  const cursorString = `${createdAt.getTime()}_${id}`;
  return Buffer.from(cursorString).toString('base64');
}

/**
 * Decode cursor to get createdAt and id
 */
export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const [timestamp, id] = decoded.split('_');
    
    if (!timestamp || !id) {
      return null;
    }

    return {
      createdAt: new Date(parseInt(timestamp, 10)),
      id,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Build MongoDB query for cursor-based pagination
 */
export function buildCursorQuery(cursor?: string) {
  if (!cursor) {
    return {};
  }

  const decoded = decodeCursor(cursor);
  
  if (!decoded) {
    return {};
  }

  // Query for documents created before the cursor (for descending order)
  return {
    $or: [
      { createdAt: { $lt: decoded.createdAt } },
      {
        createdAt: decoded.createdAt,
        _id: { $lt: decoded.id },
      },
    ],
  };
}

/**
 * Build paginated response with next cursor
 */
export function buildPaginatedResponse<T extends { createdAt: Date; _id: string }>(
  data: T[],
  limit: number
): PaginatedResult<T> {
  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, limit) : data;
  
  const nextCursor = hasMore && items.length > 0
    ? encodeCursor(items[items.length - 1].createdAt, items[items.length - 1]._id)
    : null;

  return {
    data: items,
    nextCursor,
    hasMore,
  };
}

/**
 * Parse pagination parameters from query string
 */
export function parsePaginationParams(
  query: any,
  defaultLimit = 50,
  maxLimit = 100
): CursorPaginationParams {
  const limit = Math.min(
    parseInt(query.limit as string, 10) || defaultLimit,
    maxLimit
  );

  return {
    cursor: query.cursor as string | undefined,
    limit,
  };
}
