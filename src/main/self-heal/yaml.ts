function cleanYamlString(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').trim()
}

export function parseAffectedFilesFromFrontMatter(frontMatter: string): string[] {
  const inlineMatch = /^affected_files:\s*\[([^\]]*)\]\s*$/im.exec(frontMatter)
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map(cleanYamlString)
      .filter(Boolean)
  }

  const blockMatch = /^affected_files:\s*\n((?:[ \t]*-[^\n]*(?:\n|$))+)/im.exec(frontMatter)
  if (!blockMatch) return []

  return blockMatch[1]
    .split('\n')
    .map((line) => /^[ \t]*-\s*(.+?)\s*$/.exec(line)?.[1] ?? '')
    .map(cleanYamlString)
    .filter(Boolean)
}
