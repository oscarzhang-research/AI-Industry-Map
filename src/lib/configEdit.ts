// Small, comment-preserving edits to site.config.yaml for switches the owner flips on the Settings page.

/** Set `key: true|false` in the top-level `site:` block, keeping any comment on the line; adds the key if it is missing. */
export function setSiteFlag(yamlText: string, key: string, value: boolean): string {
  const lines = yamlText.split('\n');
  const start = lines.findIndex((l) => /^site:\s*(#.*)?$/.test(l));
  if (start < 0) throw new Error('site.config.yaml has no "site:" section.');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z_]/.test(lines[i])) {
      end = i; // the next top-level key
      break;
    }
  }
  const re = new RegExp(`^(\\s+${key}:\\s*)(true|false)\\b(.*)$`);
  for (let i = start + 1; i < end; i++) {
    const m = re.exec(lines[i]);
    if (m) {
      lines[i] = `${m[1]}${value}${m[3]}`;
      return lines.join('\n');
    }
  }
  const indent = lines.slice(start + 1, end).find((l) => /^\s+\S/.test(l))?.match(/^\s+/)?.[0] ?? '  ';
  lines.splice(start + 1, 0, `${indent}${key}: ${value}`);
  return lines.join('\n');
}
