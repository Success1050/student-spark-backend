import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Replaces Supabase 'notes' table queries (getAllNotes, getDetailsNotes, deleteNote).
 * Supports automatic non-production fallback note seeding (drops off in production).
 */
@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(private readonly prisma: PrismaService) {}

  private formatNote(note: {
    id: string;
    userId: string;
    schoolId: string | null;
    classId: string | null;
    subjectId: string | null;
    title: string;
    summary: string;
    courseCode: string;
    color: string;
    listsOfTopic: unknown;
    fileUrl: string | null;
    isClassNote: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const rawTopics = Array.isArray(note.listsOfTopic) ? note.listsOfTopic : [];
    const normalizedTopics = rawTopics.map((item: unknown, idx: number) => {
      if (typeof item === 'string') {
        return { id: idx + 1, topic: item, title: item, explanation: '' };
      }
      const obj = (item || {}) as Record<string, unknown>;
      return {
        id: Number(obj.id) || idx + 1,
        topic: String(obj.topic || obj.title || `Topic ${idx + 1}`),
        title: String(obj.topic || obj.title || `Topic ${idx + 1}`),
        explanation: String(obj.explanation || ''),
      };
    });

    return {
      ...note,
      user_id: note.userId,
      course_code: note.courseCode,
      file_url: note.fileUrl,
      ai_summary: note.summary,
      lists_of_topic: normalizedTopics,
      created_at: note.createdAt.toISOString(),
    };
  }

  private getFallbackDemoNote(userId = 'demo-user') {
    return {
      id: 'sample-csc201-note',
      userId,
      user_id: userId,
      schoolId: null,
      classId: null,
      subjectId: null,
      title: 'CSC 201: Data Structures, Algorithms & Computational Complexity',
      courseCode: 'CSC 201',
      course_code: 'CSC 201',
      color: '#6366f1',
      summary:
        'Comprehensive study notes on fundamental data structures and algorithmic efficiency. Covers asymptotic Big-O notation, linear structures (Arrays, Linked Lists, Stacks, Queues), and non-linear structures (Binary Search Trees, Hash Tables, and Graph traversal). Emphasizes practical problem-solving patterns, memory overhead, and exam-standard trace tables.',
      ai_summary:
        'Comprehensive study notes on fundamental data structures and algorithmic efficiency. Covers asymptotic Big-O notation, linear structures (Arrays, Linked Lists, Stacks, Queues), and non-linear structures (Binary Search Trees, Hash Tables, and Graph traversal). Emphasizes practical problem-solving patterns, memory overhead, and exam-standard trace tables.',
      fileUrl: null,
      file_url: null,
      isClassNote: false,
      lists_of_topic: [
        {
          id: 1,
          topic: 'Algorithmic Complexity & Big-O Notation',
          title: 'Algorithmic Complexity & Big-O Notation',
          explanation:
            'Big-O notation describes the worst-case asymptotic upper bound of execution time and auxiliary space as input size n approaches infinity. Key complexity orders from fastest to slowest: O(1) constant time (array index access, hash map lookup), O(log n) logarithmic (binary search), O(n) linear scan, O(n log n) linearithmic (MergeSort, HeapSort), O(n^2) quadratic (nested loops, BubbleSort), and O(2^n) exponential (recursive Fibonacci). Always evaluate both time and space trade-offs in semester exams.',
        },
        {
          id: 2,
          topic: 'Arrays vs. Singly & Doubly Linked Lists',
          title: 'Arrays vs. Singly & Doubly Linked Lists',
          explanation:
            'Arrays store elements in contiguous memory blocks, enabling O(1) random access via index arithmetic, but require fixed memory pre-allocation and expensive O(n) insertions and deletions. Linked lists allocate individual node objects connected by pointer references. Singly linked lists allow O(1) head insertion but require O(n) linear traversal to search. Doubly linked lists add a previous pointer, allowing bidirectional iteration at the cost of additional pointer memory overhead.',
        },
        {
          id: 3,
          topic: 'Stacks (LIFO), Queues (FIFO) & Practical Applications',
          title: 'Stacks (LIFO), Queues (FIFO) & Practical Applications',
          explanation:
            'Stacks adhere to the Last-In, First-Out principle supporting push, pop, and peek operations in O(1) time. Primary applications include function call stacks during recursion, balanced parenthesis parsing in compilers, and backtracking algorithms (DFS). Queues adhere to First-In, First-Out supporting enqueue and dequeue operations in O(1) time. Primary applications include CPU process scheduling, I/O print spoolers, and Breadth-First Search (BFS) graph traversals.',
        },
        {
          id: 4,
          topic: 'Binary Search Trees (BST) & Tree Traversals',
          title: 'Binary Search Trees (BST) & Tree Traversals',
          explanation:
            'A Binary Search Tree is a hierarchical node structure where every node has at most two children, maintaining the invariant: key(left) < key(node) < key(right). Average search, insert, and delete operations execute in O(log n) time, but can degrade to O(n) if the tree is unbalanced. The three fundamental depth-first traversals are: In-Order (Left, Root, Right — yields ascending sorted order), Pre-Order (Root, Left, Right — used for cloning tree structures), and Post-Order (Left, Right, Root — used for bottom-up node deletion).',
        },
        {
          id: 5,
          topic: 'Hash Tables & Collision Resolution Techniques',
          title: 'Hash Tables & Collision Resolution Techniques',
          explanation:
            'Hash tables store key-value associations, utilizing a deterministic hash function to compute array bucket indices for average-case O(1) retrieval. When two distinct keys compute to the identical index, a collision occurs. The two standard resolution strategies are: 1) Chaining, where each bucket points to a linked list of collided entries; and 2) Open Addressing, where collided items probe alternative available slots using Linear Probing (index + i), Quadratic Probing (index + c1*i + c2*i^2), or Double Hashing.',
        },
      ],
      createdAt: new Date(),
      created_at: new Date().toISOString(),
      updatedAt: new Date(),
    };
  }

  private async seedDefaultNotesIfEmpty(userId: string) {
    if (process.env.NODE_ENV === 'production') return;
    if (!userId) return;

    try {
      const count = await this.prisma.note.count({
        where: { userId },
      });
      if (count > 0) return;

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) return;

      const demo = this.getFallbackDemoNote(userId);
      await this.prisma.note.create({
        data: {
          userId,
          title: demo.title,
          courseCode: demo.courseCode,
          color: demo.color,
          summary: demo.summary,
          listsOfTopic: demo.lists_of_topic,
        },
      });
      this.logger.log(`Seeded demo note for user ${userId} (non-production environment)`);
    } catch (err: any) {
      this.logger.warn(`Could not seed demo note: ${err?.message || err}`);
    }
  }

  async findAllByUser(userId: string) {
    if (!userId) {
      if (process.env.NODE_ENV !== 'production') {
        return [this.getFallbackDemoNote('demo-user')];
      }
      return [];
    }

    await this.seedDefaultNotesIfEmpty(userId);

    const notes = await this.prisma.note.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (notes.length === 0 && process.env.NODE_ENV !== 'production') {
      return [this.getFallbackDemoNote(userId)];
    }

    return notes.map((n) => this.formatNote(n));
  }

  async findOneById(noteId: string) {
    const note = await this.prisma.note.findUnique({
      where: { id: String(noteId) },
    });

    if (!note) {
      if (
        process.env.NODE_ENV !== 'production' &&
        (noteId === 'sample-csc201-note' || noteId === 'demo-note' || noteId === 'default')
      ) {
        return this.getFallbackDemoNote('demo-user');
      }
      throw new NotFoundException('Note not found');
    }
    return this.formatNote(note);
  }

  async deleteNote(noteId: string) {
    if (noteId === 'sample-csc201-note') {
      return { deleted: true, id: noteId };
    }
    await this.prisma.note.delete({
      where: { id: String(noteId) },
    });
    return { deleted: true, id: noteId };
  }
}
