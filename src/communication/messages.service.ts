import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MessageParticipant, MessageThread, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { NewThreadDto } from './dto/new-thread.dto';
import { ReplyDto } from './dto/reply.dto';
import {
  MessageResponseDto,
  MessageThreadDetailResponseDto,
  MessageThreadResponseDto,
  PagedMessageThreadsDto,
} from './dto/message-response.dto';
import { NotificationsService } from './notifications.service';
import { RealtimeService } from './realtime/realtime.service';

interface ResolvedRecipient {
  userId: string;
  label: string;
}

type MessageRow = {
  id: string;
  senderId: string;
  senderLabel: string;
  body: string;
  createdAt: Date;
};

/**
 * §28 Internal messaging (`frontend/src/features/communication/api.ts`'s `/messages/threads`
 * surface). `messages.send` only gates starting a new thread (`POST /messages/threads`) — every
 * other method is a self-service "my inbox" operation, scoped to the caller's own
 * `MessageParticipant` row (module doc "Resolved from the original Open questions").
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async createThread(
    dto: NewThreadDto,
    user: AuthenticatedUser,
  ): Promise<MessageThreadDetailResponseDto> {
    const recipients =
      dto.recipientType === 'class'
        ? await this.resolveClassRecipients(dto.recipientId)
        : [await this.resolveIndividualRecipient(dto.recipientId)];

    const others = recipients.filter((r) => r.userId !== user.id);
    if (others.length === 0) {
      throw new BadRequestException(
        'No reachable recipient — every match has no portal account linked yet',
      );
    }

    const thread = await this.prisma.$transaction(async (tx) => {
      const created = await tx.messageThread.create({
        data: {
          subject: dto.subject,
          recipientType: dto.recipientType,
          classId: dto.recipientType === 'class' ? dto.recipientId : null,
          createdByUserId: user.id,
        } as unknown as Prisma.MessageThreadUncheckedCreateInput,
      });
      await tx.messageParticipant.createMany({
        data: [
          {
            threadId: created.id,
            userId: user.id,
            label: user.name,
            lastReadAt: new Date(),
          },
          ...others.map((r) => ({
            threadId: created.id,
            userId: r.userId,
            label: r.label,
          })),
        ] as unknown as Prisma.MessageParticipantUncheckedCreateInput[],
      });
      await tx.message.create({
        data: {
          threadId: created.id,
          senderId: user.id,
          senderLabel: user.name,
          body: dto.body,
        } as unknown as Prisma.MessageUncheckedCreateInput,
      });
      return created;
    });

    await this.notifyParticipants(thread.id, others, user.name, dto.subject);
    return this.getThread(thread.id, user.id);
  }

  async listThreads(
    query: ListQueryDto,
    userId: string,
  ): Promise<PagedMessageThreadsDto> {
    const where: Prisma.MessageThreadWhereInput = {
      participants: { some: { userId } },
      ...(query.search
        ? { subject: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const result = await paginate(
      () =>
        this.prisma.messageThread.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip,
          take,
          include: {
            participants: true,
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        }),
      () => this.prisma.messageThread.count({ where }),
    );
    return {
      items: await Promise.all(
        result.items.map((t) =>
          this.toThreadResponse(t, t.participants, t.messages[0], userId),
        ),
      ),
      total: result.total,
    };
  }

  async getThread(
    id: string,
    userId: string,
  ): Promise<MessageThreadDetailResponseDto> {
    const thread = await this.prisma.messageThread.findUnique({
      where: { id },
      include: {
        participants: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!thread || !thread.participants.some((p) => p.userId === userId)) {
      throw new NotFoundException(`Message thread ${id} not found`);
    }
    const summary = await this.toThreadResponse(
      thread,
      thread.participants,
      thread.messages[thread.messages.length - 1],
      userId,
    );
    return { ...summary, messages: thread.messages.map(toMessageResponse) };
  }

  async reply(
    id: string,
    dto: ReplyDto,
    user: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    const thread = await this.prisma.messageThread.findUnique({
      where: { id },
      include: { participants: true },
    });
    const participant = thread?.participants.find((p) => p.userId === user.id);
    if (!thread || !participant) {
      throw new NotFoundException(`Message thread ${id} not found`);
    }

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          threadId: id,
          senderId: user.id,
          senderLabel: user.name,
          body: dto.body,
        } as unknown as Prisma.MessageUncheckedCreateInput,
      }),
      this.prisma.messageThread.update({
        where: { id },
        data: { updatedAt: new Date() },
      }),
      this.prisma.messageParticipant.update({
        where: { id: participant.id },
        data: { lastReadAt: new Date() },
      }),
    ]);

    const others = thread.participants
      .filter((p) => p.userId !== user.id)
      .map((p) => ({ userId: p.userId, label: p.label }));
    await this.notifyParticipants(id, others, user.name, thread.subject);
    return toMessageResponse(message);
  }

  async markThreadRead(id: string, userId: string): Promise<void> {
    const participant = await this.prisma.messageParticipant.findUnique({
      where: { threadId_userId: { threadId: id, userId } },
    });
    if (!participant) {
      throw new NotFoundException(`Message thread ${id} not found`);
    }
    await this.prisma.messageParticipant.update({
      where: { id: participant.id },
      data: { lastReadAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------

  /** `recipientId` is a `Parent.id` or a `Teacher.id` — tried in that order, matching `NewThreadDialog`'s "parent" default `individualKind`. */
  private async resolveIndividualRecipient(
    recipientId: string,
  ): Promise<ResolvedRecipient> {
    const parent = await this.prisma.parent.findUnique({
      where: { id: recipientId },
    });
    if (parent) {
      if (!parent.userId) {
        throw new BadRequestException(
          `${parent.name} has no portal account linked yet`,
        );
      }
      return { userId: parent.userId, label: parent.name };
    }
    const teacher = await this.prisma.teacher.findUnique({
      where: { id: recipientId },
    });
    if (teacher) {
      if (!teacher.userId) {
        throw new BadRequestException(
          `${teacher.name} has no portal account linked yet`,
        );
      }
      return { userId: teacher.userId, label: teacher.name };
    }
    throw new NotFoundException(
      `No parent or teacher found for recipient ${recipientId}`,
    );
  }

  /** Fans out to every parent of the class who has a linked portal account — a parent with none yet is silently skipped, same documented gap as `Parent.userId` elsewhere. */
  private async resolveClassRecipients(
    classId: string,
  ): Promise<ResolvedRecipient[]> {
    const schoolClass = await this.prisma.schoolClass.findUnique({
      where: { id: classId },
    });
    if (!schoolClass) {
      throw new NotFoundException(`Class ${classId} not found`);
    }
    const links = await this.prisma.parentStudentLink.findMany({
      where: { student: { classId } },
      include: { parent: true },
    });
    const byParentId = new Map(links.map((l) => [l.parentId, l.parent]));
    return [...byParentId.values()]
      .filter((parent) => !!parent.userId)
      .map((parent) => ({
        userId: parent.userId as string,
        label: parent.name,
      }));
  }

  private async notifyParticipants(
    threadId: string,
    recipients: ResolvedRecipient[],
    senderName: string,
    subject: string,
  ): Promise<void> {
    await Promise.all(
      recipients.map(async (r) => {
        await this.notifications.notifyUser({
          userId: r.userId,
          type: 'message',
          title: `New message from ${senderName}`,
          body: subject,
          linkHref: `/messages/${threadId}`,
        });
        this.realtime.emitToUser(r.userId, 'message:new', { threadId });
      }),
    );
  }

  private async toThreadResponse(
    thread: MessageThread,
    participants: MessageParticipant[],
    lastMessage: MessageRow | undefined,
    userId: string,
  ): Promise<MessageThreadResponseDto> {
    const me = participants.find((p) => p.userId === userId);
    const unreadCount = await this.prisma.message.count({
      where: {
        threadId: thread.id,
        senderId: { not: userId },
        ...(me?.lastReadAt ? { createdAt: { gt: me.lastReadAt } } : {}),
      },
    });
    return {
      id: thread.id,
      subject: thread.subject,
      participantLabels: participants.map((p) => p.label),
      lastMessagePreview: lastMessage?.body.slice(0, 200) ?? '',
      lastMessageAt: (lastMessage?.createdAt ?? thread.createdAt).toISOString(),
      unreadCount,
    };
  }
}

function toMessageResponse(message: MessageRow): MessageResponseDto {
  return {
    id: message.id,
    senderId: message.senderId,
    senderLabel: message.senderLabel,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    // Per-message read receipts are triaged out of this phase — see `schema.prisma`'s `Message`
    // model doc comment.
    readAt: null,
  };
}
