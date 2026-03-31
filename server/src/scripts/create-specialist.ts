import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { UserRole } from '../common/constants.js';
import { User, UserSchema } from '../users/schemas/user.schema.js';

type CliArgs = {
  email?: string;
  password?: string;
  name?: string;
  specialization?: string;
  help?: boolean;
};

const DEFAULT_SPECIALIZATION = 'General Care';

function loadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return;
  }

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

    if (!arg.startsWith('--')) continue;

    const [rawKey, ...rest] = arg.slice(2).split('=');
    const value = rest.join('=').trim();
    const key = rawKey.trim();

    if (!key) continue;
    if (key === 'email') args.email = value;
    if (key === 'password') args.password = value;
    if (key === 'name') args.name = value;
    if (key === 'specialization') args.specialization = value;
  }

  return args;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongPassword(password: string): boolean {
  if (password.length < 10) return false;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  return hasUpper && hasLower && hasNumber && hasSpecial;
}

function validateInput(input: Required<Omit<CliArgs, 'help'>>): void {
  if (!isValidEmail(input.email)) {
    throw new Error('Invalid email format.');
  }

  if (!isStrongPassword(input.password)) {
    throw new Error(
      'Password must be at least 10 characters and include uppercase, lowercase, number, and special character.',
    );
  }

  if (input.name.trim().length < 2) {
    throw new Error('Name must be at least 2 characters.');
  }

  if (input.specialization.trim().length < 2) {
    throw new Error('Specialization must be at least 2 characters.');
  }
}

function printUsage(): void {
  console.log('\nCreate Care Specialist account');
  console.log(
    'Usage: npm run create:specialist -- --email=spec@caredesk.local --password=StrongPass123! --name="Spec User" [--specialization="Cardiology"]',
  );
  console.log('If args are missing, interactive mode will prompt for input.\n');
}

async function promptInteractive(initial: CliArgs): Promise<CliArgs> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const email =
      initial.email?.trim() ||
      (await rl.question('Email: ')).trim().toLowerCase();
    const password =
      initial.password?.trim() || (await rl.question('Password: ')).trim();
    const name = initial.name?.trim() || (await rl.question('Name: ')).trim();
    const specialization =
      initial.specialization?.trim() ||
      (
        await rl.question(
          `Specialization (default: ${DEFAULT_SPECIALIZATION}): `,
        )
      ).trim() ||
      DEFAULT_SPECIALIZATION;

    return { email, password, name, specialization };
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  loadEnvFile();

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const needsInteractive = !args.email || !args.password || !args.name;
  const input = needsInteractive ? await promptInteractive(args) : args;

  const normalized = {
    email: input.email?.trim().toLowerCase() || '',
    password: input.password?.trim() || '',
    name: input.name?.trim() || '',
    specialization: input.specialization?.trim() || DEFAULT_SPECIALIZATION,
  };

  validateInput(normalized);

  const mongoUri =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/caredesk';

  const UserModel = mongoose.model(User.name, UserSchema);

  await mongoose.connect(mongoUri);

  try {
    const existing = await UserModel.findOne({
      email: normalized.email,
    }).lean();
    if (existing) {
      throw new Error(`A user with email ${normalized.email} already exists.`);
    }

    const passwordHash = await bcrypt.hash(normalized.password, 12);

    const specialist = new UserModel({
      email: normalized.email,
      password: passwordHash,
      name: normalized.name,
      specialization: normalized.specialization,
      role: UserRole.AGENT,
      isOnline: false,
      activeConversations: 0,
    });
    const created = await specialist.save();

    console.log('\nCare Specialist account created successfully.');
    console.log(`Email: ${created.email}`);
    console.log(`Role: ${created.role} (Care Specialist)`);
    console.log(`Name: ${created.name}`);
    console.log(
      `Specialization: ${created.specialization || DEFAULT_SPECIALIZATION}`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFailed to create Care Specialist: ${message}`);
  process.exitCode = 1;
});
