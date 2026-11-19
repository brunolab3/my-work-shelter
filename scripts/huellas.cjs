// Legacy name of scripts/fingerprints.cjs, for servers and apps started before the rename (693af40) that still run or
// require it; delete it once nobody runs a copy from before that commit.
'use strict';
module.exports = require('./fingerprints.cjs');
if (require.main === module) module.exports.cli(process.argv.slice(2));
