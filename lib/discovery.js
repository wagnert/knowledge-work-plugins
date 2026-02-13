/**
 * Plugin Discovery Module
 *
 * Discovers Cowork plugins by scanning for directories
 * containing `.claude-plugin/plugin.json`.
 */

import fs from 'fs';
import path from 'path';

/**
 * Discovers all available plugins in the package directory.
 *
 * @param {string} pluginsDir - Root directory of the knowledge-work-plugins package
 * @returns {Map<string, PluginDescriptor>} Map of plugin name to descriptor
 */
export function discoverPlugins(pluginsDir) {
  const plugins = new Map();
  const ignoreDirs = ['node_modules', '.git', 'scripts', 'lib', '.claude-plugin'];

  if (!fs.existsSync(pluginsDir)) {
    return plugins;
  }

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || ignoreDirs.includes(entry.name)) {
      continue;
    }

    const pluginDir = path.join(pluginsDir, entry.name);
    const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');

    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
      continue;
    }

    const contentTypes = detectContentTypes(pluginDir);
    if (contentTypes.length === 0) {
      continue;
    }

    plugins.set(manifest.name || entry.name, {
      pluginName: manifest.name || entry.name,
      version: manifest.version || '1.0.0',
      description: manifest.description || `Plugin: ${entry.name}`,
      rootDir: pluginDir,
      contentTypes,
    });
  }

  return plugins;
}

/**
 * Detects available content types in a plugin directory.
 *
 * @param {string} pluginDir - Path to the plugin directory
 * @returns {string[]} Array of content type names (e.g. ['skills', 'commands'])
 */
function detectContentTypes(pluginDir) {
  const contentTypes = ['skills', 'commands'];

  return contentTypes.filter((type) => {
    const dir = path.join(pluginDir, type);
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  });
}

/**
 * Gets all unique content types from discovered plugins.
 *
 * @param {Map<string, PluginDescriptor>} plugins - Discovered plugins
 * @returns {string[]}
 */
export function getContentTypes(plugins) {
  const types = new Set();
  for (const plugin of plugins.values()) {
    for (const type of plugin.contentTypes) {
      types.add(type);
    }
  }
  return Array.from(types).sort();
}

/**
 * @typedef {Object} PluginDescriptor
 * @property {string} pluginName - Short plugin name (e.g. "sales")
 * @property {string} version - Plugin version
 * @property {string} description - Plugin description
 * @property {string} rootDir - Absolute path to plugin root
 * @property {string[]} contentTypes - Available content types (skills, commands)
 */
