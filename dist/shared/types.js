export const COLORS = ["ruby", "sapphire", "emerald", "sun"];
export const OUTER_TRACK_LAST_PROGRESS = 50;
export const HOME_LANE_START_PROGRESS = 51;
export const HOME_FINISH_PROGRESS = 56;
export const COLOR_META = {
    emerald: { label: "Emerald", hex: "#20c87a", start: 0, safe: [0, 8] },
    sun: { label: "Sun", hex: "#ffc742", start: 13, safe: [13, 21] },
    sapphire: { label: "Sapphire", hex: "#3485ff", start: 26, safe: [26, 34] },
    ruby: { label: "Ruby", hex: "#ff3b5f", start: 39, safe: [39, 47] }
};
export const GLOBAL_SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
