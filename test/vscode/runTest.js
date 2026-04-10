const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

function resolveCodeExecutable() {
  const candidates = [
    process.env.VSCODE_EXECUTABLE_PATH,
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft VS Code', 'Code.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('Unable to locate a local VS Code executable for extension tests.');
}

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-vscode-user-'));
  const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-vscode-ext-'));

  process.env.STCFSD_TEST_MODE = '1';

  const baseOptions = {
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      '--disable-extensions',
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
    ],
    extensionTestsEnv: {
      ...process.env,
      STCFSD_TEST_MODE: '1',
    },
  };

  try {
    await runTests({
      ...baseOptions,
      vscodeExecutablePath: resolveCodeExecutable(),
    });
    return;
  } catch (err) {
    console.warn(`Local VS Code launch failed, retrying with downloaded test build: ${err.message || err}`);
  }

  await runTests({
    ...baseOptions,
    version: '1.85.0',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
