import { useEffect, useRef, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import {
  ArrowDown,
  ArrowUp,
  CornerDownLeft,
  Radio,
  Search,
} from "lucide-react";
import { Dialog } from "./components/ui/dialog";

export type MenuAction = {
  id: string;
  label: string;
  description: string;
  group: "Suggestions" | "Devices" | "Shares" | "Actions";
  icon: ReactNode;
  shortcut?: string;
  keywords?: string[];
  action: () => void;
  verb?: string;
};
export function CommandMenu({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: MenuAction[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected("");
    }
  }, [open]);
  const current = actions.find((action) => action.id === selected);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Commands"
      description="Search devices, shares, and actions. Use arrow keys to choose and Enter to open."
      initialFocusRef={input}
      className="command-dialog"
      hideHeader
    >
      <Command
        className="command-menu"
        value={selected}
        onValueChange={setSelected}
        loop
      >
        <div className="command-search">
          <Search size={20} />
          <Command.Input
            ref={input}
            value={query}
            onValueChange={setQuery}
            placeholder="Search devices, shares, and actions…"
          />
          <button
            className="command-escape"
            onClick={onClose}
            aria-label="Close commands"
          >
            <kbd>Esc</kbd>
          </button>
        </div>
        <Command.List>
          <Command.Empty>
            No results. Try a device name or an action like “Add share”.
          </Command.Empty>
          {(["Suggestions", "Devices", "Shares", "Actions"] as const)
            .filter((group) => actions.some((action) => action.group === group))
            .map((group) => (
              <Command.Group heading={group} key={group}>
                {actions
                  .filter((action) => action.group === group)
                  .map((action) => (
                    <Command.Item
                      key={action.id}
                      value={action.id}
                      keywords={[
                        action.label,
                        action.description,
                        ...(action.keywords ?? []),
                      ]}
                      onSelect={() => {
                        onClose();
                        action.action();
                      }}
                    >
                      <span className="command-icon">{action.icon}</span>
                      <span className="command-copy">
                        <b data-command-title>{action.label}</b>
                        <small>{action.description}</small>
                      </span>
                      {action.shortcut ? (
                        <kbd>{action.shortcut}</kbd>
                      ) : (
                        <span className="command-kind">
                          {action.group === "Devices"
                            ? "Device"
                            : action.group === "Shares"
                              ? "Share"
                              : "Action"}
                        </span>
                      )}
                    </Command.Item>
                  ))}
              </Command.Group>
            ))}
        </Command.List>
        <footer className="command-footer">
          <span>
            <Radio size={14} />
            Ulak
          </span>
          <span className="command-navigation">
            <kbd>
              <ArrowUp size={11} />
              <ArrowDown size={11} />
            </kbd>{" "}
            Navigate
          </span>
          <span className="command-primary">
            {current?.verb ?? "Open"}
            <kbd>
              <CornerDownLeft size={13} />
            </kbd>
          </span>
        </footer>
      </Command>
    </Dialog>
  );
}
