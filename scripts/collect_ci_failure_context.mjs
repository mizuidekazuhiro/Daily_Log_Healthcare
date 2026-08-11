import fs from 'node:fs';

const eventName = process.env.EVENT_NAME;
const payload = JSON.parse(fs.readFileSync(process.env.EVENT_PATH, 'utf8'));

let runMode = 'fix';
let runId = process.env.INPUT_RUN_ID || '';
let prNumber = process.env.INPUT_PR_NUMBER || '';
let headBranch = '';
let workflowName = '';
let shouldRun = true;

if (eventName === 'workflow_run') {
  runId = String(payload.workflow_run?.id || '');
  workflowName = payload.workflow_run?.name || '';
  prNumber = String(payload.workflow_run?.pull_requests?.[0]?.number || '');
  headBranch = payload.workflow_run?.head_branch || '';
}
if (eventName === 'pull_request') {
  prNumber = String(payload.pull_request?.number || '');
  headBranch = payload.pull_request?.head?.ref || '';
}
if (eventName === 'issue_comment') {
  prNumber = String(payload.issue?.number || '');
  const body = payload.comment?.body || '';
  if (body.includes('/codex explain')) runMode = 'explain';
  if (body.includes('/codex plan')) runMode = 'plan';
}
if (!prNumber && !runId) shouldRun = false;

const out = fs.createWriteStream(process.env.GITHUB_OUTPUT, { flags: 'a' });
out.write(`should_run=${shouldRun}\n`);
out.write(`run_mode=${runMode}\n`);
out.write(`run_id=${runId}\n`);
out.write(`pr_number=${prNumber}\n`);
out.write(`head_branch=${headBranch}\n`);
out.write(`workflow_name=${workflowName}\n`);
out.end();
