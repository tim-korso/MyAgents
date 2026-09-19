import { useCallback } from 'react';
import { i18n } from '@/i18n';
import { useToastOptional } from '@/components/Toast';
import type { TranscriptSaveStatus } from '../../shared/sessionTranscript';
import { TranscriptSaveNotices } from './transcriptSaveNotices';

// The app's ToastProvider is stable for the window lifetime. A WeakMap shares
// consumption across Tab/Companion mounts and releases it with that window.
const consumers = new WeakMap<object, TranscriptSaveNotices>();

export function useTranscriptSaveToast() {
    const toast = useToastOptional();
    return useCallback((status: TranscriptSaveStatus, backgroundSessionTitle?: string) => {
        if (!toast) return;
        let notices = consumers.get(toast);
        if (!notices) { notices = new TranscriptSaveNotices(); consumers.set(toast, notices); }
        const notice = notices.consume(status);
        if (!notice) return;
        const body = String(i18n.t(`chat:transcriptSave.${notice}`));
        const message = backgroundSessionTitle ? `${backgroundSessionTitle}：${body}` : body;
        if (notice === 'warning') toast.warning(message, 5000);
        else toast.info(message, 3000);
    }, [toast]);
}
