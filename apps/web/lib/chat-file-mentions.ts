export type FileMentionMatch = {
  query: string;
  replaceFrom: number;
  replaceTo: number;
};

const MENTION_PREFIX_PATTERN = /(^|[\s([{'"`])@([^\s@]*)$/;
const FILE_MENTION_TOKEN_PATTERN = /(^|[\s([{'"`])@([^\s@]+)/g;
const FILE_LIKE_PATTERN = /^(?:[a-z0-9][a-z0-9._/-]*\.[a-z0-9]+)$/i;

export function getFileMentionMatch(value: string, caretIndex: number | null | undefined) {
  if (typeof caretIndex !== "number" || caretIndex < 0) {
    return null;
  }

  const safeCaret = Math.min(caretIndex, value.length);
  const beforeCaret = value.slice(0, safeCaret);
  const prefixMatch = beforeCaret.match(MENTION_PREFIX_PATTERN);

  if (!prefixMatch) {
    return null;
  }

  const token = prefixMatch[0];
  const atIndex = beforeCaret.lastIndexOf("@");

  if (atIndex < 0) {
    return null;
  }

  const query = token.slice(token.indexOf("@") + 1);
  const afterCaret = value.slice(safeCaret);
  const suffixMatch = afterCaret.match(/^[^\s@]*/);
  const suffix = suffixMatch?.[0] ?? "";

  return {
    query,
    replaceFrom: atIndex,
    replaceTo: safeCaret + suffix.length,
  } satisfies FileMentionMatch;
}

export function replaceFileMention(
  value: string,
  match: FileMentionMatch,
  sourcePath: string,
) {
  const normalizedPath = sourcePath.trim();
  const suffix = value.slice(match.replaceTo);
  const needsTrailingSpace = suffix.length === 0 || !/^\s/.test(suffix);
  const replacement = normalizedPath
    ? `@${normalizedPath}${needsTrailingSpace ? " " : ""}`
    : "@";

  return `${value.slice(0, match.replaceFrom)}${replacement}${suffix}`;
}

export function extractMentionedFilePaths(value: string) {
  const matches = new Set<string>();

  for (const match of value.matchAll(FILE_MENTION_TOKEN_PATTERN)) {
    const token = (match[2]?.trim() ?? "").replace(/[),.!?:;\]}]+$/g, "");

    if (!FILE_LIKE_PATTERN.test(token)) {
      continue;
    }

    matches.add(token);
  }

  return [...matches];
}
