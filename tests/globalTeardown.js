const fs   = require('fs');
const path = require('path');
const os   = require('os');

const TEST_DIR = path.join(os.tmpdir(), 'wdp-test');

module.exports = async function globalTeardown() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
};
