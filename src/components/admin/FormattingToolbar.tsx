import { Bold, Underline, Link } from "lucide-react";
import { cn } from "@/lib/utils";

interface FormattingToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
}

function wrapSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (v: string) => void,
  before: string,
  after: string,
  placeholder?: string
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.substring(start, end);
  const text = selected || placeholder || "texto";
  const newValue =
    value.substring(0, start) + before + text + after + value.substring(end);
  onChange(newValue);

  // Restore cursor position after React re-render
  requestAnimationFrame(() => {
    textarea.focus();
    const cursorStart = start + before.length;
    const cursorEnd = cursorStart + text.length;
    textarea.setSelectionRange(cursorStart, cursorEnd);
  });
}

export default function FormattingToolbar({
  textareaRef,
  value,
  onChange,
}: FormattingToolbarProps) {
  const handleBold = () => {
    if (!textareaRef.current) return;
    wrapSelection(textareaRef.current, value, onChange, "**", "**", "texto");
  };

  const handleUnderline = () => {
    if (!textareaRef.current) return;
    wrapSelection(textareaRef.current, value, onChange, "__", "__", "texto");
  };

  const handleLink = () => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);
    const linkText = selected || "texto do link";
    const insert = `[${linkText}](https://url)`;
    const newValue = value.substring(0, start) + insert + value.substring(end);
    onChange(newValue);

    requestAnimationFrame(() => {
      textarea.focus();
      // Select the URL part for easy replacement
      const urlStart = start + linkText.length + 3;
      const urlEnd = urlStart + 10;
      textarea.setSelectionRange(urlStart, urlEnd);
    });
  };

  const buttons = [
    { icon: Bold, label: "Negrito", action: handleBold },
    { icon: Underline, label: "Sublinhado", action: handleUnderline },
    { icon: Link, label: "Link", action: handleLink },
  ];

  return (
    <div className="flex items-center gap-0.5 px-1 py-1 border-b border-border bg-muted/10 rounded-t-md">
      {buttons.map((btn) => (
        <button
          key={btn.label}
          type="button"
          onClick={btn.action}
          title={btn.label}
          className={cn(
            "h-7 w-7 flex items-center justify-center rounded transition-colors",
            "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          )}
        >
          <btn.icon className="h-3.5 w-3.5" />
        </button>
      ))}
      <span className="ml-auto text-[10px] text-muted-foreground/50 pr-1">
        **negrito** · __sublinhado__ · [texto](url)
      </span>
    </div>
  );
}
