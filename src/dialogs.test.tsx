import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectDialog, NetworkDialog } from "./dialogs";
import { useStore } from "./store";
import type { Snapshot } from "./types";

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
const remote = {
  identity: { id: "other-pc", name: "Studio PC", public_key: "public" },
  endpoint: "https://192.168.42.10:7443/",
  ca_pem: "certificate",
};
const snapshot: Snapshot = {
  identity: { id: "local", name: "My PC", public_key: "public" },
  peers: {},
  shares: [],
  sessions: [],
  transfers: [],
  serving: true,
  network: {
    endpoint: "https://192.168.42.20:7443/",
    bind: "192.168.42.20:7443",
    lan: ["192.168.42.0/23"],
    advertise: true,
    onboarding: null,
  },
  ca_fingerprint: "security-code",
};
const invitation =
  "ulak:" +
  btoa(
    JSON.stringify({
      host: remote,
      token: "one-use-secret",
      expires_at: Math.floor(Date.now() / 1000) + 300,
    }),
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

beforeEach(() => {
  useStore.setState({
    data: structuredClone(snapshot),
    error: "",
    version: 0,
    changed: {},
  });
  mock.invoke.mockReset();
  mock.invoke.mockImplementation(async (name: string) =>
    name === "snapshot"
      ? structuredClone(snapshot)
      : name === "invitation"
        ? invitation
        : name === "network_choices"
          ? [{ name: "Wi-Fi", address: "10.24.5.9", range: "10.24.0.0/16" }]
          : null,
  );
});

describe("simple connection setup", () => {
  it("creates and copies an invitation in the same dialog without asking for a certificate code", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(
      <ConnectDialog
        onClose={vi.fn()}
        onRemote={vi.fn()}
        onNetwork={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Create an invitation" }),
    );
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(mock.invoke).toHaveBeenCalledWith("invitation", {
      endpoint: snapshot.network.endpoint,
    });
    expect(
      (
        screen.getByRole("textbox", {
          name: "Your invitation",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(invitation);
    await user.click(screen.getByRole("button", { name: "Copy invitation" }));
    expect(copy).toHaveBeenCalledWith(invitation);
    expect(screen.queryByText(/Security code/)).toBeNull();
  });

  it("connects using the full invitation and keeps identity verification in the native pairing command", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(
      <ConnectDialog onClose={close} onRemote={vi.fn()} onNetwork={vi.fn()} />,
    );
    await user.type(
      screen.getByRole("textbox", {
        name: "Invitation from the other computer",
      }),
      invitation,
    );
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("pair", {
        invitation,
        endpoint: snapshot.network.endpoint,
      }),
    );
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mock.invoke).toHaveBeenCalledWith("snapshot");
  });

  it("rejects an invitation from a different discovered device before attempting to pair", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(
      <ConnectDialog
        target={{
          id: "different-pc",
          name: "Office PC",
          endpoints: [],
          paired: false,
          verified: false,
        }}
        onClose={close}
        onRemote={vi.fn()}
        onNetwork={vi.fn()}
      />,
    );
    await user.type(
      screen.getByRole("textbox", {
        name: "Invitation from the other computer",
      }),
      invitation,
    );
    await user.click(
      screen.getByRole("button", { name: "Connect to Office PC" }),
    );
    expect(screen.getByRole("alert").textContent).toContain("different device");
    expect(mock.invoke.mock.calls.some(([name]) => name === "pair")).toBe(
      false,
    );
    expect(close).not.toHaveBeenCalled();
  });

  it("keeps the dialog open when the native service rejects an invitation", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    mock.invoke.mockRejectedValueOnce("Invitation expired or already used");
    render(
      <ConnectDialog onClose={close} onRemote={vi.fn()} onNetwork={vi.fn()} />,
    );
    await user.type(
      screen.getByRole("textbox", {
        name: "Invitation from the other computer",
      }),
      invitation,
    );
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "create a new one",
    );
    expect(close).not.toHaveBeenCalled();
  });

  it("offers network setup instead of generating an unreachable invitation on a new installation", async () => {
    const user = userEvent.setup();
    useStore.setState({
      data: {
        ...structuredClone(snapshot),
        network: { ...snapshot.network, endpoint: "https://127.0.0.1:7443/" },
      },
    });
    const setup = vi.fn();
    render(
      <ConnectDialog
        initialMode="create"
        onClose={vi.fn()}
        onRemote={vi.fn()}
        onNetwork={setup}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Create invitation",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(
      screen.getByRole("button", { name: "Set up network sharing" }),
    );
    expect(setup).toHaveBeenCalledOnce();
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("uses the chosen adapter's actual network range and applies only after the user saves", async () => {
    const user = userEvent.setup();
    render(<NetworkDialog network={snapshot.network} onClose={vi.fn()} />);
    await screen.findByRole("option", { name: "Wi-Fi · 10.24.5.9" });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Share over" }),
      "10.24.5.9",
    );
    expect(
      mock.invoke.mock.calls.some(([name]) => name === "apply_network"),
    ).toBe(false);
    expect(screen.getByText("Advanced settings").closest("details")?.open).toBe(
      false,
    );
    await user.click(screen.getByRole("button", { name: "Apply settings" }));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("apply_network", {
        name: "My PC",
        network: {
          endpoint: "https://10.24.5.9:7443/",
          bind: "10.24.5.9:7443",
          lan: ["10.24.0.0/16"],
          advertise: true,
          onboarding: null,
        },
      }),
    );
  });
});
