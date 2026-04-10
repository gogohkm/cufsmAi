const path = require('path');

async function runModule(relPath) {
  const mod = require(path.resolve(__dirname, relPath));
  if (!mod || typeof mod.run !== 'function') {
    throw new Error(`Test module ${relPath} does not export run()`);
  }
  await mod.run();
}

async function run() {
  await runModule('./designDsmPreparation.test.js');
}

module.exports = { run };
