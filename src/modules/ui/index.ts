/**
 * The shared result vocabulary. A module file imports from here and nowhere
 * else for layout, which is what keeps sixteen screens looking like one app.
 */
export { BadgeRow, type Badge } from "./BadgeRow"
export { EmptyState } from "./EmptyState"
export { FieldGrid, type Field } from "./FieldGrid"
export { LockedSection, PLANS_URL } from "./LockedSection"
export { ProfileCard } from "./ProfileCard"
export { RecordCard, type LeakField, type LeakRecord } from "./RecordCard"
export { Section } from "./Section"
export { StatTiles, type StatTile } from "./StatTiles"
