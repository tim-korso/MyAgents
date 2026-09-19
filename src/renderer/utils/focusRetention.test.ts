import { describe, expect, it, vi } from 'vitest';

import { retainFocusOnMouseDown } from './focusRetention';

function mouseEvent(button: number) {
  return { button, preventDefault: vi.fn() } as unknown as React.MouseEvent;
}

describe('retainFocusOnMouseDown', () => {
  it('preventDefault on the primary (left) button — keeps focus on the prior input', () => {
    const e = mouseEvent(0);
    retainFocusOnMouseDown(e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('does NOT preventDefault on middle/right button — leaves native right-click intact', () => {
    // Guards the regression where focus-routing rows that also handle
    // onContextMenu had their native right-click swallowed.
    const middle = mouseEvent(1);
    retainFocusOnMouseDown(middle);
    expect(middle.preventDefault).not.toHaveBeenCalled();

    const right = mouseEvent(2);
    retainFocusOnMouseDown(right);
    expect(right.preventDefault).not.toHaveBeenCalled();
  });
});
