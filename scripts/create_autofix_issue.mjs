import { execSync } from 'node:child_process';
import fs from 'node:fs';

const mode = process.env.MODE || 'stop';
const pr = process.env.PR_NUMBER || 'N/A';
const runId = process.env.RUN_ID || 'N/A';
const wf = process.env.WORKFLOW_NAME || 'N/A';
const repo = process.env.REPO;

const body = mode === 'stop'
  ? `## Codex自動修正停止\n- 失敗が継続しているため自動修正を停止しました。\n- workflow: ${wf}\n- run_id: ${runId}\n- PR: #${pr}\n\n### 人間が確認すべき点\n- Notion / Cloudflare / GitHub Secrets / 外部APIの設定\n- 最新失敗ログの詳細\n\n### 次アクション\n- ログを確認し、必要に応じて手動修正または設定修正を実施してください。`
  : `## Codex ${mode}\nworkflow: ${wf}\nrun_id: ${runId}\nPR: #${pr}\n\nこの実行は説明または計画のみを出力するモードです。`;

fs.writeFileSync('/tmp/codex-comment.md', body);
if (pr !== 'N/A') {
  execSync(`gh pr comment ${pr} --repo ${repo} --body-file /tmp/codex-comment.md`, { stdio: 'inherit' });
}
if (mode === 'stop') {
  const title = `[Codex停止] CI失敗が自動修正上限に達しました: ${wf}`;
  execSync(`gh issue create --repo ${repo} --title "${title}" --body-file /tmp/codex-comment.md`, { stdio: 'inherit' });
}
