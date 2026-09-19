export type HorizontalGestureOwner = 'tab-swipe' | 'inner-horizontal';

export type HorizontalGestureOwnershipReason =
  | 'none'
  | 'default-prevented'
  | 'scroll-container';

export interface HorizontalGestureOwnership {
  owner: HorizontalGestureOwner;
  reason: HorizontalGestureOwnershipReason;
  element: HTMLElement | null;
}

const SCROLL_EPSILON = 1;
const HORIZONTAL_OVERFLOW_VALUES = new Set(['auto', 'scroll', 'overlay']);
const HORIZONTAL_OVERFLOW_CLASSES = new Set([
  'overflow-auto',
  'overflow-scroll',
  'overflow-x-auto',
  'overflow-x-scroll',
]);

function eventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function isHorizontalOverflowContainer(el: HTMLElement): boolean {
  if (el.scrollWidth <= el.clientWidth + SCROLL_EPSILON) return false;
  // Use authored horizontal overflow intent instead of computed overflowX:
  // browsers can normalize overflow-y:auto into computed overflow-x:auto on
  // broad vertical scrollers, which would make ordinary content stop swiping tabs.
  if (HORIZONTAL_OVERFLOW_VALUES.has(el.style.overflowX)) return true;
  if (HORIZONTAL_OVERFLOW_VALUES.has(el.style.overflow)) return true;
  return Array.from(el.classList).some((className) => HORIZONTAL_OVERFLOW_CLASSES.has(className));
}

/**
 * Resolve ownership for app-level horizontal wheel gestures.
 *
 * The top-level tab swipe should only own a gesture when no nested element has
 * a stronger horizontal interaction claim. Ownership is intentionally based on
 * "is this a horizontal interaction island?", not "can it still scroll in this
 * exact direction right now"; handing off at the inner edge is what causes a
 * table/list/preview to unexpectedly switch tabs.
 */
export function resolveHorizontalGestureOwnership(
  event: WheelEvent,
  container: HTMLElement,
): HorizontalGestureOwnership {
  // Only earlier native listeners can make this true before the container's
  // native wheel listener runs. React bubble onWheel handlers run too late for
  // this hook's ownership gate, so React-managed components should expose
  // authored horizontal overflow instead.
  if (event.defaultPrevented) {
    return { owner: 'inner-horizontal', reason: 'default-prevented', element: null };
  }

  let el = eventTargetElement(event.target);
  while (el && el !== container) {
    if (isHorizontalOverflowContainer(el)) {
      return { owner: 'inner-horizontal', reason: 'scroll-container', element: el };
    }

    el = el.parentElement;
  }

  return { owner: 'tab-swipe', reason: 'none', element: null };
}

export function horizontalGestureOwnerTag(element: HTMLElement | null): string {
  return element ? element.tagName.toLowerCase() : 'none';
}
