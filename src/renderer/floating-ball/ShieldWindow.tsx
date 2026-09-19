import { useCallback, useRef, type SyntheticEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';

import './fb.css';

export default function ShieldWindow() {
    const dismissingRef = useRef(false);

    const dismiss = useCallback((event: SyntheticEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (dismissingRef.current) return;
        dismissingRef.current = true;
        void invoke('cmd_fb_shield_dismiss')
            .catch((err) => {
                console.warn('[fb-shield] dismiss failed:', err);
            })
            .finally(() => {
                window.setTimeout(() => {
                    dismissingRef.current = false;
                }, 250);
            });
    }, []);

    return (
        <div
            className="fbw-shield"
            onContextMenu={dismiss}
            onMouseDown={dismiss}
            onPointerDown={dismiss}
            onWheel={dismiss}
        />
    );
}
