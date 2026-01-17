/**
 * Script to manage Supabase environment configurations
 *
 * Supports both LOCAL and REMOTE Supabase configurations in a single .env file.
 * One environment is active (uncommented) at a time, while the other is stored
 * but commented out for easy switching.
 *
 * Commands:
 *   pnpm run env:local   - Activate local Supabase (fetches credentials from running instance)
 *   pnpm run env:remote  - Activate remote Supabase (uses stored credentials)
 *   pnpm run env:status  - Show which environment is currently active
 *
 * Prerequisites for local mode:
 * - Local Supabase must be running (npx supabase start)
 * - Supabase commands are run from root directory (where supabase/ folder is)
 *
 * Prerequisites for remote mode:
 * - Remote credentials must already be stored in the .env file
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// .env file is in cribbage-core directory
const ENV_FILE = path.join(process.cwd(), '.env');
// Supabase commands should be run from root directory (where supabase/ folder is)
const ROOT_DIR = path.join(process.cwd(), '..');

type Environment = 'local' | 'remote';

interface SupabaseCredentials {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

// Markers used in .env file to identify sections
const MARKERS = {
  activeEnvStart: '# === ACTIVE SUPABASE ENVIRONMENT:',
  localStart: '# --- LOCAL Supabase (from `npx supabase start`) ---',
  remoteStart: '# --- REMOTE Supabase (hosted) ---',
  otherStart: '# --- Other Supabase Settings ---',
} as const;

// Default "other" settings that should always be present
const DEFAULT_OTHER_SETTINGS = [
  'SUPABASE_AUTH_ENABLED=true',
  'SUPABASE_LOBBIES_ENABLED=true',
];

const SUPABASE_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

function getLocalSupabaseCredentials(): SupabaseCredentials {
  try {
    // Run supabase status from root directory where supabase/ folder is located
    const output = execSync('npx supabase status', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: ROOT_DIR,
    });

    const lines = output.split('\n');

    // Try new format first (table format)
    const getValueFromTable = (label: string): string | null => {
      const regex = new RegExp(`│\\s+${label}[^│]*│\\s+([^│]+)`, 'i');
      for (const line of lines) {
        const match = line.match(regex);
        if (match) {
          return match[1].trim();
        }
      }
      return null;
    };

    // Try old format (key: value format)
    const getValueFromKeyValue = (prefix: string): string | null => {
      const line = lines.find((l) => l.trim().startsWith(prefix));
      if (!line) return null;
      const match = line.match(new RegExp(`${prefix}:\\s*(.+)`));
      return match ? match[1].trim() : null;
    };

    const url =
      getValueFromTable('Project URL') || getValueFromKeyValue('API URL');
    const anonKey =
      getValueFromTable('Publishable') || getValueFromKeyValue('anon key');
    const serviceRoleKey =
      getValueFromTable('Secret') || getValueFromKeyValue('service_role key');

    if (!url || !anonKey || !serviceRoleKey) {
      throw new Error(
        'Could not parse Supabase status output. Missing required fields.',
      );
    }

    return { url, anonKey, serviceRoleKey };
  } catch (error) {
    console.error(
      '❌ Failed to get Supabase status. Is local Supabase running?',
    );
    console.error('   Run: npx supabase start (from repo root)');
    if (error instanceof Error) {
      console.error(`   Error: ${error.message}`);
    }
    process.exit(1);
    throw error; // TypeScript: unreachable, but satisfies return type
  }
}

interface ParsedEnvFile {
  preamble: string[]; // Lines before Supabase section
  localCredentials: SupabaseCredentials | null;
  remoteCredentials: SupabaseCredentials | null;
  activeEnv: Environment | null;
  otherSupabaseSettings: string[]; // SUPABASE_AUTH_ENABLED, SUPABASE_LOBBIES_ENABLED, etc.
}

function parseEnvFile(): ParsedEnvFile {
  const result: ParsedEnvFile = {
    preamble: [],
    localCredentials: null,
    remoteCredentials: null,
    activeEnv: null,
    otherSupabaseSettings: [],
  };

  if (!fs.existsSync(ENV_FILE)) {
    // Return defaults with standard preamble
    result.preamble = [
      '# Cribbage Core Environment Variables',
      '',
      '# Server Configuration',
      'PORT=3002',
      'WEB_APP_ORIGIN=http://localhost:8081',
      'WEBSOCKET_AUTH_TOKEN="a-dubs-mac-token"',
      'OVERRIDE_START_SCORE=',
      'ENABLE_RESTART_GAME=true',
      '',
    ];
    result.otherSupabaseSettings = [
      'SUPABASE_AUTH_ENABLED=true',
      'SUPABASE_LOBBIES_ENABLED=true',
    ];
    return result;
  }

  const content = fs.readFileSync(ENV_FILE, 'utf-8');
  const lines = content.split('\n');

  // Check if this is a new-format file (has our markers)
  const hasNewFormat = lines.some(
    (l) =>
      l.includes(MARKERS.activeEnvStart) ||
      l.includes(MARKERS.localStart) ||
      l.includes(MARKERS.remoteStart),
  );

  if (hasNewFormat) {
    return parseNewFormatEnvFile(lines);
  } else {
    return parseLegacyEnvFile(lines);
  }
}

function parseNewFormatEnvFile(lines: string[]): ParsedEnvFile {
  const result: ParsedEnvFile = {
    preamble: [],
    localCredentials: null,
    remoteCredentials: null,
    activeEnv: null,
    otherSupabaseSettings: [],
  };

  let section: 'preamble' | 'local' | 'remote' | 'other' = 'preamble';

  for (const line of lines) {
    // Check for section markers
    if (line.includes(MARKERS.activeEnvStart)) {
      if (line.toLowerCase().includes('local')) {
        result.activeEnv = 'local';
      } else if (line.toLowerCase().includes('remote')) {
        result.activeEnv = 'remote';
      }
      continue;
    }

    if (line.includes(MARKERS.localStart)) {
      section = 'local';
      continue;
    }

    if (line.includes(MARKERS.remoteStart)) {
      section = 'remote';
      continue;
    }

    if (line.includes(MARKERS.otherStart)) {
      section = 'other';
      continue;
    }

    // Parse line content
    const trimmed = line.trim();
    const isComment = trimmed.startsWith('#');
    const actualLine = isComment ? trimmed.slice(1).trim() : trimmed;

    // Check if it's a SUPABASE key line
    const supabaseKeyMatch = actualLine.match(/^(SUPABASE_\w+)=(.*)$/);

    if (supabaseKeyMatch) {
      const [, key, value] = supabaseKeyMatch;

      if (section === 'local') {
        if (!result.localCredentials) {
          result.localCredentials = { url: '', anonKey: '', serviceRoleKey: '' };
        }
        if (key === 'SUPABASE_URL') result.localCredentials.url = value;
        if (key === 'SUPABASE_ANON_KEY') result.localCredentials.anonKey = value;
        if (key === 'SUPABASE_SERVICE_ROLE_KEY')
          result.localCredentials.serviceRoleKey = value;
      } else if (section === 'remote') {
        if (!result.remoteCredentials) {
          result.remoteCredentials = {
            url: '',
            anonKey: '',
            serviceRoleKey: '',
          };
        }
        if (key === 'SUPABASE_URL') result.remoteCredentials.url = value;
        if (key === 'SUPABASE_ANON_KEY')
          result.remoteCredentials.anonKey = value;
        if (key === 'SUPABASE_SERVICE_ROLE_KEY')
          result.remoteCredentials.serviceRoleKey = value;
      } else if (
        section === 'other' ||
        !SUPABASE_KEYS.includes(key as (typeof SUPABASE_KEYS)[number])
      ) {
        // Other SUPABASE_ settings (in 'other' section or not credential keys)
        if (!result.otherSupabaseSettings.includes(actualLine)) {
          result.otherSupabaseSettings.push(actualLine);
        }
      }
    } else if (section === 'preamble') {
      // Non-Supabase lines in preamble
      if (
        !trimmed.includes('Supabase') &&
        !trimmed.startsWith('SUPABASE_') &&
        !trimmed.includes('===')
      ) {
        result.preamble.push(line);
      }
    }
  }

  // Clean up preamble (remove trailing empty lines)
  while (
    result.preamble.length > 0 &&
    result.preamble[result.preamble.length - 1].trim() === ''
  ) {
    result.preamble.pop();
  }

  return result;
}

function parseLegacyEnvFile(lines: string[]): ParsedEnvFile {
  const result: ParsedEnvFile = {
    preamble: [],
    localCredentials: null,
    remoteCredentials: null,
    activeEnv: null,
    otherSupabaseSettings: [],
  };

  let foundSupabaseSection = false;
  const currentCredentials: SupabaseCredentials = {
    url: '',
    anonKey: '',
    serviceRoleKey: '',
  };
  let hasCredentials = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if we hit the Supabase section
    if (
      trimmed.toLowerCase().includes('supabase') &&
      trimmed.startsWith('#') &&
      !trimmed.startsWith('# SUPABASE_')
    ) {
      foundSupabaseSection = true;
      continue;
    }

    // Parse SUPABASE_ keys
    const match = trimmed.match(/^(SUPABASE_\w+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      foundSupabaseSection = true;

      if (key === 'SUPABASE_URL') {
        currentCredentials.url = value;
        if (value) hasCredentials = true;
      } else if (key === 'SUPABASE_ANON_KEY') {
        currentCredentials.anonKey = value;
        if (value) hasCredentials = true;
      } else if (key === 'SUPABASE_SERVICE_ROLE_KEY') {
        currentCredentials.serviceRoleKey = value;
        if (value) hasCredentials = true;
      } else {
        // Other SUPABASE settings
        result.otherSupabaseSettings.push(trimmed);
      }
    } else if (!foundSupabaseSection) {
      result.preamble.push(line);
    }
  }

  // Determine if existing credentials are local or remote
  if (hasCredentials) {
    const isLocal =
      currentCredentials.url.includes('127.0.0.1') ||
      currentCredentials.url.includes('localhost');
    if (isLocal) {
      result.localCredentials = currentCredentials;
      result.activeEnv = 'local';
    } else {
      result.remoteCredentials = currentCredentials;
      result.activeEnv = 'remote';
    }
  }

  // Clean up preamble (remove trailing empty lines)
  while (
    result.preamble.length > 0 &&
    result.preamble[result.preamble.length - 1].trim() === ''
  ) {
    result.preamble.pop();
  }

  return result;
}

function generateEnvFile(
  parsed: ParsedEnvFile,
  activeEnv: Environment,
): string {
  const lines: string[] = [];

  // Add preamble
  lines.push(...parsed.preamble);
  lines.push('');

  // Add Supabase section header
  lines.push(
    `${MARKERS.activeEnvStart} ${activeEnv.toUpperCase()} ===`,
  );
  lines.push('');

  // Add LOCAL section
  lines.push(MARKERS.localStart);
  if (parsed.localCredentials) {
    const prefix = activeEnv === 'local' ? '' : '# ';
    lines.push(`${prefix}SUPABASE_URL=${parsed.localCredentials.url}`);
    lines.push(`${prefix}SUPABASE_ANON_KEY=${parsed.localCredentials.anonKey}`);
    lines.push(
      `${prefix}SUPABASE_SERVICE_ROLE_KEY=${parsed.localCredentials.serviceRoleKey}`,
    );
  } else {
    lines.push('# (no local credentials stored - run `pnpm run env:local`)');
  }
  lines.push('');

  // Add REMOTE section
  lines.push(MARKERS.remoteStart);
  if (parsed.remoteCredentials) {
    const prefix = activeEnv === 'remote' ? '' : '# ';
    lines.push(`${prefix}SUPABASE_URL=${parsed.remoteCredentials.url}`);
    lines.push(
      `${prefix}SUPABASE_ANON_KEY=${parsed.remoteCredentials.anonKey}`,
    );
    lines.push(
      `${prefix}SUPABASE_SERVICE_ROLE_KEY=${parsed.remoteCredentials.serviceRoleKey}`,
    );
  } else {
    lines.push(
      '# (no remote credentials stored - add them manually, then run `pnpm run env:remote`)',
    );
  }
  lines.push('');

  // Add other Supabase settings (always active)
  // Ensure defaults are present if missing
  const otherSettings = [...parsed.otherSupabaseSettings];
  for (const defaultSetting of DEFAULT_OTHER_SETTINGS) {
    const key = defaultSetting.split('=')[0];
    const hasKey = otherSettings.some((s) => s.startsWith(key + '='));
    if (!hasKey) {
      otherSettings.push(defaultSetting);
    }
  }

  lines.push(MARKERS.otherStart);
  lines.push(...otherSettings);

  return lines.join('\n') + '\n';
}

function activateLocal(): void {
  console.log('🔄 Fetching local Supabase credentials...\n');

  const localCreds = getLocalSupabaseCredentials();
  const parsed = parseEnvFile();

  // Update local credentials with fresh values
  parsed.localCredentials = localCreds;

  // Generate and write the file
  const content = generateEnvFile(parsed, 'local');
  fs.writeFileSync(ENV_FILE, content);

  console.log('✅ Activated LOCAL Supabase environment:');
  console.log(`   URL:         ${localCreds.url}`);
  console.log(`   Anon Key:    ${localCreds.anonKey.slice(0, 20)}...`);
  console.log(`   Service Key: ${localCreds.serviceRoleKey.slice(0, 20)}...`);

  if (parsed.remoteCredentials) {
    console.log('\n📦 Remote credentials preserved (commented out)');
  }
}

function activateRemote(): void {
  console.log('🔄 Switching to REMOTE Supabase environment...\n');

  const parsed = parseEnvFile();

  const remoteCreds = parsed.remoteCredentials;
  if (!remoteCreds || !remoteCreds.url) {
    console.error('❌ No remote credentials found in .env file.');
    console.error('');
    console.error('   To add remote credentials:');
    console.error(
      '   1. Edit .env and add your remote Supabase credentials under the REMOTE section',
    );
    console.error('   2. Run `pnpm run env:remote` again');
    console.error('');
    console.error('   Or manually add these lines to .env:');
    console.error(
      '   # SUPABASE_URL=https://your-project.supabase.co',
    );
    console.error('   # SUPABASE_ANON_KEY=your-anon-key');
    console.error('   # SUPABASE_SERVICE_ROLE_KEY=your-service-role-key');
    process.exit(1);
  }

  // Generate and write the file
  const content = generateEnvFile(parsed, 'remote');
  fs.writeFileSync(ENV_FILE, content);

  console.log('✅ Activated REMOTE Supabase environment:');
  console.log(`   URL:         ${remoteCreds.url}`);
  console.log(`   Anon Key:    ${remoteCreds.anonKey.slice(0, 20)}...`);
  console.log(`   Service Key: ${remoteCreds.serviceRoleKey.slice(0, 20)}...`);

  if (parsed.localCredentials) {
    console.log('\n📦 Local credentials preserved (commented out)');
  }
}

function showStatus(): void {
  const parsed = parseEnvFile();

  console.log('📊 Supabase Environment Status\n');

  if (parsed.activeEnv) {
    console.log(`   Active: ${parsed.activeEnv.toUpperCase()}`);
  } else {
    console.log('   Active: (unknown - run env:local or env:remote to set)');
  }

  console.log('');
  console.log(
    `   Local credentials:  ${parsed.localCredentials ? '✅ stored' : '❌ not stored'}`,
  );
  console.log(
    `   Remote credentials: ${parsed.remoteCredentials ? '✅ stored' : '❌ not stored'}`,
  );

  if (parsed.localCredentials) {
    console.log(`\n   Local URL: ${parsed.localCredentials.url}`);
  }
  if (parsed.remoteCredentials) {
    console.log(`   Remote URL: ${parsed.remoteCredentials.url}`);
  }
}

function main(): void {
  const command = process.argv[2] || 'local';

  switch (command) {
    case 'local':
      activateLocal();
      console.log(
        '\n✨ Done! Your .env is now configured for LOCAL development.',
      );
      break;

    case 'remote':
      activateRemote();
      console.log(
        '\n✨ Done! Your .env is now configured for REMOTE Supabase.',
      );
      break;

    case 'status':
      showStatus();
      break;

    default:
      console.error(`❌ Unknown command: ${command}`);
      console.error('');
      console.error('   Usage:');
      console.error('     pnpm run env:local   - Activate local Supabase');
      console.error('     pnpm run env:remote  - Activate remote Supabase');
      console.error('     pnpm run env:status  - Show current status');
      process.exit(1);
  }
}

main();
