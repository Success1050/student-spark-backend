import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StorageService } from '../storage/storage.service.js';
import {
  CreateChannelDto,
  CreateCommunityDto,
  SendChannelMessageDto,
  SendDmMessageDto,
  UploadCommunityMediaDto,
} from './dto/communities.dto.js';
import { CommunitiesGateway } from './gateways/communities.gateway.js';

const NATIONAL_LOUNGES_SEED = [
  {
    inviteCode: 'NAT-JAMB-WAEC-2026',
    name: 'JAMB / UTME & WAEC Prep Lounge',
    description:
      'Nationwide exam prep hub for Nigerian students tackling JAMB, WAEC, NECO & Post-UTME together.',
    category: 'EXAM_PREP',
    channels: [
      { name: 'general-prep', topic: 'Study schedules, exam countdowns & motivation', channelType: 'TEXT', isDefault: true },
      { name: 'maths-and-physics', topic: 'Solve tough calculus, mechanics & electricity problems', channelType: 'QNA', isDefault: false },
      { name: 'english-and-literature', topic: 'Comprehension, lexis & structure practice', channelType: 'TEXT', isDefault: false },
      { name: 'past-questions-drop', topic: 'Share past questions, notes & CBT quizzes', channelType: 'STUDY_MATERIALS', isDefault: false },
    ],
  },
  {
    inviteCode: 'NAT-ENG-TECH-2026',
    name: 'Nigerian Engineering & Tech Hub',
    description:
      'Connect across universities & polytechnics — Computer Science, Electrical, Mechanical & Software Engineering.',
    category: 'TECH',
    channels: [
      { name: 'coding-and-software', topic: 'JavaScript, Python, AI, Mobile & Web development help', channelType: 'TEXT', isDefault: true },
      { name: 'circuits-and-mechanics', topic: 'EEE, MEE & Civil Engineering coursework collaboration', channelType: 'QNA', isDefault: false },
      { name: 'projects-and-internships', topic: 'SIWES, IT placements, hackathons & final-year projects', channelType: 'STUDY_MATERIALS', isDefault: false },
    ],
  },
  {
    inviteCode: 'NAT-MED-SCI-2026',
    name: 'Medicine, Health & Life Sciences',
    description:
      'Cross-campus study lounge for Medicine, Pharmacy, Nursing, Biochemistry & Pure Sciences.',
    category: 'STEM',
    channels: [
      { name: 'anatomy-and-biology', topic: 'Diagrams, mnemonics & clinical case study discussions', channelType: 'TEXT', isDefault: true },
      { name: 'chemistry-and-pharma', topic: 'Organic chemistry, reactions & lab concepts', channelType: 'QNA', isDefault: false },
    ],
  },
  {
    inviteCode: 'NAT-BIZ-LAW-2026',
    name: 'Business, Law & Scholarships Lounge',
    description:
      'Accounting, Economics, Mass Comm, Law discussions plus verified Nigerian & global scholarship tips.',
    category: 'ARTS',
    channels: [
      { name: 'economics-and-finance', topic: 'Accounting, micro/macroeconomics & business cases', channelType: 'TEXT', isDefault: true },
      { name: 'law-and-governance', topic: 'Case law briefs, debates & public policy', channelType: 'TEXT', isDefault: false },
      { name: 'scholarships-and-careers', topic: 'Share grants, bursaries & internship leads', channelType: 'STUDY_MATERIALS', isDefault: false },
    ],
  },
];

const SENDER_SELECT = {
  id: true,
  fullName: true,
  role: true,
  avatarUrl: true,
  schoolId: true,
  school: {
    select: {
      id: true,
      name: true,
      schoolCode: true,
      institutionType: true,
    },
  },
};

function slugifyChannelName(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 42) || 'general'
  );
}

/**
 * Day 17: Dual-Zone Communities & Study Chats Engine
 * - Zone 1 (MY_CAMPUS): Frictionless institution/faculty/department/class channels (auto-provisioned)
 * - Zone 2 (CROSS_SCHOOL): National Study Lounges & Cross-School 1v1 Direct Messages
 * Permitted even when an academic term is officially closed.
 */
@Injectable()
export class CommunitiesService {
  private readonly logger = new Logger(CommunitiesService.name);
  private readonly bootstrappedKeys = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CommunitiesGateway,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  private generateInviteCode(prefix: string): string {
    const cleanPrefix = prefix.replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'SPARK';
    const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `${cleanPrefix}-${rand}`;
  }

  /**
   * Ensures the 4 default National Cross-School Study Lounges exist (cached O(1) after first run).
   */
  private async ensureNationalLounges(fallbackCreatorId: string): Promise<void> {
    if (this.bootstrappedKeys.has('NATIONAL_LOUNGES')) return;

    const existingCount = await this.prisma.studyCommunity.count({
      where: { zone: 'CROSS_SCHOOL', schoolId: null },
    });

    if (existingCount === 0) {
      for (const seed of NATIONAL_LOUNGES_SEED) {
        const exists = await this.prisma.studyCommunity.findUnique({
          where: { inviteCode: seed.inviteCode },
          select: { id: true },
        });
        if (exists) continue;

        await this.prisma.studyCommunity.create({
          data: {
            creatorId: fallbackCreatorId,
            schoolId: null,
            name: seed.name,
            description: seed.description,
            inviteCode: seed.inviteCode,
            isOfficialSchoolHub: false,
            zone: 'CROSS_SCHOOL',
            category: seed.category,
            isPublic: true,
            channels: {
              create: seed.channels.map((ch) => ({
                name: ch.name,
                topic: ch.topic,
                channelType: ch.channelType,
                isDefault: ch.isDefault,
              })),
            },
          },
        });
      }
    }

    this.bootstrappedKeys.add('NATIONAL_LOUNGES');
  }

  /**
   * Ensures an institution's Official "My Campus" Hub exists with frictionless channels
   * mapped directly from its Faculties/Sections, Departments, or Classes, and auto-enrolls the user.
   */
  private async ensureOfficialCampusHub(
    schoolId: string,
    userId: string,
    userRole: string,
  ): Promise<string | null> {
    const cacheKey = `CAMPUS:${schoolId}`;

    let hub = await this.prisma.studyCommunity.findFirst({
      where: { schoolId, isOfficialSchoolHub: true },
      select: { id: true },
    });

    if (!hub) {
      const [school, units, departments, classes] = await Promise.all([
        this.prisma.school.findUnique({
          where: { id: schoolId },
          select: { id: true, name: true, schoolCode: true, institutionType: true },
        }),
        this.prisma.academicUnit.findMany({
          where: { schoolId },
          select: { id: true, name: true, code: true },
          take: 8,
          orderBy: { name: 'asc' },
        }),
        this.prisma.department.findMany({
          where: { schoolId },
          select: { id: true, name: true, code: true },
          take: 8,
          orderBy: { name: 'asc' },
        }),
        this.prisma.schoolClass.findMany({
          where: { schoolId },
          select: { id: true, name: true },
          take: 8,
          orderBy: { name: 'asc' },
        }),
      ]);

      if (!school) return null;

      const isTertiary = ['UNIVERSITY', 'POLYTECHNIC', 'COLLEGE_OF_EDUCATION', 'TERTIARY'].includes(
        String(school.institutionType || '').toUpperCase(),
      );

      const channelsToCreate: Array<{
        name: string;
        topic: string;
        channelType: string;
        isDefault: boolean;
        isReadOnlyForStudents: boolean;
      }> = [
        {
          name: 'general-campus',
          topic: `Welcome to ${school.name}! Connect with coursemates, teachers & campus peers.`,
          channelType: 'TEXT',
          isDefault: true,
          isReadOnlyForStudents: false,
        },
        {
          name: 'official-announcements',
          topic: 'Important institution updates from School Admin & Faculty.',
          channelType: 'ANNOUNCEMENTS',
          isDefault: false,
          isReadOnlyForStudents: true,
        },
        {
          name: 'study-notes-and-qa',
          topic: 'Drop revision notes, past questions & ask subject questions.',
          channelType: 'STUDY_MATERIALS',
          isDefault: false,
          isReadOnlyForStudents: false,
        },
      ];

      const usedNames = new Set(channelsToCreate.map((c) => c.name));

      if (isTertiary) {
        for (const dept of departments) {
          const slug = slugifyChannelName(`dept-${dept.code || dept.name}`);
          if (!usedNames.has(slug)) {
            usedNames.add(slug);
            channelsToCreate.push({
              name: slug,
              topic: `${dept.name} departmental study discussions & course updates`,
              channelType: 'TEXT',
              isDefault: false,
              isReadOnlyForStudents: false,
            });
          }
        }
        if (departments.length === 0) {
          for (const u of units) {
            const slug = slugifyChannelName(`faculty-${u.code || u.name}`);
            if (!usedNames.has(slug)) {
              usedNames.add(slug);
              channelsToCreate.push({
                name: slug,
                topic: `${u.name} faculty study channel`,
                channelType: 'TEXT',
                isDefault: false,
                isReadOnlyForStudents: false,
              });
            }
          }
        }
      } else {
        for (const cls of classes) {
          const slug = slugifyChannelName(cls.name);
          if (!usedNames.has(slug)) {
            usedNames.add(slug);
            channelsToCreate.push({
              name: slug,
              topic: `${cls.name} class study room & homework help`,
              channelType: 'TEXT',
              isDefault: false,
              isReadOnlyForStudents: false,
            });
          }
        }
      }

      hub = await this.prisma.studyCommunity.create({
        data: {
          schoolId,
          creatorId: userId,
          name: `${school.name} Campus Hub`,
          description: `Official frictionless campus channels for ${school.name} (${school.schoolCode}).`,
          inviteCode: this.generateInviteCode(school.schoolCode || 'CAMPUS'),
          isOfficialSchoolHub: true,
          zone: 'MY_CAMPUS',
          category: 'GENERAL',
          isPublic: true,
          channels: { create: channelsToCreate },
        },
        select: { id: true },
      });
    }

    this.bootstrappedKeys.add(cacheKey);

    // Frictionless auto-membership in Official Campus Hub
    await this.prisma.communityMember.upsert({
      where: { communityId_userId: { communityId: hub.id, userId } },
      update: {},
      create: {
        communityId: hub.id,
        userId,
        role:
          userRole === 'SCHOOL_ADMIN' || userRole === 'SUPER_ADMIN'
            ? 'ADMIN'
            : userRole === 'TEACHER'
              ? 'MODERATOR'
              : 'MEMBER',
      },
    });

    return hub.id;
  }

  // ============================================================================
  // 1. DUAL-ZONE HUB OVERVIEW (MY CAMPUS + CROSS-SCHOOL CONNECT + DM SUMMARY)
  // ============================================================================

  async getCommunitiesHub(userId: string, explicitSchoolId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        role: true,
        schoolId: true,
        school: {
          select: { id: true, name: true, schoolCode: true, institutionType: true },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const schoolId = explicitSchoolId || user.schoolId || null;

    // Auto-bootstrap hubs on first access (cached in memory after initial creation)
    await Promise.all([
      this.ensureNationalLounges(userId),
      schoolId ? this.ensureOfficialCampusHub(schoolId, userId, user.role) : Promise.resolve(null),
    ]);

    const [campusCommunities, crossSchoolCommunities, myMemberships, unreadDmCount] =
      await Promise.all([
        schoolId
          ? this.prisma.studyCommunity.findMany({
              where: { schoolId, zone: 'MY_CAMPUS' },
              include: {
                channels: {
                  orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
                  include: { _count: { select: { messages: true } } },
                },
                _count: { select: { members: true, channels: true } },
              },
              orderBy: [{ isOfficialSchoolHub: 'desc' }, { createdAt: 'desc' }],
            })
          : Promise.resolve([]),
        this.prisma.studyCommunity.findMany({
          where: { zone: 'CROSS_SCHOOL', isPublic: true },
          include: {
            channels: {
              orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
              include: { _count: { select: { messages: true } } },
            },
            _count: { select: { members: true, channels: true } },
          },
          orderBy: [{ createdAt: 'asc' }],
          take: 40,
        }),
        this.prisma.communityMember.findMany({
          where: { userId },
          select: { communityId: true, role: true },
        }),
        this.prisma.directMessage.count({
          where: {
            senderId: { not: userId },
            readAt: null,
            conversation: {
              OR: [{ participantAId: userId }, { participantBId: userId }],
            },
          },
        }),
      ]);

    const membershipMap = new Map(myMemberships.map((m) => [m.communityId, m.role]));

    const mapCommunity = (c: any) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      iconUrl: c.iconUrl,
      inviteCode: c.inviteCode,
      zone: c.zone,
      category: c.category,
      isOfficialSchoolHub: c.isOfficialSchoolHub,
      schoolId: c.schoolId,
      membersCount: c._count?.members || 0,
      channelsCount: c._count?.channels || c.channels?.length || 0,
      isMember: membershipMap.has(c.id),
      myRole: membershipMap.get(c.id) || null,
      channels: (c.channels || []).map((ch: any) => ({
        id: ch.id,
        communityId: ch.communityId,
        name: ch.name,
        topic: ch.topic,
        channelType: ch.channelType,
        isDefault: ch.isDefault,
        isReadOnlyForStudents: ch.isReadOnlyForStudents,
        messagesCount: ch._count?.messages || 0,
      })),
      createdAt: c.createdAt,
    });

    return {
      userSchool: user.school,
      onlineUsersCount: Math.max(1, this.gateway.getOnlineUserCount()),
      unreadDmCount,
      myCampus: campusCommunities.map(mapCommunity),
      crossSchool: crossSchoolCommunities.map(mapCommunity),
    };
  }

  // ============================================================================
  // 2. CREATE / JOIN / LEAVE COMMUNITIES & CHANNELS
  // ============================================================================

  async createCommunity(userId: string, dto: CreateCommunityDto, explicitSchoolId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, schoolId: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const zone = dto.zone || (user.schoolId ? 'MY_CAMPUS' : 'CROSS_SCHOOL');
    const schoolId = zone === 'MY_CAMPUS' ? explicitSchoolId || user.schoolId : null;

    if (zone === 'MY_CAMPUS' && !schoolId) {
      throw new BadRequestException(
        'Independent learners can create Cross-School Connect lounges instead of Campus hubs.',
      );
    }

    const channelNames =
      dto.initialChannels && dto.initialChannels.length > 0
        ? Array.from(new Set(dto.initialChannels.map(slugifyChannelName)))
        : ['general', 'study-notes'];

    const community = await this.prisma.studyCommunity.create({
      data: {
        schoolId,
        creatorId: userId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        inviteCode: this.generateInviteCode(zone === 'CROSS_SCHOOL' ? 'NAT' : 'CMP'),
        zone,
        category: dto.category || 'STUDY_LOUNGE',
        isOfficialSchoolHub: false,
        isPublic: true,
        members: {
          create: { userId, role: 'ADMIN' },
        },
        channels: {
          create: channelNames.map((name, idx) => ({
            name,
            topic: idx === 0 ? `Main discussion room for ${dto.name.trim()}` : 'Study resources & Q&A',
            channelType: idx === 0 ? 'TEXT' : 'STUDY_MATERIALS',
            isDefault: idx === 0,
          })),
        },
      },
      include: {
        channels: true,
        _count: { select: { members: true, channels: true } },
      },
    });

    return community;
  }

  async createChannel(userId: string, communityId: string, dto: CreateChannelDto) {
    const [community, membership, user] = await Promise.all([
      this.prisma.studyCommunity.findUnique({ where: { id: communityId } }),
      this.prisma.communityMember.findUnique({
        where: { communityId_userId: { communityId, userId } },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    ]);

    if (!community) throw new NotFoundException('Community not found.');
    const canManage =
      membership?.role === 'ADMIN' ||
      membership?.role === 'MODERATOR' ||
      user?.role === 'SCHOOL_ADMIN' ||
      user?.role === 'SUPER_ADMIN' ||
      community.creatorId === userId;

    if (!canManage) {
      throw new ForbiddenException('Only community admins or moderators can add channels.');
    }

    const cleanName = slugifyChannelName(dto.name);
    const channel = await this.prisma.communityChannel.create({
      data: {
        communityId,
        name: cleanName,
        topic: dto.topic?.trim() || null,
        channelType: dto.channelType || 'TEXT',
        isReadOnlyForStudents: !!dto.isReadOnlyForStudents,
      },
    });

    return channel;
  }

  async joinCommunity(userId: string, communityId: string) {
    const [community, user] = await Promise.all([
      this.prisma.studyCommunity.findUnique({ where: { id: communityId } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { schoolId: true, role: true } }),
    ]);
    if (!community) throw new NotFoundException('Community not found.');

    if (community.zone === 'MY_CAMPUS' && community.schoolId && community.schoolId !== user?.schoolId && user?.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('This campus community is restricted to members of that institution.');
    }

    await this.prisma.communityMember.upsert({
      where: { communityId_userId: { communityId, userId } },
      update: {},
      create: { communityId, userId, role: 'MEMBER' },
    });

    return { joined: true, communityId };
  }

  async joinCommunityByInviteCode(userId: string, inviteCode: string) {
    const cleanCode = inviteCode.trim().toUpperCase();
    const community = await this.prisma.studyCommunity.findUnique({
      where: { inviteCode: cleanCode },
    });
    if (!community) {
      throw new NotFoundException(`No study community found with invite code "${cleanCode}".`);
    }
    await this.joinCommunity(userId, community.id);
    return { joined: true, community };
  }

  async leaveCommunity(userId: string, communityId: string) {
    const community = await this.prisma.studyCommunity.findUnique({
      where: { id: communityId },
      select: { isOfficialSchoolHub: true },
    });
    if (community?.isOfficialSchoolHub) {
      throw new BadRequestException('You cannot leave your official institution campus hub.');
    }
    await this.prisma.communityMember.deleteMany({
      where: { communityId, userId },
    });
    return { left: true, communityId };
  }

  // ============================================================================
  // 3. REAL-TIME CHANNEL MESSAGES, REACTIONS, PINS & NOTE SHARING
  // ============================================================================

  async getChannelMessages(
    userId: string,
    channelId: string,
    query?: { limit?: number; before?: string },
  ) {
    const channel = await this.prisma.communityChannel.findUnique({
      where: { id: channelId },
      include: {
        community: {
          select: { id: true, name: true, zone: true, schoolId: true, isOfficialSchoolHub: true },
        },
      },
    });
    if (!channel) throw new NotFoundException('Channel not found.');

    // Auto-enroll member cleanly when opening any public Cross-School or own-Campus channel
    await this.joinCommunity(userId, channel.communityId);

    const take = Math.min(Math.max(Number(query?.limit) || 40, 10), 60);
    const where: any = { channelId };
    if (query?.before) {
      const beforeDate = new Date(query.before);
      if (!isNaN(beforeDate.getTime())) {
        where.createdAt = { lt: beforeDate };
      }
    }

    const [messages, pinnedMessages] = await Promise.all([
      this.prisma.communityMessage.findMany({
        where,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: { select: SENDER_SELECT },
          replyTo: {
            select: {
              id: true,
              content: true,
              sender: { select: { id: true, fullName: true } },
            },
          },
        },
      }),
      this.prisma.communityMessage.findMany({
        where: { channelId, isPinned: true },
        take: 3,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: { select: { id: true, fullName: true } },
        },
      }),
    ]);

    return {
      channel: {
        id: channel.id,
        name: channel.name,
        topic: channel.topic,
        channelType: channel.channelType,
        isReadOnlyForStudents: channel.isReadOnlyForStudents,
        community: channel.community,
      },
      pinnedMessages,
      messages: messages.reverse(),
      hasMore: messages.length === take,
    };
  }

  async sendChannelMessage(userId: string, channelId: string, dto: SendChannelMessageDto) {
    const [channel, user] = await Promise.all([
      this.prisma.communityChannel.findUnique({
        where: { id: channelId },
        include: { community: { select: { id: true, zone: true, schoolId: true } } },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, schoolId: true },
      }),
    ]);

    if (!channel || !user) throw new NotFoundException('Channel not found.');

    if (channel.isReadOnlyForStudents && user.role === 'STUDENT') {
      throw new ForbiddenException(
        'Only School Admins and Educators can post in this announcements channel.',
      );
    }

    if (dto.attachmentType === 'NOTE') {
      throw new BadRequestException(
        'Class or course notes cannot be uploaded here. Please upload a document or image from your local device instead.',
      );
    }

    await this.joinCommunity(userId, channel.communityId);

    const message = await this.prisma.communityMessage.create({
      data: {
        channelId,
        senderId: userId,
        content: dto.content.trim(),
        attachmentType: dto.attachmentType || null,
        attachmentId: dto.attachmentId || null,
        attachmentMeta: dto.attachmentMeta || undefined,
        replyToId: dto.replyToId || null,
      },
      include: {
        sender: { select: SENDER_SELECT },
        replyTo: {
          select: {
            id: true,
            content: true,
            sender: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    this.gateway.emitChannelMessage(channelId, message);

    // Notify replied-to user when offline on the communities socket
    if (
      message.replyTo?.sender?.id &&
      message.replyTo.sender.id !== userId &&
      !this.gateway.isUserOnline(message.replyTo.sender.id)
    ) {
      try {
        void this.notifications.dispatchNotification({
          userId: message.replyTo.sender.id,
          schoolId: channel.community.schoolId || undefined,
          title: `${message.sender?.fullName || 'Someone'} replied in #${channel.name} 💬`,
          body: message.content.slice(0, 120),
          category: 'COMMUNITY',
          deepLink: `/communities?channelId=${channelId}`,
          dataJson: {
            channelId,
            communityId: channel.communityId,
            messageId: message.id,
            type: 'CHANNEL_REPLY',
          },
          channels: { inApp: true, push: true, email: false },
        });
      } catch {
        // Non-blocking
      }
    }

    // Broadcast push + in-app alert for Official Announcements channels
    if (channel.channelType === 'ANNOUNCEMENTS') {
      void this.prisma.communityMember
        .findMany({
          where: { communityId: channel.communityId, userId: { not: userId } },
          select: { userId: true },
          take: 250,
        })
        .then((members) => {
          for (const m of members) {
            if (this.gateway.isUserOnline(m.userId)) continue;
            void this.notifications
              .dispatchNotification({
                userId: m.userId,
                schoolId: channel.community.schoolId || undefined,
                title: `📢 #${channel.name} Announcement`,
                body: `${message.sender?.fullName || 'Campus Staff'}: ${message.content.slice(0, 110)}`,
                category: 'SCHOOL',
                deepLink: `/communities?channelId=${channelId}`,
                dataJson: {
                  channelId,
                  communityId: channel.communityId,
                  messageId: message.id,
                  type: 'CHANNEL_ANNOUNCEMENT',
                },
                channels: { inApp: true, push: true, email: false },
              })
              .catch(() => {});
          }
        })
        .catch(() => {});
    }

    return message;
  }

  async toggleMessageReaction(userId: string, messageId: string, emoji: string) {
    const msg = await this.prisma.communityMessage.findUnique({
      where: { id: messageId },
      select: { id: true, channelId: true, reactionsJson: true },
    });
    if (!msg) throw new NotFoundException('Message not found.');

    const reactions: Record<string, string[]> =
      msg.reactionsJson && typeof msg.reactionsJson === 'object'
        ? { ...(msg.reactionsJson as Record<string, string[]>) }
        : {};

    const cleanEmoji = emoji.trim();
    const list = Array.isArray(reactions[cleanEmoji]) ? [...reactions[cleanEmoji]] : [];
    const idx = list.indexOf(userId);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push(userId);
    }
    if (list.length === 0) {
      delete reactions[cleanEmoji];
    } else {
      reactions[cleanEmoji] = list;
    }

    const updated = await this.prisma.communityMessage.update({
      where: { id: messageId },
      data: { reactionsJson: reactions },
      include: {
        sender: { select: SENDER_SELECT },
        replyTo: {
          select: {
            id: true,
            content: true,
            sender: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    this.gateway.emitChannelMessageUpdated(msg.channelId, updated);
    return updated;
  }

  async togglePinMessage(userId: string, messageId: string) {
    const [msg, user] = await Promise.all([
      this.prisma.communityMessage.findUnique({
        where: { id: messageId },
        include: { channel: { select: { communityId: true } } },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    ]);
    if (!msg) throw new NotFoundException('Message not found.');

    const member = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: msg.channel.communityId, userId } },
    });

    const canPin =
      member?.role === 'ADMIN' ||
      member?.role === 'MODERATOR' ||
      user?.role === 'SCHOOL_ADMIN' ||
      user?.role === 'TEACHER' ||
      user?.role === 'SUPER_ADMIN';

    if (!canPin) {
      throw new ForbiddenException('Only moderators, educators, or admins can pin messages.');
    }

    const updated = await this.prisma.communityMessage.update({
      where: { id: messageId },
      data: { isPinned: !msg.isPinned },
      include: {
        sender: { select: SENDER_SELECT },
        replyTo: {
          select: {
            id: true,
            content: true,
            sender: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    this.gateway.emitChannelMessageUpdated(msg.channelId, updated);
    return updated;
  }

  async deleteChannelMessage(userId: string, messageId: string) {
    const [msg, user] = await Promise.all([
      this.prisma.communityMessage.findUnique({
        where: { id: messageId },
        select: { id: true, channelId: true, senderId: true },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    ]);
    if (!msg) throw new NotFoundException('Message not found.');

    const canDelete =
      msg.senderId === userId ||
      user?.role === 'SCHOOL_ADMIN' ||
      user?.role === 'SUPER_ADMIN';
    if (!canDelete) {
      throw new ForbiddenException('You can only delete your own messages.');
    }

    await this.prisma.communityMessage.delete({ where: { id: messageId } });
    this.gateway.emitChannelMessageDeleted(msg.channelId, messageId);
    return { deleted: true, messageId };
  }

  // ============================================================================
  // 4. CROSS-SCHOOL & CAMPUS 1v1 DIRECT MESSAGES (DMs) + PEER DISCOVERY
  // ============================================================================

  async discoverPeers(
    userId: string,
    query?: { search?: string; scope?: 'ALL' | 'MY_CAMPUS' | 'OTHER_SCHOOLS' },
  ) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, schoolId: true },
    });
    if (!me) throw new NotFoundException('User not found');

    const where: any = {
      id: { not: userId },
      role: { not: 'SUPER_ADMIN' },
    };

    if (query?.scope === 'MY_CAMPUS' && me.schoolId) {
      where.schoolId = me.schoolId;
    } else if (query?.scope === 'OTHER_SCHOOLS' && me.schoolId) {
      where.OR = [{ schoolId: null }, { schoolId: { not: me.schoolId } }];
    }

    if (query?.search?.trim()) {
      const q = query.search.trim();
      where.AND = [
        {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { loginId: { contains: q, mode: 'insensitive' } },
            { school: { name: { contains: q, mode: 'insensitive' } } },
            { studentProfile: { department: { name: { contains: q, mode: 'insensitive' } } } },
          ],
        },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      take: 35,
      orderBy: [{ fullName: 'asc' }],
      select: {
        id: true,
        fullName: true,
        role: true,
        avatarUrl: true,
        schoolId: true,
        school: {
          select: { id: true, name: true, schoolCode: true, institutionType: true },
        },
        studentProfile: {
          select: {
            level: true,
            department: { select: { name: true } },
            schoolClass: { select: { name: true } },
          },
        },
      },
    });

    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName || 'StudentSpark Member',
      role: u.role,
      avatarUrl: u.avatarUrl,
      schoolName: u.school?.name || 'Independent Learner',
      schoolCode: u.school?.schoolCode || 'IND',
      isSameCampus: !!me.schoolId && u.schoolId === me.schoolId,
      levelOrClass: u.studentProfile?.schoolClass?.name || u.studentProfile?.level || null,
      departmentName: u.studentProfile?.department?.name || null,
      isOnline: this.gateway.isUserOnline(u.id),
    }));
  }

  async listDmConversations(userId: string) {
    const [conversations, unreadGroups] = await Promise.all([
      this.prisma.directConversation.findMany({
        where: {
          OR: [{ participantAId: userId }, { participantBId: userId }],
        },
        include: {
          participantA: { select: SENDER_SELECT },
          participantB: { select: SENDER_SELECT },
        },
        orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
        take: 50,
      }),
      this.prisma.directMessage.groupBy({
        by: ['conversationId'],
        where: {
          senderId: { not: userId },
          readAt: null,
          conversation: {
            OR: [{ participantAId: userId }, { participantBId: userId }],
          },
        },
        _count: { id: true },
      }),
    ]);

    const unreadMap = new Map(unreadGroups.map((g) => [g.conversationId, g._count.id]));

    return conversations.map((c) => {
      const peer = c.participantAId === userId ? c.participantB : c.participantA;
      return {
        id: c.id,
        peer: {
          ...peer,
          isOnline: this.gateway.isUserOnline(peer.id),
        },
        lastMessageText: c.lastMessageText,
        lastMessageAt: c.lastMessageAt,
        lastSenderId: c.lastSenderId,
        unreadCount: unreadMap.get(c.id) || 0,
      };
    });
  }

  async startOrGetDm(userId: string, recipientId: string) {
    if (userId === recipientId) {
      throw new BadRequestException('You cannot start a direct conversation with yourself.');
    }
    const recipient = await this.prisma.user.findUnique({
      where: { id: recipientId },
      select: SENDER_SELECT,
    });
    if (!recipient) throw new NotFoundException('Recipient user not found.');

    // Canonical ordering guarantees 1 unique thread per pair
    const [participantAId, participantBId] =
      userId < recipientId ? [userId, recipientId] : [recipientId, userId];

    const conversation = await this.prisma.directConversation.upsert({
      where: { participantAId_participantBId: { participantAId, participantBId } },
      update: {},
      create: { participantAId, participantBId },
      include: {
        participantA: { select: SENDER_SELECT },
        participantB: { select: SENDER_SELECT },
      },
    });

    const peer =
      conversation.participantAId === userId ? conversation.participantB : conversation.participantA;

    return {
      id: conversation.id,
      peer: {
        ...peer,
        isOnline: this.gateway.isUserOnline(peer.id),
      },
      lastMessageText: conversation.lastMessageText,
      lastMessageAt: conversation.lastMessageAt,
      unreadCount: 0,
    };
  }

  async getDmMessages(
    userId: string,
    conversationId: string,
    query?: { limit?: number; before?: string },
  ) {
    const conversation = await this.prisma.directConversation.findUnique({
      where: { id: conversationId },
      include: {
        participantA: { select: SENDER_SELECT },
        participantB: { select: SENDER_SELECT },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    if (conversation.participantAId !== userId && conversation.participantBId !== userId) {
      throw new ForbiddenException('You are not a participant in this conversation.');
    }

    const take = Math.min(Math.max(Number(query?.limit) || 40, 10), 60);
    const where: any = { conversationId };
    if (query?.before) {
      const beforeDate = new Date(query.before);
      if (!isNaN(beforeDate.getTime())) where.createdAt = { lt: beforeDate };
    }

    const [messages] = await Promise.all([
      this.prisma.directMessage.findMany({
        where,
        take,
        orderBy: { createdAt: 'desc' },
        include: { sender: { select: SENDER_SELECT } },
      }),
      // Mark incoming messages read on open
      this.prisma.directMessage.updateMany({
        where: { conversationId, senderId: { not: userId }, readAt: null },
        data: { readAt: new Date() },
      }),
    ]);

    this.gateway.emitDmRead(conversationId, userId);

    const peer =
      conversation.participantAId === userId ? conversation.participantB : conversation.participantA;

    return {
      conversationId,
      peer: {
        ...peer,
        isOnline: this.gateway.isUserOnline(peer.id),
      },
      messages: messages.reverse(),
      hasMore: messages.length === take,
    };
  }

  async sendDmMessage(userId: string, conversationId: string, dto: SendDmMessageDto) {
    const conversation = await this.prisma.directConversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    if (conversation.participantAId !== userId && conversation.participantBId !== userId) {
      throw new ForbiddenException('You are not a participant in this conversation.');
    }

    if (dto.attachmentType === 'NOTE') {
      throw new BadRequestException(
        'Class or course notes cannot be uploaded here. Please upload a document or image from your local device instead.',
      );
    }

    const content = dto.content.trim();
    const message = await this.prisma.directMessage.create({
      data: {
        conversationId,
        senderId: userId,
        content,
        attachmentType: dto.attachmentType || null,
        attachmentId: dto.attachmentId || null,
        attachmentMeta: dto.attachmentMeta || undefined,
      },
      include: { sender: { select: SENDER_SELECT } },
    });

    await this.prisma.directConversation.update({
      where: { id: conversationId },
      data: {
        lastMessageText: content.slice(0, 140),
        lastMessageAt: message.createdAt,
        lastSenderId: userId,
      },
    });

    this.gateway.emitDmMessage(
      conversationId,
      conversation.participantAId,
      conversation.participantBId,
      message,
    );

    const recipientId =
      conversation.participantAId === userId
        ? conversation.participantBId
        : conversation.participantAId;

    // Notify offline recipient via 3-channel notification system with direct DM deep link
    if (!this.gateway.isUserOnline(recipientId)) {
      try {
        void this.notifications.dispatchNotification({
          userId: recipientId,
          title: `New message from ${message.sender?.fullName || 'Study Peer'} 💬`,
          body: content.slice(0, 100),
          category: 'COMMUNITY',
          deepLink: `/communities?tab=DMS&dmId=${conversationId}`,
          dataJson: {
            conversationId,
            senderId: userId,
            type: 'DM',
          },
          channels: { inApp: true, push: true, email: false },
        });
      } catch {
        // Non-blocking
      }
    }

    return message;
  }

  async uploadChatMedia(userId: string, dto: UploadCommunityMediaDto) {
    const cleanB64 = dto.base64.replace(/^data:[^;]+;base64,/, '').trim();
    if (!cleanB64) {
      throw new BadRequestException('File data is empty.');
    }

    const buffer = Buffer.from(cleanB64, 'base64');
    const maxBytes = 12 * 1024 * 1024;
    if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) {
      throw new BadRequestException('File must be under 12 MB.');
    }

    const safeFileName = `${Date.now()}_${userId.slice(0, 6)}_${dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const uploaded =
      dto.kind === 'IMAGE'
        ? await this.storage.uploadImageBuffer(buffer, safeFileName, 'community-images')
        : await this.storage.uploadDocumentBuffer(buffer, safeFileName, 'community-docs');

    const resolvedUrl =
      dto.kind === 'DOCUMENT' && /\.pdf$/i.test(dto.fileName)
        ? this.storage.getAccessiblePdfUrl(uploaded.publicUrl) || uploaded.publicUrl
        : uploaded.publicUrl;

    return {
      url: resolvedUrl,
      filePath: uploaded.filePath,
      fileName: dto.fileName,
      mimeType: dto.mimeType || (dto.kind === 'IMAGE' ? 'image/jpeg' : 'application/octet-stream'),
      sizeBytes: buffer.byteLength,
      kind: dto.kind,
    };
  }

  async getShareableStudyNotes(userId: string) {
    return this.prisma.note.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        courseCode: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}
