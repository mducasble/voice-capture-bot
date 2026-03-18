import React from "react";

/**
 * Renders a simple markup string into React elements.
 * Supports: **bold**, __underline__, [text](url)
 */
export function renderFormattedText(
  text: string,
  linkStyle?: React.CSSProperties
): React.ReactNode[] {
  // Split by formatting tokens
  const regex = /(\*\*(.+?)\*\*|__(.+?)__|(\[(.+?)\]\((.+?)\)))/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    // Push text before match
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    if (match[2]) {
      // **bold**
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      // __underline__
      parts.push(
        <span key={key++} className="underline">
          {match[3]}
        </span>
      );
    } else if (match[5] && match[6]) {
      // [text](url)
      parts.push(
        <a
          key={key++}
          href={match[6]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-semibold"
          style={linkStyle || { color: "inherit" }}
        >
          {match[5]}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts;
}
