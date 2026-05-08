const attempts = Number(process.env.GITHUB_RUN_ATTEMPT || 1);
const canFix = attempts <= 2;

const fs = await import('node:fs');
const out = fs.createWriteStream(process.env.GITHUB_OUTPUT, { flags: 'a' });
out.write(`attempt=${attempts}\n`);
out.write(`can_fix=${canFix}\n`);
out.end();
