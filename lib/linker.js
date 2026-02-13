/**
 * Plugin Linker Module
 *
 * Links plugin content to the target directory via symlinks.
 * Adapted from @techdivision/opencode-plugins for Cowork plugin structure.
 */

import fs from 'fs';
import path from 'path';

/**
 * Maps plural content type names to singular target directory names.
 *
 * @param {string} type - Content type name (may be plural or singular)
 * @returns {string} Singular target directory name
 */
export function normalizeContentType(type) {
  const mapping = {
    skills: 'skill',
    commands: 'command',
  };

  return mapping[type] || type;
}

/**
 * Determines which items to link based on type structure.
 *
 * - skills: Link skill subdirectories flat (ignore loose files like dashboard.html)
 * - commands: Link .md files with plugin prefix (e.g. 'sales.call-prep.md')
 *
 * Content lives directly in `<plugin>/skills/` and `<plugin>/commands/`
 * (no intermediate `.opencode/` directory like in opencode-plugins).
 *
 * @param {string} sourceDir - Source directory (e.g. `<plugin>/skills/`)
 * @param {string} type - Content type (skills or commands)
 * @param {string} targetDir - Target directory (e.g. `.opencode/skill/`)
 * @param {string} pluginName - Plugin name for command prefixing
 * @returns {Array<LinkItem>} Items to link
 */
export function getItemsToLink(sourceDir, type, targetDir, pluginName) {
  const items = [];

  if (!fs.existsSync(sourceDir)) {
    return items;
  }

  const displayType = normalizeContentType(type);

  if (type === 'skills') {
    // Skills: Link each subdirectory as a skill (ignore loose files)
    const entries = fs.readdirSync(sourceDir).filter((f) => {
      const fullPath = path.join(sourceDir, f);
      return fs.statSync(fullPath).isDirectory();
    });

    for (const entry of entries) {
      items.push({
        sourcePath: path.join(sourceDir, entry),
        targetPath: path.join(targetDir, entry),
        displayName: `${displayType}/${entry}/`,
        isDirectory: true,
      });
    }
  } else if (type === 'commands') {
    // Commands: Link .md files with plugin prefix
    const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const targetFile = `${pluginName}.${file}`;
      items.push({
        sourcePath: path.join(sourceDir, file),
        targetPath: path.join(targetDir, targetFile),
        displayName: `${displayType}/${targetFile}`,
        isDirectory: false,
      });
    }
  }

  return items;
}

/**
 * Creates a symlink with LAST WINS strategy.
 *
 * - Existing symlinks are overwritten (re-linked)
 * - Real files/directories are NOT overwritten (warning)
 *
 * @param {string} sourcePath - Source file/directory
 * @param {string} targetPath - Target symlink location
 * @returns {'created'|'overridden'|'skipped-same'|'skipped-real'|'error'}
 */
export function createSymlink(sourcePath, targetPath) {
  let targetExists = false;
  let targetIsSymlink = false;

  try {
    const stat = fs.lstatSync(targetPath);
    targetExists = true;
    targetIsSymlink = stat.isSymbolicLink();
  } catch {
    targetExists = false;
  }

  if (targetExists) {
    if (targetIsSymlink) {
      const existingTarget = fs.readlinkSync(targetPath);
      if (existingTarget === sourcePath) {
        return 'skipped-same';
      }
      // Different source - LAST WINS: remove and re-link
      fs.unlinkSync(targetPath);
      try {
        fs.symlinkSync(sourcePath, targetPath);
        return 'overridden';
      } catch {
        return 'error';
      }
    } else {
      // Real file/directory - do NOT override
      return 'skipped-real';
    }
  }

  // Create new symlink
  try {
    fs.symlinkSync(sourcePath, targetPath);
    return 'created';
  } catch {
    return 'error';
  }
}

/**
 * @typedef {Object} LinkItem
 * @property {string} sourcePath - Source file/directory path
 * @property {string} targetPath - Target symlink path
 * @property {string} displayName - Display name for logging
 * @property {boolean} isDirectory - Whether item is a directory
 */
