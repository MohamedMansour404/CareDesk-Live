import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import mongoose from 'mongoose';
import { User, UserSchema } from '../users/schemas/user.schema.js';
import {
  Conversation,
  ConversationSchema,
} from '../conversations/schemas/conversation.schema.js';
import { Message, MessageSchema } from '../messages/schemas/message.schema.js';
import {
  Evaluation,
  EvaluationSchema,
} from '../evaluation/schemas/evaluation.schema.js';

type CliArgs = {
  force?: boolean;
  help?: boolean;
};

type DeleteSummary = {
  users: number;
  conversations: number;
  messages: number;
  evaluations: number;
  relatedCollections: Array<{ name: string; deleted: number }>;
};

const CONFIRMATION_TEXT = 'CONFIRM RESET';

function loadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--force') {
      args.force = true;
    }
  }

  return args;
}

function printUsage(): void {
  console.log('\nReset CareDesk database (DANGEROUS)');
  console.log('Usage: npm run db:reset [-- --force]');
  console.log('Safety checks:');
  console.log('  1) Only runs when NODE_ENV=development');
  console.log(
    `  2) Requires typing exactly "${CONFIRMATION_TEXT}" (unless --force)`,
  );
  console.log('');
}

async function confirmReset(force?: boolean): Promise<void> {
  if (force) return;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('\nThis will permanently delete ALL application data.');
    const answer = await rl.question(
      `Type "${CONFIRMATION_TEXT}" to continue: `,
    );

    if (answer.trim() !== CONFIRMATION_TEXT) {
      throw new Error('Confirmation mismatch. Reset aborted.');
    }
  } finally {
    rl.close();
  }
}

async function wipeCollection(model: {
  deleteMany: (
    filter: Record<string, never>,
  ) => Promise<{ deletedCount?: number }>;
}): Promise<number> {
  const result = await model.deleteMany({});
  return result.deletedCount ?? 0;
}

async function main(): Promise<void> {
  loadEnvFile();

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== 'development') {
    throw new Error(
      `Database reset is blocked because NODE_ENV is "${nodeEnv ?? 'undefined'}". It must be "development".`,
    );
  }

  await confirmReset(args.force);

  const mongoUri =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/caredesk';

  const UserModel = mongoose.model(User.name, UserSchema);
  const ConversationModel = mongoose.model(
    Conversation.name,
    ConversationSchema,
  );
  const MessageModel = mongoose.model(Message.name, MessageSchema);
  const EvaluationModel = mongoose.model(Evaluation.name, EvaluationSchema);

  await mongoose.connect(mongoUri);

  try {
    const summary: DeleteSummary = {
      users: await wipeCollection(UserModel),
      conversations: await wipeCollection(ConversationModel),
      messages: await wipeCollection(MessageModel),
      evaluations: await wipeCollection(EvaluationModel),
      relatedCollections: [],
    };

    const knownCollections = new Set(
      [
        UserModel.collection.name,
        ConversationModel.collection.name,
        MessageModel.collection.name,
        EvaluationModel.collection.name,
      ].map((name) => name.toLowerCase()),
    );

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('No active database connection found.');
    }

    const allCollections = await db.listCollections().toArray();

    for (const coll of allCollections) {
      const name = coll.name;
      if (name.startsWith('system.')) continue;
      if (knownCollections.has(name.toLowerCase())) continue;

      const result = await db.collection(name).deleteMany({});
      summary.relatedCollections.push({
        name,
        deleted: result.deletedCount ?? 0,
      });
    }

    console.log(`Users deleted: ${summary.users}`);
    console.log(`Conversations deleted: ${summary.conversations}`);
    console.log(`Messages deleted: ${summary.messages}`);
    console.log(`Evaluations deleted: ${summary.evaluations}`);

    if (summary.relatedCollections.length > 0) {
      console.log('\nRelated collections cleared:');
      for (const item of summary.relatedCollections) {
        console.log(`- ${item.name}: ${item.deleted}`);
      }
    }

    console.log('\nDatabase reset completed successfully.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nDatabase reset failed: ${message}`);
  process.exitCode = 1;
});
