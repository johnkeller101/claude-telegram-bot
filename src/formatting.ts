/**
 * Formatting module for Claude Telegram Bot.
 *
 * Markdown conversion and tool status display formatting.
 */

/**
 * Escape HTML special characters.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Convert standard markdown to Telegram-compatible HTML.
 *
 * HTML is more reliable than Telegram's Markdown which breaks on special chars.
 * Telegram HTML supports: <b>, <i>, <code>, <pre>, <a href="">
 */
export function convertMarkdownToHtml(text: string): string {
  // Store code blocks temporarily to avoid processing their contents
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];
  const tableBlocks: string[] = [];

  // Save code blocks first (```code```)
  text = text.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(code);
    return `\x00CODEBLOCK${codeBlocks.length - 1}\x00`;
  });

  // Save inline code (`code`)
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    inlineCodes.push(code);
    return `\x00INLINECODE${inlineCodes.length - 1}\x00`;
  });

  // Convert markdown tables to pre-escaped <pre> placeholders
  text = convertMarkdownTables(text, tableBlocks);

  // Escape HTML entities in the remaining text
  text = escapeHtml(text);

  // Headers: ## Header -> <b>Header</b>
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>\n");

  // Bold: **text** -> <b>text</b>
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Also handle *text* as bold (single asterisk)
  text = text.replace(/(?<!\*)\*(.+?)\*(?!\*)/g, "<b>$1</b>");

  // Double underscore: __text__ -> <b>text</b>
  text = text.replace(/__([^_]+)__/g, "<b>$1</b>");

  // Italic: _text_ -> <i>text</i> (but not __text__)
  text = text.replace(/(?<!_)_([^_]+)_(?!_)/g, "<i>$1</i>");

  // Blockquotes: &gt; text -> <blockquote>text</blockquote>
  text = convertBlockquotes(text);

  // Bullet lists: - item or * item -> • item
  text = text.replace(/^[-*] /gm, "• ");

  // Horizontal rules: --- or *** -> blank line
  text = text.replace(/^[-*]{3,}$/gm, "");

  // Links: [text](url) -> <a href="url">text</a>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    const escapedCode = escapeHtml(codeBlocks[i]!);
    text = text.replace(`\x00CODEBLOCK${i}\x00`, `<pre>${escapedCode}</pre>`);
  }

  // Restore inline code
  for (let i = 0; i < inlineCodes.length; i++) {
    const escapedCode = escapeHtml(inlineCodes[i]!);
    text = text.replace(
      `\x00INLINECODE${i}\x00`,
      `<code>${escapedCode}</code>`
    );
  }

  // Restore table blocks (already escaped inside convertMarkdownTables)
  for (let i = 0; i < tableBlocks.length; i++) {
    text = text.replace(`\x00TABLE${i}\x00`, tableBlocks[i]!);
  }

  // Collapse multiple newlines
  text = text.replace(/\n{3,}/g, "\n\n");

  return text;
}

/**
 * Detect markdown tables and convert to monospace <pre> blocks.
 * Stores the pre-escaped HTML in tableBlocks and returns placeholders.
 */
function convertMarkdownTables(text: string, tableBlocks: string[]): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let tableLines: string[] = [];

  const isTableRow = (line: string) => {
    const trimmed = line.trim();
    return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|", 1);
  };

  const isSeparator = (line: string) => /^\|[\s:|-]+\|$/.test(line.trim());

  const flushTable = () => {
    if (tableLines.length < 2) {
      result.push(...tableLines);
      tableLines = [];
      return;
    }

    // Parse cells from each row
    const rows = tableLines
      .filter((l) => !isSeparator(l))
      .map((line) =>
        line
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim())
      );

    if (rows.length === 0) {
      result.push(...tableLines);
      tableLines = [];
      return;
    }

    // Calculate max width per column
    const colCount = Math.max(...rows.map((r) => r.length));
    const colWidths: number[] = Array(colCount).fill(0);
    for (const row of rows) {
      for (let i = 0; i < colCount; i++) {
        colWidths[i] = Math.max(colWidths[i]!, (row[i] || "").length);
      }
    }

    // Build padded rows with box-drawing separator
    const formatted: string[] = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      const paddedCells = colWidths.map((w, i) => (row[i] || "").padEnd(w));
      formatted.push(paddedCells.join(" │ "));
      if (r === 0) {
        formatted.push(colWidths.map((w) => "─".repeat(w)).join("─┼─"));
      }
    }

    // Escape HTML and store as <pre> block
    const tableHtml = `<pre>${escapeHtml(formatted.join("\n"))}</pre>`;
    const idx = tableBlocks.length;
    tableBlocks.push(tableHtml);
    result.push(`\x00TABLE${idx}\x00`);
    tableLines = [];
  };

  for (const line of lines) {
    if (isTableRow(line)) {
      tableLines.push(line);
    } else {
      if (tableLines.length > 0) {
        flushTable();
      }
      result.push(line);
    }
  }
  if (tableLines.length > 0) {
    flushTable();
  }

  return result.join("\n");
}

/**
 * Convert blockquotes (handles multi-line).
 */
function convertBlockquotes(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inBlockquote = false;
  const blockquoteLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("&gt; ") || line === "&gt;") {
      if (line === "&gt;") {
        blockquoteLines.push("");
      } else {
        // Remove '&gt; ' and strip # from hashtags (Telegram mobile bug workaround)
        const content = line.slice(5).replace(/#/g, "");
        blockquoteLines.push(content);
      }
      inBlockquote = true;
    } else {
      if (inBlockquote) {
        result.push(
          "<blockquote>" + blockquoteLines.join("\n") + "</blockquote>"
        );
        blockquoteLines.length = 0;
        inBlockquote = false;
      }
      result.push(line);
    }
  }

  // Handle blockquote at end
  if (inBlockquote) {
    result.push("<blockquote>" + blockquoteLines.join("\n") + "</blockquote>");
  }

  return result.join("\n");
}

// Legacy alias
export const convertMarkdownForTelegram = convertMarkdownToHtml;

// ============== Tool Status Formatting ==============

/**
 * Shorten a file path for display (last 2 components).
 */
function shortenPath(path: string): string {
  if (!path) return "file";
  const parts = path.split("/");
  if (parts.length >= 2) {
    return parts.slice(-2).join("/");
  }
  return parts[parts.length - 1] || path;
}

/**
 * Truncate text with ellipsis.
 */
function truncate(text: string, maxLen = 60): string {
  if (!text) return "";
  // Clean up newlines for display
  const cleaned = text.replace(/\n/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen) + "...";
}

/**
 * Wrap text in HTML code tags, escaping special chars.
 */
function code(text: string): string {
  return `<code>${escapeHtml(text)}</code>`;
}

/**
 * Format tool use for display in Telegram with HTML formatting.
 */
export function formatToolStatus(
  toolName: string,
  toolInput: Record<string, unknown>
): string {
  const emojiMap: Record<string, string> = {
    Read: "📖",
    Write: "📝",
    Edit: "✏️",
    Bash: "▶️",
    Glob: "🔍",
    Grep: "🔎",
    WebSearch: "🔍",
    WebFetch: "🌐",
    Task: "🎯",
    TodoWrite: "📋",
    mcp__: "🔧",
  };

  // Find matching emoji
  let emoji = "🔧";
  for (const [key, val] of Object.entries(emojiMap)) {
    if (toolName.includes(key)) {
      emoji = val;
      break;
    }
  }

  // Format based on tool type
  if (toolName === "Read") {
    const filePath = String(toolInput.file_path || "file");
    const shortPath = shortenPath(filePath);
    const imageExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".bmp",
      ".svg",
      ".ico",
    ];
    if (imageExtensions.some((ext) => filePath.toLowerCase().endsWith(ext))) {
      return "👀 Viewing";
    }
    return `${emoji} Reading ${code(shortPath)}`;
  }

  if (toolName === "Write") {
    const filePath = String(toolInput.file_path || "file");
    return `${emoji} Writing ${code(shortenPath(filePath))}`;
  }

  if (toolName === "Edit") {
    const filePath = String(toolInput.file_path || "file");
    return `${emoji} Editing ${code(shortenPath(filePath))}`;
  }

  if (toolName === "Bash") {
    const cmd = String(toolInput.command || "");
    const desc = String(toolInput.description || "");
    if (desc) {
      return `${emoji} ${escapeHtml(desc)}`;
    }
    return `${emoji} ${code(truncate(cmd, 50))}`;
  }

  if (toolName === "Grep") {
    const pattern = String(toolInput.pattern || "");
    const path = String(toolInput.path || "");
    if (path) {
      return `${emoji} Searching ${code(truncate(pattern, 30))} in ${code(
        shortenPath(path)
      )}`;
    }
    return `${emoji} Searching ${code(truncate(pattern, 40))}`;
  }

  if (toolName === "Glob") {
    const pattern = String(toolInput.pattern || "");
    return `${emoji} Finding ${code(truncate(pattern, 50))}`;
  }

  if (toolName === "WebSearch") {
    const query = String(toolInput.query || "");
    return `${emoji} Searching: ${escapeHtml(truncate(query, 50))}`;
  }

  if (toolName === "WebFetch") {
    const url = String(toolInput.url || "");
    return `${emoji} Fetching ${code(truncate(url, 50))}`;
  }

  if (toolName === "Task") {
    const desc = String(toolInput.description || "");
    if (desc) {
      return `${emoji} Agent: ${escapeHtml(desc)}`;
    }
    return `${emoji} Running agent...`;
  }

  if (toolName === "Skill") {
    const skillName = String(toolInput.skill || "");
    if (skillName) {
      return `💭 Using skill: ${escapeHtml(skillName)}`;
    }
    return `💭 Using skill...`;
  }

  if (toolName.startsWith("mcp__")) {
    // Generic MCP tool formatting
    const parts = toolName.split("__");
    if (parts.length >= 3) {
      const server = parts[1]!;
      let action = parts[2]!;
      // Remove redundant server prefix from action
      if (action.startsWith(`${server}_`)) {
        action = action.slice(server.length + 1);
      }
      action = action.replace(/_/g, " ");

      // Try to get meaningful summary from common MCP input fields
      const summary =
        toolInput.name ||
        toolInput.title ||
        toolInput.query ||
        toolInput.description ||
        toolInput.content ||
        toolInput.text ||
        toolInput.id ||
        "";

      if (summary) {
        let detail = escapeHtml(truncate(String(summary), 40));
        // Append date for calendar-related tools
        const date = toolInput.start_date || toolInput.date;
        if (date) {
          detail += ` (${escapeHtml(String(date).slice(0, 10))})`;
        }
        // Capitalize first letter of action
        const label = action.charAt(0).toUpperCase() + action.slice(1);
        return `🔧 ${label}: ${detail}`;
      }
      // Capitalize first letter of action
      const label = action.charAt(0).toUpperCase() + action.slice(1);
      return `🔧 ${label}`;
    }
    return `🔧 ${escapeHtml(toolName)}`;
  }

  return `${emoji} ${escapeHtml(toolName)}`;
}

/**
 * Convert a tool status string from active ("Fetching") to completed ("Fetched").
 */
export function formatToolDoneStatus(toolStatus: string): string {
  // Replace emoji and verb patterns
  const replacements: [RegExp, string][] = [
    [/🌐 Fetching /, "✅ Fetched "],
    [/🔍 Searching:? /, "✅ Searched "],
    [/🔎 Searching /, "✅ Searched "],
    [/📖 Reading /, "✅ Read "],
    [/📝 Writing /, "✅ Wrote "],
    [/✏️ Editing /, "✅ Edited "],
    [/▶️ /, "✅ Ran "],
    [/🎯 Agent: /, "✅ Agent: "],
    [/🔧 /, "✅ "],
    [/👀 Viewing/, "✅ Viewed"],
    [/🔍 Finding /, "✅ Found "],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(toolStatus)) {
      return toolStatus.replace(pattern, replacement);
    }
  }

  return "✅ " + toolStatus;
}
