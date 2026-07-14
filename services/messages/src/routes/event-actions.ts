import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { EventRsvpDTOSchema, EventType, MessageEditedEvent, UpdateEventDTOSchema } from '@repo/types';
import { createEvent, logger } from '@repo/utils';
import { getMessagesCollection, MessageDocument } from '../models/message';
import { assertChatMembership, assertChatWritable } from '../chat-access';
import { serializeMessage } from '../serialize-message';
import { getPubSub } from '../pubsub';
import { parseEventDate, validateMeetingUrl, validateTimezone } from '../event-utils';
import { buildEventIcs, eventIcsFilename } from '../ics';

async function publishMessageEdited(message: ReturnType<typeof serializeMessage>, participants?: string[]) {
  try {
    await getPubSub().publish(createEvent<MessageEditedEvent>(EventType.MESSAGE_EDITED, {
      messageId: message._id,
      chatId: message.chatId,
      content: message.body,
      message,
      participants,
      editedAt: new Date().toISOString(),
    }));
  } catch (error) {
    logger.error({ error, messageId: message._id }, 'Failed to publish event update');
  }
}

async function loadEventMessage(
  messageId: string,
  userObjectId: ObjectId,
  res: Response,
  options: { requireWritable?: boolean } = {}
) {
  if (!ObjectId.isValid(messageId)) {
    res.status(400).json({ error: 'Bad Request', message: 'Invalid message ID' });
    return null;
  }

  const message = await getMessagesCollection().findOne({ _id: new ObjectId(messageId) });
  if (!message?.event) {
    res.status(404).json({ error: 'Not Found', message: 'Event message not found' });
    return null;
  }

  const chat = await assertChatMembership(message.chatId, userObjectId);
  // RSVP/update/cancel edit the event and notify the other participant, so a
  // blocked direct chat must reject them the same as a new message. Viewing/
  // exporting the existing event (exportEventIcs) stays allowed regardless.
  if (options.requireWritable !== false) {
    await assertChatWritable(chat, userObjectId);
  }
  const participants = chat.participants.map((participantId) => participantId.toString());
  return { message, participants };
}

function isEventCreator(message: MessageDocument, userObjectId: ObjectId) {
  const creatorId = message.event?.createdBy || message.senderId;
  return creatorId.equals(userObjectId);
}

export async function rsvpEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    const parsed = EventRsvpDTOSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid request body', details: parsed.error.errors });
      return;
    }

    const userObjectId = new ObjectId(userId);
    const loaded = await loadEventMessage(req.params.messageId, userObjectId, res);
    if (!loaded) return;
    const { message, participants } = loaded;
    if (message.event?.cancelledAt) {
      res.status(400).json({ error: 'Bad Request', message: 'Event is cancelled' });
      return;
    }

    const now = new Date();
    const existing = message.event?.rsvps || [];
    const current = existing.find((rsvp) => rsvp.userId.equals(userObjectId));
    const rsvps = [
      ...existing.filter((rsvp) => !rsvp.userId.equals(userObjectId)),
      {
        userId: userObjectId,
        status: parsed.data.status,
        respondedAt: current?.respondedAt || now,
        updatedAt: now,
      },
    ];

    const updated = await getMessagesCollection().findOneAndUpdate(
      { _id: message._id },
      { $set: { 'event.rsvps': rsvps, editedAt: now } },
      { returnDocument: 'after' }
    );
    const apiMessage = serializeMessage(updated!, undefined, userObjectId);
    await publishMessageEdited(apiMessage, participants);
    res.status(200).json(apiMessage);
  } catch (error) {
    next(error);
  }
}

export async function updateEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    const parsed = UpdateEventDTOSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid request body', details: parsed.error.errors });
      return;
    }

    const userObjectId = new ObjectId(userId);
    const loaded = await loadEventMessage(req.params.messageId, userObjectId, res);
    if (!loaded) return;
    const { message, participants } = loaded;
    if (!isEventCreator(message, userObjectId)) {
      res.status(403).json({ error: 'Forbidden', message: 'Only the event creator can edit this event' });
      return;
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) update['event.title'] = parsed.data.title;
    if (parsed.data.location !== undefined) update['event.location'] = parsed.data.location;
    if (parsed.data.description !== undefined) update['event.description'] = parsed.data.description;
    if (parsed.data.reminderEnabled !== undefined) update['event.reminderEnabled'] = parsed.data.reminderEnabled;
    if (parsed.data.timezone !== undefined) {
      const timezone = validateTimezone(parsed.data.timezone);
      if (!timezone) {
        res.status(400).json({ error: 'Bad Request', message: 'Invalid event timezone' });
        return;
      }
      update['event.timezone'] = timezone;
    }
    if (parsed.data.meetingUrl !== undefined) {
      const meetingUrl = validateMeetingUrl(parsed.data.meetingUrl);
      if (meetingUrl === null) {
        res.status(400).json({ error: 'Bad Request', message: 'Meeting URL must use http or https' });
        return;
      }
      update['event.meetingUrl'] = meetingUrl || undefined;
    }
    if (parsed.data.startAt || parsed.data.startsAt) {
      const startAt = parseEventDate(parsed.data.startAt || parsed.data.startsAt);
      if (!startAt) {
        res.status(400).json({ error: 'Bad Request', message: 'Invalid event start time' });
        return;
      }
      update['event.startAt'] = startAt;
      update['event.startsAt'] = startAt.toISOString();
    }
    if (parsed.data.endAt !== undefined) {
      const endAt = parseEventDate(parsed.data.endAt);
      if (!endAt) {
        res.status(400).json({ error: 'Bad Request', message: 'Invalid event end time' });
        return;
      }
      update['event.endAt'] = endAt;
    }

    const startCandidate = (update['event.startAt'] as Date | undefined) || message.event?.startAt || new Date(message.event!.startsAt);
    const endCandidate = (update['event.endAt'] as Date | undefined) || message.event?.endAt;
    if (endCandidate && endCandidate.getTime() <= startCandidate.getTime()) {
      res.status(400).json({ error: 'Bad Request', message: 'Event end time must be after start time' });
      return;
    }

    const now = new Date();
    update['event.updatedAt'] = now;
    update.editedAt = now;
    const updated = await getMessagesCollection().findOneAndUpdate(
      { _id: message._id },
      { $set: update },
      { returnDocument: 'after' }
    );
    const apiMessage = serializeMessage(updated!, undefined, userObjectId);
    await publishMessageEdited(apiMessage, participants);
    res.status(200).json(apiMessage);
  } catch (error) {
    next(error);
  }
}

export async function cancelEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }
    const userObjectId = new ObjectId(userId);
    const loaded = await loadEventMessage(req.params.messageId, userObjectId, res);
    if (!loaded) return;
    const { message, participants } = loaded;
    if (!isEventCreator(message, userObjectId)) {
      res.status(403).json({ error: 'Forbidden', message: 'Only the event creator can cancel this event' });
      return;
    }

    const now = new Date();
    const updated = await getMessagesCollection().findOneAndUpdate(
      { _id: message._id },
      { $set: { 'event.cancelledAt': now, 'event.cancelledBy': userObjectId, editedAt: now } },
      { returnDocument: 'after' }
    );
    const apiMessage = serializeMessage(updated!, undefined, userObjectId);
    await publishMessageEdited(apiMessage, participants);
    res.status(200).json(apiMessage);
  } catch (error) {
    next(error);
  }
}

export async function exportEventIcs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }
    const loaded = await loadEventMessage(req.params.messageId, new ObjectId(userId), res, { requireWritable: false });
    if (!loaded) return;
    const { message } = loaded;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${eventIcsFilename(message.event!.title)}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(buildEventIcs(message));
  } catch (error) {
    next(error);
  }
}
