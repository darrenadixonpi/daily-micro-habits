// ts-fsrs reads `import.meta.env`; Hermes has no import.meta, so Babel must rewrite it.
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
  };
};
