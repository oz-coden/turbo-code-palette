const rules = [
  ['absolute-or-home-path', /(?<![a-z])[a-z]:[\\/]|\/(?:Users|home)\/[^/\s]+|\\\\[a-z0-9][a-z0-9._-]*\\[^\\\s]+|[a-z]%3A(?:%5C|%2F)/gi],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['known-secret-prefix', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g],
  ['credential-assignment', /(?:api[_-]?key|access[_-]?token|password|client[_-]?secret|authorization|cookie)["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']/gi],
];

function placeholder(value) {
  return /^(?:<[^>]+>|\$\{[^}]+\}|example|placeholder|changeme|your[-_ ].*|test[-_ ].*)$/i.test(value);
}

export function scanPublicText(text) {
  const findings = [];
  for (const [category, expression] of rules) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      if (category === 'credential-assignment' && placeholder(match[1])) { continue; }
      findings.push({ category, line: text.slice(0, match.index).split('\n').length });
    }
  }
  return findings;
}

export function forbiddenPublicFile(file) {
  const normalized = file.replaceAll('\\', '/');
  if (/^src\/test\/fixtures\/.*\.tcp-sp$/.test(normalized)) { return false; }
  if (/(?:^|\/)(?:node_modules|dist|out|coverage|\.nyc_output|\.vscode-test|test-results|playwright-report|\.idea|\.agents|\.codex|\.aws|\.tcp-staging|\.tcp-transactions)(?:\/|$)/i.test(normalized)) { return true; }
  if (/^csharp\/.*\/(?:bin|obj)\//i.test(normalized)) { return true; }
  if (/(?:^|\/)\.tcp-insert-[^/]+(?:\/|$)/i.test(normalized)) { return true; }
  if (/(?:^|\/)\.snippets\//i.test(normalized) && !/^src\/test\/fixtures\//.test(normalized)) { return true; }
  if (/^\.tcp-global\//i.test(normalized)) { return true; }
  if (/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.DS_Store|Thumbs\.db|Desktop\.ini)$/i.test(normalized)
    && !/(?:^|\/)\.env\.(?:example|template)$/.test(normalized)) { return true; }
  return /\.(?:log|tmp|tcp-sp|vsix|pem|p12|pfx|tsbuildinfo|code-workspace)$/i.test(normalized)
    || /^\.vscode\/.*\.local\./i.test(normalized);
}
