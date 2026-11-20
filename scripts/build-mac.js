const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'package.json')).version.replace(/\.0$/, '');
const bin = path.join(root, 'node_modules', '.bin', 'electron-builder');

execFileSync(bin, [
  '--mac',
  `--config.artifactName=ChatServer-${version}-\${arch}.\${ext}`
], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});
