import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Snapshot } from "./types";
import { App } from "./App";
import { useStore } from "./store";
import { guestLink } from "./invitations";

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
const identity = {
  id: "offline-peer",
  name: "Studio PC",
  public_key: "public",
};
const remote = {
  identity,
  endpoint: "https://127.0.0.1:7443/",
  ca_pem: "public certificate",
};
const snapshot: Snapshot = {
  identity: { ...identity, id: "local", name: "My PC" },
  peers: { "offline-peer": { remote, last_connected: 100 } },
  shares: [
    {
      share: {
        id: "source",
        name: "Projects",
        source: "D:\\Projects",
        audience: { kind: "devices", devices: ["offline-peer"] },
      },
      available: true,
      is_dir: true,
    },
  ],
  transfers: [],
  sessions: [],
  serving: true,
  network: {
    endpoint: remote.endpoint,
    bind: "127.0.0.1:7443",
    lan: ["127.0.0.1/32"],
    advertise: false,
    onboarding: null,
  },
  ca_fingerprint: "fingerprint",
};
beforeEach(() => {
  useStore.setState({ data: null, error: "", version: 0, changed: {} });
  mock.invoke.mockReset();
  mock.invoke.mockImplementation(async (name: string) =>
    name === "snapshot"
      ? structuredClone(snapshot)
      : name === "presence" || name === "discover"
        ? []
        : null,
  );
});

describe("desktop access and transfer flows", () => {
  it("filters and navigates devices from the keyboard, then opens their shares with Enter", async () => {
    const user = userEvent.setup();
    mock.invoke.mockImplementation(async (name: string) =>
      name === "snapshot"
        ? structuredClone(snapshot)
        : name === "presence" || name === "discover"
          ? []
          : name === "local_request"
            ? {
                items: [
                  { id: "remote-share", name: "Reference files", is_dir: true },
                ],
                next_cursor: null,
              }
            : null,
    );
    render(<App />);
    await screen.findByText("Studio PC");
    expect(
      screen.queryByRole("complementary", { name: "Selected item details" }),
    ).toBeNull();
    await user.keyboard("{Control>}f{/Control}");
    const filter = screen.getByRole("textbox", { name: "Filter current list" });
    expect(document.activeElement).toBe(filter);
    await user.type(filter, "missing");
    expect(screen.getByText("No saved devices match “missing”.")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect((filter as HTMLInputElement).value).toBe("");
    await user.type(filter, "studio");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toContain("Studio PC");
    expect(
      screen.getByRole("complementary", { name: "Selected item details" }),
    ).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("button", { name: /Reference files/ }),
    ).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledWith("verify_peer", { remote });
    expect((filter as HTMLInputElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(
      screen.queryByRole("complementary", { name: "Selected item details" }),
    ).toBeNull();
    expect(document.activeElement).toBe(filter);
    expect(
      screen.getByRole("button", { name: /Reference files/ }),
    ).toBeTruthy();
  });

  it("keeps remote file selection while filtering and downloads the selected file through the destination picker", async () => {
    const user = userEvent.setup();
    mock.invoke.mockImplementation(
      async (name: string, args?: { request?: { share?: string } }) => {
        if (name === "snapshot") return structuredClone(snapshot);
        if (name === "presence" || name === "discover") return [];
        if (name === "pick_destination") return "D:\\Downloads";
        if (name === "local_request")
          return {
            items: args?.request?.share
              ? [
                  { id: "notes", name: "notes.txt", is_dir: false, size: 12 },
                  { id: "photo", name: "photo.png", is_dir: false, size: 24 },
                ]
              : [{ id: "remote-share", name: "Reference files", is_dir: true }],
            next_cursor: null,
          };
        return null;
      },
    );
    render(<App />);
    await user.dblClick(
      await screen.findByRole("button", { name: /Studio PC/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Reference files/ }),
    );
    await user.click(
      await screen.findByRole("checkbox", { name: "Select notes.txt" }),
    );
    await user.keyboard("{Control>}f{/Control}");
    await user.type(
      screen.getByRole("textbox", { name: "Filter current list" }),
      "photo",
    );
    expect(
      screen.queryByRole("checkbox", { name: "Select notes.txt" }),
    ).toBeNull();
    expect(screen.getByText("1 selected (max 4)")).toBeTruthy();
    await user.click(
      within(screen.getByRole("main")).getByRole("button", {
        name: "Download",
      }),
    );
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("local_request", {
        request: {
          command: "download",
          remote,
          share: "remote-share",
          entry: "notes",
          destination: "D:\\Downloads",
        },
      }),
    );
  });

  it("opens the command menu with Ctrl+K, focuses search, and runs a command with Enter", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Studio PC");
    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog", { name: "Commands" });
    expect(document.activeElement).toBe(
      screen.getByPlaceholderText("Search devices, shares, and actions…"),
    );
    await user.keyboard("My shares{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen
        .getByRole("button", { name: /My shares/ })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("keeps a newer transfer event when a slower snapshot finishes", async () => {
    useStore.setState({ data: structuredClone(snapshot) });
    let resolve!: (data: Snapshot) => void;
    mock.invoke.mockReturnValueOnce(
      new Promise<Snapshot>((done) => {
        resolve = done;
      }),
    );
    const refresh = useStore.getState().refresh();
    useStore.getState().transfer({
      id: "current",
      remote,
      file: { name: "latest.bin", size: 100 },
      destination: "D:\\latest.bin",
      written: 100,
      state: "verifying",
      error: null,
      bytes_per_second: 0,
    });
    resolve(structuredClone(snapshot));
    await refresh;
    expect(useStore.getState().data?.transfers[0].state).toBe("verifying");
  });
  it("keeps offline peers selectable and grants access without making the source LAN-open", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Studio PC");
    await user.click(screen.getByRole("button", { name: /My shares/ }));
    await user.click(screen.getByRole("button", { name: /Projects/ }));
    await user.click(screen.getByRole("button", { name: /Manage access/ }));
    const checkbox = screen.getByRole("checkbox", {
      name: /Studio PC.*Offline/,
    }) as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.checked).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save access" }));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("set_audience", {
        share: "source",
        audience: { kind: "devices", devices: ["offline-peer"] },
      }),
    );
  });

  it("shows verification across views without presenting it as completion", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Studio PC");
    const transfer = {
      id: "transfer",
      remote,
      file: { name: "large.bin", size: 1000 },
      written: 1000,
      destination: "D:\\Downloads\\large.bin",
      state: "verifying" as const,
      error: null,
      bytes_per_second: 0,
    };
    useStore.getState().transfer(transfer);
    await screen.findByText("large.bin");
    expect(screen.queryByText("File checked and saved")).toBeNull();
    await user.click(screen.getByRole("button", { name: /My shares/ }));
    expect(screen.getByText("large.bin")).toBeTruthy();
    expect(screen.getByText(/Checking file from Studio PC/)).toBeTruthy();
  });

  it("returns from network setup to connecting a device and preserves the original sharing dialog", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Studio PC");
    await user.click(screen.getByRole("button", { name: /My shares/ }));
    await user.click(screen.getByRole("button", { name: /Projects/ }));
    await user.click(screen.getByRole("button", { name: /Manage access/ }));
    await user.click(
      screen.getByRole("button", { name: "Connect a new device" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Set up network sharing",
      }),
    );
    await screen.findByRole("dialog", { name: "Connection settings" });
    await user.click(screen.getByRole("button", { name: "Close" }));
    await screen.findByRole("dialog", { name: "Add a device" });
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    await screen.findByRole("dialog", { name: "Who can access?" });
    expect(
      (
        screen.getByRole("checkbox", {
          name: /Studio PC.*Offline/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("builds browser invitations from the ulak prefix and keeps the credential in the fragment", () => {
    const encoded =
      "ulak:" +
      btoa(JSON.stringify({ host: remote, token: "single-use-token" }))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    const url = new URL(guestLink(encoded));
    expect(url.search).toBe("");
    expect(url.hash).toBe("#invite=single-use-token");
  });
});
