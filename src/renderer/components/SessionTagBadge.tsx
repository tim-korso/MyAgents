/**
 * SessionTagBadge - Tag badges for session sources (IM, Cron, Background)
 * Unified style: colored dot + label, matching WorkspaceCard channel tags
 */

import { useTranslation } from 'react-i18next';
import type { SessionTag } from '@/hooks/useTaskCenterData';

/** Tag color scheme: dot color + text color + bg color */
const TAG_STYLES = {
    /** IM Bot channels — green (matches WorkspaceCard online dot) */
    im: {
        dot: 'bg-[var(--success)]',
        text: 'text-[var(--success)]',
        bg: 'bg-[color-mix(in_srgb,var(--success)_10%,transparent)]',
    },
    /** Cron/scheduled tasks — warm brown */
    cron: {
        dot: 'bg-[var(--accent-warm)]',
        text: 'text-[var(--accent-warm)]',
        bg: 'bg-[var(--accent-warm-subtle)]',
    },
    /** Background completions — muted blue */
    background: {
        dot: 'bg-[var(--accent)]',
        text: 'text-[var(--accent)]',
        bg: 'bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]',
    },
    /** Floating ball desktop channel — info blue（区别于 IM 绿 / 定时棕） */
    floatingBall: {
        dot: 'bg-[var(--info)]',
        text: 'text-[var(--info)]',
        bg: 'bg-[color-mix(in_srgb,var(--info)_10%,transparent)]',
    },
} as const;

export default function SessionTagBadge({ tag }: { tag: SessionTag }) {
    const { t } = useTranslation('app');
    const style = TAG_STYLES[tag.type] ?? TAG_STYLES.im;
    const label = tag.type === 'im' ? tag.platform : t(`sessionTags.${tag.type}`, { defaultValue: tag.type });

    // `leading-none` collapses the badge's line-box to its glyph height so
    // `items-center` in the parent (Chat header / history row) centers the
    // pill against the 14px title's optical baseline rather than against a
    // taller default line-box that would visually float the pill upward.
    return (
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-[3px] text-xs font-medium leading-none ${style.text} ${style.bg}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
            {label}
        </span>
    );
}
