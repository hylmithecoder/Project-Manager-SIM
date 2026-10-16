import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline" | "ghost";
const base =
  "inline-flex min-h-[44px] h-[54px] w-full items-center justify-center gap-3 rounded-btn px-5 text-base font-semibold " +
  "transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 " +
  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary shadow-glow hover:bg-primary-strong",
  outline:
    "border-[1.5px] border-line bg-bg text-ink shadow-soft hover:bg-floor/60",
  ghost: "text-accent-text hover:bg-primary-soft",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(({ variant = "primary", className = "", ...props }, ref) => (
  <button
    ref={ref}
    className={`${base} ${variants[variant]} ${className}`}
    {...props}
  />
));
Button.displayName = "Button";
