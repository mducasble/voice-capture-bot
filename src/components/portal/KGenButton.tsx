import { useRef, useCallback, useState, useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function useScramble() {
  const rafRef = useRef<number>(0);

  const scramble = useCallback((el: HTMLSpanElement, finalText: string) => {
    const start = performance.now();
    const duration = 480;
    const len = finalText.length;
    const w = el.getBoundingClientRect().width;
    el.style.minWidth = `${w}px`;
    cancelAnimationFrame(rafRef.current);

    function frame(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const fixed = Math.floor(t * len);
      let out = "";
      for (let i = 0; i < len; i++) {
        if (i < fixed) out += finalText[i];
        else out += finalText[i] === " " ? " " : CHARS[(Math.random() * CHARS.length) | 0];
      }
      el.textContent = out;
      if (t < 1) rafRef.current = requestAnimationFrame(frame);
      else el.textContent = finalText;
    }
    rafRef.current = requestAnimationFrame(frame);
  }, []);

  const stop = useCallback((el: HTMLSpanElement, finalText: string) => {
    cancelAnimationFrame(rafRef.current);
    el.textContent = finalText;
  }, []);

  return { scramble, stop };
}

const CLIP_PATH = "polygon(10px 0px, 100% 0px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0px 100%, 0px 10px)";

export type KGenButtonVariant = "primary" | "dark" | "outline" | "white";
export type KGenButtonSize = "default" | "sm" | "lg";

interface KGenButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: KGenButtonVariant;
  size?: KGenButtonSize;
  scramble?: boolean;
  /** Text used for scramble effect. Required when children contains JSX. */
  scrambleText?: string;
  /** Optional icon rendered before the text */
  icon?: ReactNode;
}

const variantStyles: Record<KGenButtonVariant, { base: string; hover: string }> = {
  primary: {
    base: "bg-[hsl(88,100%,51%)] text-[hsl(168,28%,10%)] shadow-[0_10px_22px_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.20)]",
    hover: "hover:brightness-[1.06] hover:saturate-[1.08]",
  },
  dark: {
    base: "bg-foreground/80 text-background shadow-[0_10px_22px_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.20)]",
    hover: "hover:brightness-[1.03] hover:saturate-[1.05]",
  },
  outline: {
    base: "bg-transparent text-foreground border-foreground/30 shadow-[0_10px_22px_rgba(0,0,0,.10)]",
    hover: "hover:bg-foreground/10 hover:brightness-[1.03]",
  },
  white: {
    base: "bg-white text-[hsl(168,28%,10%)] shadow-[0_10px_22px_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.20)]",
    hover: "hover:brightness-[0.95]",
  },
};

const sizeStyles: Record<KGenButtonSize, string> = {
  sm: "px-5 py-3 text-sm",
  default: "px-7 py-5 text-base",
  lg: "px-9 py-6 text-lg",
};

const KGenButton = ({
  variant = "primary",
  size = "default",
  scramble: enableScramble = true,
  scrambleText,
  icon,
  className,
  children,
  ...props
}: KGenButtonProps) => {
  const spanRef = useRef<HTMLSpanElement>(null);
  const shineRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const { scramble: doScramble, stop } = useScramble();

  // Resolve label: explicit scrambleText > string children > empty
  const label = scrambleText || (typeof children === "string" ? children : "");

  useEffect(() => {
    if (btnRef.current) {
      const w = btnRef.current.getBoundingClientRect().width;
      btnRef.current.style.minWidth = `${w}px`;
    }
  }, [children]);

  const handleMouseEnter = useCallback(() => {
    if (enableScramble && label && spanRef.current) {
      doScramble(spanRef.current, label);
    }
    if (shineRef.current) {
      const el = shineRef.current;
      el.style.transition = "none";
      el.style.transform = "translateX(-120%)";
      el.style.opacity = "0";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = "transform .55s cubic-bezier(.2,.8,.2,1), opacity .18s ease";
          el.style.transform = "translateX(120%)";
          el.style.opacity = "1";
        });
      });
    }
  }, [enableScramble, label, doScramble]);

  const handleMouseLeave = useCallback(() => {
    if (enableScramble && label && spanRef.current) {
      stop(spanRef.current, label);
    }
    if (shineRef.current) {
      const el = shineRef.current;
      el.style.transition = "none";
      el.style.transform = "translateX(-120%)";
      el.style.opacity = "0";
    }
  }, [enableScramble, label, stop]);

  const v = variantStyles[variant];

  return (
    <button
      ref={btnRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "group relative inline-flex items-center justify-center",
        "uppercase tracking-wider select-none whitespace-nowrap font-mono !font-black",
        "transition-[background-color,filter,box-shadow] duration-200 ease-out",
        "border border-white/[.18]",
        "disabled:opacity-50 disabled:pointer-events-none",
        sizeStyles[size],
        v.base,
        v.hover,
        className,
      )}
      style={{
        clipPath: CLIP_PATH,
        borderRadius: "14px 3px 16px",
      }}
      {...props}
    >
      <span
        ref={shineRef}
        aria-hidden
        className="absolute inset-[-2px] pointer-events-none"
        style={{
          clipPath: CLIP_PATH,
          borderRadius: "inherit",
          background: "linear-gradient(110deg, transparent 0%, rgba(255,255,255,.30) 18%, transparent 38%)",
          transform: "translateX(-120%)",
          opacity: 0,
        }}
      />
      {icon && <span className="mr-2 flex-shrink-0">{icon}</span>}
      <span ref={spanRef}>{label || children}</span>
    </button>
  );
};

export default KGenButton;
