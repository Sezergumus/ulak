import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode, RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "./button";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  initialFocusRef,
  className,
  hideHeader = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  hideHeader?: boolean;
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="overlay" />
        <DialogPrimitive.Content
          className={`dialog ${className ?? ""}`}
          onOpenAutoFocus={(event) => {
            if (initialFocusRef?.current) {
              event.preventDefault();
              initialFocusRef.current.focus();
            }
          }}
        >
          <header className={hideHeader ? "sr-only" : undefined}>
            <div>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description>
                {description}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" aria-label="Close dialog">
                <X size={18} />
              </Button>
            </DialogPrimitive.Close>
          </header>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
