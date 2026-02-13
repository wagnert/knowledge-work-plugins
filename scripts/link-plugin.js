#!/usr/bin/env node

/**
 * Cowork Plugin Linker
 *
 * Links Cowork plugins (skills, commands) into an OpenCode-compatible
 * target directory via symlinks.
 *
 * Usage:
 *   cowork-link                         # Show help and available plugins
 *   cowork-link sales                   # Link the sales plugin
 *   cowork-link sales data              # Link multiple plugins
 *   cowork-link all                     # Link all available plugins
 *   cowork-link list                    # List available plugins
 *   cowork-link status                  # Show current link status
 *   cowork-link clean                   # Remove all symlinks
 *
 * Options:
 *   --target-dir=<path>                 # Override target directory
 *
 * Strategy: LAST WINS
 *   - When linking, existing symlinks are overwritten
 *   - Real files/directories are NOT overwritten (warning shown)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { discoverPlugins, getContentTypes } from '../lib/discovery.js';
import { getItemsToLink, createSymlink, normalizeContentType } from '../lib/linker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// PLUGINS_DIR is where this package lives (knowledge-work-plugins root)
const PLUGINS_DIR = path.resolve(__dirname, '..');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  console.log(`${colors.green}  + ${message}${colors.reset}`);
}

function logOverride(message) {
  console.log(`${colors.yellow}  ~ ${message} (overriding)${colors.reset}`);
}

function logSkipped(message) {
  console.log(`${colors.gray}  - ${message} (skipped)${colors.reset}`);
}

function logError(message) {
  console.log(`${colors.red}  ! ${message}${colors.reset}`);
}

// Runtime state (set in main())
let TARGET_DIR = null;
let PLUGINS = null;
let CONTENT_TYPES = null;

/**
 * Searches for opencode.json starting from current directory and going up.
 */
function findOpencodeConfig() {
  let currentDir = process.cwd();
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const configPath = path.join(currentDir, 'opencode.json');
    if (fs.existsSync(configPath)) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  return null;
}

/**
 * Resolves the target directory for linking.
 */
function resolveTargetDir(cliTargetDir) {
  if (cliTargetDir) {
    return {
      targetDir: path.resolve(process.cwd(), cliTargetDir),
      source: 'cli',
    };
  }

  const configDir = findOpencodeConfig();
  if (configDir) {
    return {
      targetDir: configDir,
      source: 'auto',
    };
  }

  return {
    targetDir: path.join(process.cwd(), '.opencode'),
    source: 'default',
  };
}

/**
 * Parses CLI arguments.
 */
function parseArgs(args) {
  let targetDir = null;
  const restArgs = [];

  for (const arg of args) {
    if (arg.startsWith('--target-dir=')) {
      targetDir = arg.substring('--target-dir='.length);
    } else if (arg === '--target-dir') {
      logError('--target-dir requires a value (use --target-dir=<path>)');
      process.exit(1);
    } else {
      restArgs.push(arg);
    }
  }

  return {
    commands: restArgs,
    targetDir,
  };
}

/**
 * Ensures target directory structure exists.
 */
function ensureDirectoryStructure() {
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  for (const dir of CONTENT_TYPES) {
    const targetType = normalizeContentType(dir);
    const dirPath = path.join(TARGET_DIR, targetType);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

/**
 * Links a single plugin.
 */
function linkPlugin(pluginName) {
  const descriptor = PLUGINS.get(pluginName);
  if (!descriptor) {
    logError(`Unknown plugin: ${pluginName}`);
    log(`Available plugins: ${Array.from(PLUGINS.keys()).join(', ')}`, 'yellow');
    return false;
  }

  log(`\nLinking ${pluginName} (v${descriptor.version})`, 'cyan');
  log(`  ${descriptor.description}`, 'gray');

  let linkedCount = 0;
  let overrideCount = 0;
  let skippedCount = 0;

  for (const type of descriptor.contentTypes) {
    const sourceDir = path.join(descriptor.rootDir, type);
    const targetType = normalizeContentType(type);
    const targetDir = path.join(TARGET_DIR, targetType);

    const items = getItemsToLink(sourceDir, type, targetDir, descriptor.pluginName);

    for (const item of items) {
      const { sourcePath, targetPath, displayName } = item;
      const result = createSymlink(sourcePath, targetPath);

      switch (result) {
        case 'created':
          logSuccess(displayName);
          linkedCount++;
          break;
        case 'overridden':
          logOverride(displayName);
          linkedCount++;
          overrideCount++;
          break;
        case 'skipped-same':
          skippedCount++;
          break;
        case 'skipped-real':
          logSkipped(`${displayName} (real file, not overriding)`);
          skippedCount++;
          break;
        case 'error':
          logError(`Failed to link ${displayName}`);
          break;
      }
    }
  }

  if (linkedCount > 0) {
    log(`  Linked: ${linkedCount} items`, 'green');
  }
  if (overrideCount > 0) {
    log(`  Overridden: ${overrideCount} items`, 'yellow');
  }
  if (skippedCount > 0) {
    log(`  Skipped: ${skippedCount} items`, 'gray');
  }

  return true;
}

/**
 * Scans the target directory to find which plugins are currently linked.
 */
function getLinkedPlugins() {
  const linkedPlugins = new Map();

  for (const type of CONTENT_TYPES) {
    const targetType = normalizeContentType(type);
    const dir = path.join(TARGET_DIR, targetType);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        if (fs.lstatSync(filePath).isSymbolicLink()) {
          const target = fs.readlinkSync(filePath);

          for (const [pluginName, descriptor] of PLUGINS.entries()) {
            if (target.includes(descriptor.rootDir)) {
              linkedPlugins.set(pluginName, descriptor);
              break;
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }
  }

  return linkedPlugins;
}

/**
 * Shows current link status.
 */
function showStatus() {
  log('\nCowork Plugin Status', 'bright');
  log('='.repeat(50), 'gray');
  log(`Target:  ${TARGET_DIR}`, 'gray');
  log(`Plugins: ${PLUGINS_DIR}`, 'gray');
  log('');

  const linkedPlugins = getLinkedPlugins();

  log(`Linked Plugins (${linkedPlugins.size}):`, 'cyan');
  if (linkedPlugins.size === 0) {
    log('  (none)', 'gray');
  } else {
    for (const [name] of linkedPlugins.entries()) {
      log(`  ${name}`, 'green');
    }
  }
  log('');

  for (const type of CONTENT_TYPES) {
    const targetType = normalizeContentType(type);
    const dir = path.join(TARGET_DIR, targetType);
    if (!fs.existsSync(dir)) {
      log(`${targetType}/: (not created)`, 'yellow');
      continue;
    }

    const files = fs.readdirSync(dir);
    const symlinks = files.filter((f) => {
      const filePath = path.join(dir, f);
      try {
        return fs.lstatSync(filePath).isSymbolicLink();
      } catch {
        return false;
      }
    });

    log(`${targetType}/: ${symlinks.length} symlinks`, 'cyan');

    for (const file of symlinks) {
      const filePath = path.join(dir, file);
      try {
        const target = fs.readlinkSync(filePath);
        let plugin = 'unknown';
        for (const [name, descriptor] of PLUGINS.entries()) {
          if (target.includes(descriptor.rootDir)) {
            plugin = name;
            break;
          }
        }
        const isDir = fs.statSync(filePath).isDirectory() ? '/' : '';
        log(`  ${file}${isDir} -> [${plugin}]`, 'gray');
      } catch {
        log(`  ${file} -> (broken link)`, 'red');
      }
    }
  }

  log('');
}

/**
 * Removes all symlinks from target directories.
 */
function cleanLinks() {
  log('\nCleaning symlinks...', 'yellow');
  let removedCount = 0;

  for (const type of CONTENT_TYPES) {
    const targetType = normalizeContentType(type);
    const dir = path.join(TARGET_DIR, targetType);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        if (fs.lstatSync(filePath).isSymbolicLink()) {
          fs.unlinkSync(filePath);
          log(`  - ${targetType}/${file}`, 'gray');
          removedCount++;
        }
      } catch {
        // Ignore errors
      }
    }
  }

  log(`\nRemoved ${removedCount} items`, 'green');
}

/**
 * Lists available plugins.
 */
function listPlugins() {
  log('\nAvailable Cowork Plugins', 'bright');
  log('='.repeat(50), 'gray');

  for (const [name, descriptor] of PLUGINS.entries()) {
    const skillCount = descriptor.contentTypes.includes('skills')
      ? fs.readdirSync(path.join(descriptor.rootDir, 'skills')).filter((f) => {
          return fs.statSync(path.join(descriptor.rootDir, 'skills', f)).isDirectory();
        }).length
      : 0;
    const cmdCount = descriptor.contentTypes.includes('commands')
      ? fs.readdirSync(path.join(descriptor.rootDir, 'commands')).filter((f) => f.endsWith('.md')).length
      : 0;

    log(`\n${colors.cyan}${name}${colors.reset} (v${descriptor.version})`);
    log(`  ${descriptor.description}`, 'gray');
    log(`  ${skillCount} skills, ${cmdCount} commands`, 'gray');
  }

  log(`\n${PLUGINS.size} plugins available`, 'gray');
  log('');
}

/**
 * Shows help text.
 */
function showHelp() {
  log('\nCowork Plugin Linker', 'bright');
  log('='.repeat(50), 'gray');
  log('');
  log('Usage:', 'cyan');
  log('  cowork-link <plugin> [<plugin2> ...]   Link specific plugins');
  log('  cowork-link all                        Link all plugins');
  log('  cowork-link list                       List available plugins');
  log('  cowork-link status                     Show current link status');
  log('  cowork-link clean                      Remove all symlinks');
  log('');
  log('Options:', 'cyan');
  log('  --target-dir=<path>                    Override target directory');
  log('');
  log('Examples:', 'cyan');
  log('  cowork-link sales                      Link the sales plugin');
  log('  cowork-link sales data productivity    Link multiple plugins');
  log('  cowork-link all                        Link all 11 plugins');
  log('  cowork-link --target-dir=.opencode sales');
  log('');
}

/**
 * Main entry point.
 */
function main() {
  const args = process.argv.slice(2);
  const { commands, targetDir: cliTargetDir } = parseArgs(args);

  // Resolve target directory
  const { targetDir, source } = resolveTargetDir(cliTargetDir);
  TARGET_DIR = targetDir;

  // Discover plugins
  PLUGINS = discoverPlugins(PLUGINS_DIR);
  CONTENT_TYPES = getContentTypes(PLUGINS);

  // No command: show help
  if (commands.length === 0) {
    showHelp();
    listPlugins();
    return;
  }

  // Show header for action commands
  if (!['list'].includes(commands[0])) {
    log('\nCowork Plugin Linker', 'bright');
    log('='.repeat(50), 'gray');

    if (source === 'cli') {
      log(`Target: ${TARGET_DIR} (from --target-dir)`, 'cyan');
    } else if (source === 'auto') {
      log(`Target: ${TARGET_DIR} (auto-detected opencode.json)`, 'cyan');
    } else {
      log(`Target: ${TARGET_DIR} (default)`, 'gray');
    }

    log(`Discovered: ${PLUGINS.size} plugins`, 'gray');
  }

  // Process commands
  for (const command of commands) {
    switch (command) {
      case 'status':
        showStatus();
        break;

      case 'clean':
        cleanLinks();
        break;

      case 'list':
        listPlugins();
        break;

      case 'all':
        ensureDirectoryStructure();
        for (const pluginName of PLUGINS.keys()) {
          linkPlugin(pluginName);
        }
        log('\nDone!', 'green');
        break;

      default:
        ensureDirectoryStructure();
        if (!linkPlugin(command)) {
          process.exit(1);
        }
        break;
    }
  }
}

main();
