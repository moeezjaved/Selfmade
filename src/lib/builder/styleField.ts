/**
 * Advanced Page Builder — per-device StyleProps field read/write (Phase 3, the property panel's engine).
 *
 * A StyleProps value is either a flat value or a { base, mobile } responsive override. The property panel
 * edits ONE device at a time (the device shown on the canvas), so these helpers translate a control's
 * value ↔ the responsive shape:
 *   - readField  → the value to show in the control for `device` (mobile inherits base when unset)
 *   - hasOverride→ whether `device` has its own explicit value (so the panel can flag "set on mobile")
 *   - writeField → a { [key]: newResponsiveValue } patch, keeping the other device's value intact and
 *     collapsing back to a flat value / clearing the key when an override is removed.
 *
 * Pure — no React, no DB. patchStyle (docOps) applies the returned patch.
 */
import { resolveStyle, type StyleProps, type Device } from './schema'

export type StyleKey = keyof StyleProps
type Resp = { base?: unknown; mobile?: unknown }

const isResp = (v: unknown): v is Resp =>
  !!v && typeof v === 'object' && ('base' in (v as object) || 'mobile' in (v as object))
const isEmpty = (v: unknown) => v === undefined || v === null || v === ''

/** The value a control should display for `device` (mobile falls back to the base value). */
export function readField(style: StyleProps, key: StyleKey, device: Device): unknown {
  return resolveStyle(style[key] as never, device)
}

/** Does `device` carry its own explicit value for `key` (vs inheriting)? */
export function hasOverride(style: StyleProps, key: StyleKey, device: Device): boolean {
  const v = style[key] as unknown
  if (device === 'mobile') return isResp(v) && v.mobile != null
  return v != null && (!isResp(v) || v.base != null)
}

/** A patch setting `key` for `device` to `value` (or clearing that device's override if value is empty),
 * preserving the other device. Returns { [key]: <flat | {base,mobile} | undefined> }. */
export function writeField(style: StyleProps, key: StyleKey, device: Device, value: unknown): Partial<StyleProps> {
  const prev = style[key] as unknown
  const base = isResp(prev) ? prev.base : prev
  const mobile = isResp(prev) ? prev.mobile : undefined
  let next: unknown

  if (device === 'mobile') {
    if (isEmpty(value)) next = isEmpty(base) ? undefined : base           // drop mobile → collapse to base
    else next = { base, mobile: value }
  } else {
    if (isEmpty(value)) next = isEmpty(mobile) ? undefined : { mobile }   // drop base → keep mobile-only
    else next = isEmpty(mobile) ? value : { base: value, mobile }
  }
  return { [key]: next } as Partial<StyleProps>
}
