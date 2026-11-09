import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const styles = cva("button", {
  variants: {
    variant: {
      default: "primary",
      secondary: "secondary",
      ghost: "ghost",
      destructive: "destructive",
    },
  },
  defaultVariants: { variant: "secondary" },
});
export function Button({
  className,
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof styles>) {
  return (
    <button
      className={twMerge(clsx(styles({ variant }), className))}
      {...props}
    />
  );
}
