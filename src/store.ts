import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { Snapshot, Transfer } from "./types";

type State = {
  data: Snapshot | null;
  error: string;
  version: number;
  changed: Record<string, number>;
  refresh: () => Promise<void>;
  transfer: (transfer: Transfer) => void;
  report: (error: unknown) => void;
};
let refreshing: Promise<void> | null = null;
export const useStore = create<State>((set, get) => ({
  data: null,
  error: "",
  version: 0,
  changed: {},
  report: (error) => set({ error: String(error) }),
  transfer: (transfer) =>
    set((state) => ({
      version: state.version + 1,
      changed: { ...state.changed, [transfer.id]: state.version + 1 },
      data: state.data
        ? {
            ...state.data,
            transfers: [
              transfer,
              ...state.data.transfers.filter((item) => item.id !== transfer.id),
            ],
          }
        : null,
    })),
  refresh: () => {
    if (refreshing) return refreshing;
    const version = get().version;
    refreshing = invoke<Snapshot>("snapshot")
      .then((data) =>
        set((state) => {
          const newer =
            state.data?.transfers.filter(
              (item) => (state.changed[item.id] ?? 0) > version,
            ) ?? [];
          return {
            data: {
              ...data,
              transfers: [
                ...newer,
                ...data.transfers.filter(
                  (item) => !newer.some((n) => n.id === item.id),
                ),
              ],
            },
          };
        }),
      )
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  },
}));

export async function command<T = unknown>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(name, args);
}
export async function request<T = unknown>(
  request: Record<string, unknown>,
): Promise<T> {
  return command<T>("local_request", { request });
}
