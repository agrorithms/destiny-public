'use client';

export const TIME_RANGE_PRESETS = [
    { value: 1, label: '1h' },
    { value: 2, label: '2h' },
    { value: 6, label: '6h' },
    { value: 12, label: '12h' },
    { value: 24, label: '24h' },
    { value: 48, label: '48h' },
    { value: 168, label: '7d' },
    { value: 720, label: '30d' },
] as const;

export const TIME_RANGE_VALUES = TIME_RANGE_PRESETS.map((preset) => preset.value);
export const DEFAULT_TIME_RANGE_HOURS = 24;

interface TimeSliderProps {
    value: number;
    onChange: (value: number) => void;
}

export function isTimeRangePreset(value: number): value is (typeof TIME_RANGE_VALUES)[number] {
    return TIME_RANGE_VALUES.includes(value as (typeof TIME_RANGE_VALUES)[number]);
}

export function formatTimeRange(hours: number): string {
    if (hours === 1) return '1 hour';
    if (hours === 168) return '7 days';
    if (hours === 720) return '30 days';
    return `${hours} hours`;
}

export default function TimeSlider({ value, onChange }: TimeSliderProps) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium ui-text-secondary">
                    Time Window
                </label>
                <span className="text-sm font-bold ui-text-primary">
                    Last {formatTimeRange(value)}
                </span>
            </div>
            <div className="flex flex-wrap gap-2">
                {TIME_RANGE_PRESETS.map((preset) => (
                    <button
                        key={preset.value}
                        type="button"
                        onClick={() => onChange(preset.value)}
                        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${value === preset.value
                            ? 'ui-toggle-active'
                            : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                            }`}
                        aria-pressed={value === preset.value}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
