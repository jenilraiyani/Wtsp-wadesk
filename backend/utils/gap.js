const DEFAULT_GAP_SEC = 3;
const MAX_GAP_SEC = 3600;

const toSeconds = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.round(num);
};

/** Returns { minGap, maxGap } in seconds; missing values keep the old fixed 3s gap. */
const resolveGap = (minGap, maxGap) => {
    let min = toSeconds(minGap);
    let max = toSeconds(maxGap);
    if (min == null && max == null) return { minGap: DEFAULT_GAP_SEC, maxGap: DEFAULT_GAP_SEC };
    if (min == null) min = max;
    if (max == null) max = min;
    if (min < 1 || max < 1) throw new Error('Gap must be at least 1 second.');
    if (min > MAX_GAP_SEC || max > MAX_GAP_SEC) throw new Error(`Gap cannot be more than ${MAX_GAP_SEC} seconds.`);
    if (max < min) throw new Error('Max gap must be greater than or equal to min gap.');
    return { minGap: min, maxGap: max };
};

const randomGapMs = ({ minGap, maxGap }) => {
    const sec = minGap + Math.random() * (maxGap - minGap);
    return Math.round(sec * 1000);
};

module.exports = { resolveGap, randomGapMs, DEFAULT_GAP_SEC };
