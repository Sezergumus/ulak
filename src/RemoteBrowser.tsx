import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  File,
  Folder,
  LoaderCircle,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { command, request } from "./store";
import { size, type Entry, type Page, type Remote } from "./types";
type Location = {
  name: string;
  share: string | null;
  entry: string | null;
  cursor: string | null;
};
export function RemoteBrowser({
  remote,
  onBack,
  run,
  setPreparing,
  query,
}: {
  remote: Remote;
  onBack: () => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  setPreparing: (update: (value: number) => number) => void;
  query: string;
}) {
  const [locations, setLocations] = useState<Location[]>([
    { name: remote.identity.name, share: null, entry: null, cursor: null },
  ]);
  const [page, setPage] = useState<Page>({ items: [], next_cursor: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const sequence = useRef(0);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const location = locations[locations.length - 1];
  const visibleItems = page.items.filter((item) =>
    item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  useEffect(() => {
    const current = ++sequence.current;
    setLoading(true);
    setError("");
    setSelection([]);
    setReady(false);
    void request<Page>({
      command: "list",
      remote,
      share: location.share,
      entry: location.entry,
      cursor: location.cursor,
    })
      .then((page) => {
        if (current === sequence.current) setPage(page);
      })
      .catch((error) => {
        if (current === sequence.current) setError(String(error));
      })
      .finally(() => {
        if (current === sequence.current) setLoading(false);
      });
    return () => {
      sequence.current++;
    };
  }, [remote, location]);
  const download = async (item?: Entry) => {
    const destination = await command<string | null>("pick_destination");
    if (!destination) return;
    setPreparing((value) => value + 1);
    try {
      if (item?.is_dir)
        await request({
          command: "folder",
          remote,
          share: location.share,
          entry: item.id,
          destination: `${destination}/${item.name}`,
        });
      else if (item)
        await request({
          command: "download",
          remote,
          share: location.share,
          entry: item.id,
          destination,
        });
      else {
        const items = page.items.filter((item) => selection.includes(item.id));
        // Core queue and stream limits remain authoritative; this UI sends at most four at a time.
        const results = await Promise.allSettled(
          items.map((item) =>
            request({
              command: "download",
              remote,
              share: location.share,
              entry: item.id,
              destination,
            }),
          ),
        );
        const errors = results.filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (errors.length)
          throw new Error(
            errors.map((error) => String(error.reason)).join("; "),
          );
      }
    } finally {
      setPreparing((value) => value - 1);
    }
  };
  const toggle = (id: string, checked: boolean) => {
    setReady(false);
    setSelection((current) =>
      checked
        ? [...current, id].slice(0, 4)
        : current.filter((value) => value !== id),
    );
  };
  const prepare = async () => {
    await command("prepare_drag", {
      remote,
      share: location.share,
      entries: selection,
    });
    setReady(true);
  };
  return (
    <div className="remote-browser">
      <div className="browse-header">
        <Button
          variant="ghost"
          onClick={() =>
            locations.length > 1
              ? setLocations((current) => current.slice(0, -1))
              : onBack()
          }
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </Button>
        <span>
          {locations.map((item, index) => (
            <button
              key={index}
              onClick={() =>
                setLocations((current) => current.slice(0, index + 1))
              }
            >
              {item.name}
              {index < locations.length - 1 && <ChevronRight size={13} />}
            </button>
          ))}
        </span>
      </div>
      {location.share && (
        <div className="browse-actions">
          <span className="muted">{selection.length} selected (max 4)</span>
          <Button
            disabled={!selection.length || loading}
            onClick={() => run(() => download())}
          >
            <ArrowDownToLine size={14} />
            Download
          </Button>
          <Button
            disabled={!selection.length || loading}
            onClick={() => run(prepare)}
          >
            Prepare Explorer drag
          </Button>
        </div>
      )}
      {ready && (
        <button
          className="drag-handle"
          onPointerDown={(event) => {
            if (event.button === 0)
              dragStart.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={() => {
            dragStart.current = null;
          }}
          onPointerLeave={() => {
            if (dragStart.current) {
              dragStart.current = null;
              void run(async () => {
                const copied = await command<boolean>("drag_out");
                setReady(false);
                if (!copied)
                  setError(
                    "Explorer drag cancelled. Prepare the selection to try again.",
                  );
              });
            }
          }}
          onPointerMove={(event) => {
            const start = dragStart.current;
            if (
              start &&
              event.buttons === 1 &&
              Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5
            ) {
              dragStart.current = null;
              void run(async () => {
                const copied = await command<boolean>("drag_out");
                setReady(false);
                if (!copied)
                  setError(
                    "Explorer drag cancelled. Prepare the selection to try again.",
                  );
              });
            }
          }}
        >
          Drag selected files from here into Explorer
        </button>
      )}
      {loading ? (
        <p className="quiet">
          <LoaderCircle size={18} className="spin" />
          Loading permitted content…
        </p>
      ) : error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : (
        <>
          {!!visibleItems.length && (
            <div className="file-columns" aria-hidden="true">
              <span>Name</span>
              <span>Size / type</span>
            </div>
          )}
          {visibleItems.map((item) => (
            <div className="list-row" key={item.id}>
              {location.share && !item.is_dir ? (
                <input
                  type="checkbox"
                  aria-label={`Select ${item.name}`}
                  checked={selection.includes(item.id)}
                  disabled={
                    selection.length >= 4 && !selection.includes(item.id)
                  }
                  onChange={(event) => toggle(item.id, event.target.checked)}
                />
              ) : (
                <span className="checkbox-spacer" />
              )}
              <span className="item-icon warm">
                {item.is_dir ? <Folder size={20} /> : <File size={20} />}
              </span>
              <button
                className="row-name row-link"
                data-list-item
                disabled={item.available === false}
                onClick={() => {
                  if (!location.share || item.is_dir)
                    setLocations((current) => [
                      ...current,
                      {
                        name: item.name,
                        share: location.share ?? item.id,
                        entry: location.share ? item.id : null,
                        cursor: null,
                      },
                    ]);
                  else void run(() => download(item));
                }}
              >
                {item.name}
              </button>
              <span className="file-meta">
                {item.available === false
                  ? "Unavailable"
                  : item.is_dir
                    ? "Folder"
                    : item.size !== undefined
                      ? size(item.size)
                      : "File"}
              </span>
              {location.share && (
                <Button
                  variant="ghost"
                  aria-label={`Download ${item.name}`}
                  onClick={() => run(() => download(item))}
                >
                  <ArrowDownToLine size={16} />
                </Button>
              )}
              <ChevronRight size={14} />
            </div>
          ))}
          {!visibleItems.length && (
            <p className="quiet">
              {query
                ? `No files match “${query}” on this page.`
                : "No accessible content in this location."}
            </p>
          )}
          <div className="pagination">
            {page.next_cursor && (
              <Button
                onClick={() =>
                  setLocations((current) => [
                    ...current,
                    {
                      ...location,
                      name: "Next page",
                      cursor: page.next_cursor,
                    },
                  ])
                }
              >
                Next page <ArrowRight size={15} />
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
