import { useEffect, useState, type ReactNode, type Ref } from "react";
import { LoaderCircle, Monitor, Radio } from "lucide-react";

export type RadarDevice = { id: string; name: string };

// Positions are decorative: they never encode distance, direction, or signal
// strength. Each device keeps a stable slot derived from its identity so that
// a newly found device does not reshuffle the others.
const SLOTS: [number, number][] = [
  [-38, 0.62],
  [148, 0.66],
  [32, 0.86],
  [212, 0.86],
  [-112, 0.9],
  [96, 0.92],
  [-160, 0.62],
  [-8, 0.95],
];
export const RADAR_CAPACITY = SLOTS.length;

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1)
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function placements(devices: RadarDevice[]) {
  const taken = new Set<number>();
  const result = new Map<string, number>();
  for (const device of [...devices].sort((a, b) => a.id.localeCompare(b.id))) {
    let slot = hash(device.id) % SLOTS.length;
    while (taken.has(slot)) slot = (slot + 1) % SLOTS.length;
    taken.add(slot);
    result.set(device.id, slot);
  }
  return result;
}

// Keep the pulse visible for at least one full wave, so that a fast discovery
// response does not produce a single-frame flicker.
function useMinimumDuration(active: boolean, milliseconds: number) {
  const [visible, setVisible] = useState(active);
  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const timer = window.setTimeout(() => setVisible(false), milliseconds);
    return () => clearTimeout(timer);
  }, [active, milliseconds]);
  return visible;
}

export function Radar({
  devices,
  scanning,
  dimmed = false,
  busy = "",
  label,
  status,
  onSelect,
  firstRef,
  action = "Pair",
}: {
  devices: RadarDevice[];
  scanning: boolean;
  dimmed?: boolean;
  busy?: string;
  label: string;
  status: ReactNode;
  onSelect?: (device: RadarDevice) => void;
  firstRef?: Ref<HTMLButtonElement>;
  action?: string;
}) {
  const pulsing = useMinimumDuration(scanning && !dimmed, 1800);
  const shown = devices.slice(0, RADAR_CAPACITY);
  const slots = placements(shown);
  return (
    <div
      className={`radar ${pulsing ? "scanning" : ""} ${dimmed ? "dimmed" : ""}`}
    >
      <div className="radar-stage">
        <div className="radar-field" aria-hidden="true">
          <span className="ring r1" />
          <span className="ring r2" />
          <span className="ring r3" />
          <span className="ring r4" />
          <span className="radar-sweep" />
          <span className="radar-wave" />
          <span className="radar-wave late" />
        </div>
        <div className="radar-center" aria-hidden="true">
          <Radio size={18} />
        </div>
        <div className="radar-devices" role="group" aria-label={label}>
          {shown.map((device, index) => {
            const [angle, distance] = SLOTS[slots.get(device.id) ?? 0];
            const radians = (angle * Math.PI) / 180;
            return (
              <button
                key={device.id}
                ref={index === 0 ? firstRef : undefined}
                className="radar-chip nearby-device"
                data-list-item
                disabled={!!busy || !onSelect}
                style={{
                  left: `calc(50% + ${Math.cos(radians) * distance * 34}%)`,
                  top: `calc(50% + ${Math.sin(radians) * distance * 40}%)`,
                  animationDelay: `${index * 45}ms`,
                }}
                onClick={() => onSelect?.(device)}
              >
                <span className="radar-chip-icon">
                  <Monitor size={16} />
                </span>
                <span className="radar-chip-name">{device.name}</span>
                {busy === device.id ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <small>{action}</small>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <p className="radar-status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
