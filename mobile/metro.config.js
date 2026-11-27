// Metro configuration: the default Expo config, plus the repository's /content folder,
// which holds the bundled learning content (src/content/bundled_content.ts imports it).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '..', 'content')];

module.exports = config;
