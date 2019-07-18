const fs = require('fs-extra');

const root = process.argv.find(a => /production/.test(a)) ? 'build-prod' : 'build';

fs.ensureDirSync(root + '/common/static-serve');
fs.copy('src/common/static-serve', root + '/common/static-serve');
fs.ensureDirSync(root + '/backend/default-drivers/icons');
fs.copy('src/backend/default-drivers/icons', root + '/backend/default-drivers/icons');
