import { describe, it, expect } from 'vitest';
import { resolveBoundWorkspace } from './workspaceBinding';

const projects = [
    { path: '/home/u/projects/alpha', name: 'Alpha' },
    { path: '/home/u/mino', name: 'Mino' },
    { path: '/home/u/projects/beta', name: 'Beta' },
];

describe('resolveBoundWorkspace', () => {
    it('override 命中 → 钉死该工作区（优先于默认）', () => {
        const r = resolveBoundWorkspace('/home/u/projects/beta', '/home/u/mino', projects);
        expect(r?.path).toBe('/home/u/projects/beta');
    });

    it('override=null → 跟随主端默认工作区', () => {
        const r = resolveBoundWorkspace(null, '/home/u/projects/alpha', projects);
        expect(r?.path).toBe('/home/u/projects/alpha');
    });

    it('override 指向已不存在的工作区 → 落回默认链（不卡死）', () => {
        const r = resolveBoundWorkspace('/home/u/gone', '/home/u/projects/alpha', projects);
        expect(r?.path).toBe('/home/u/projects/alpha');
    });

    it('无 override、无默认 → /mino 后缀兜底', () => {
        const r = resolveBoundWorkspace(undefined, undefined, projects);
        expect(r?.path).toBe('/home/u/mino');
    });

    it('无 override、无默认、无 /mino → 第一个项目', () => {
        const noMino = [
            { path: '/home/u/projects/alpha', name: 'Alpha' },
            { path: '/home/u/projects/beta', name: 'Beta' },
        ];
        expect(resolveBoundWorkspace(undefined, undefined, noMino)?.path).toBe('/home/u/projects/alpha');
    });

    it('默认工作区指向已不存在的路径 → 落到 /mino 兜底', () => {
        const r = resolveBoundWorkspace(null, '/home/u/gone', projects);
        expect(r?.path).toBe('/home/u/mino');
    });

    it('空项目列表 → undefined（caller 抛"没有可用工作区"）', () => {
        expect(resolveBoundWorkspace('/x', '/y', [])).toBeUndefined();
    });

    it('Windows 反斜杠 vs 正斜杠 → workspacePathsEqual 归一（override 仍命中）', () => {
        const winProjects = [{ path: 'C:\\Users\\u\\projects\\alpha', name: 'Alpha' }];
        const r = resolveBoundWorkspace('C:/Users/u/projects/alpha', undefined, winProjects);
        expect(r?.name).toBe('Alpha');
    });
});
