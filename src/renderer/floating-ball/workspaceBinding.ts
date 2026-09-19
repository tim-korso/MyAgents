/**
 * 悬浮球工作区绑定解析（PRD 0.2.34 §14 D17）。纯函数，单测覆盖——抽成独立模块
 * （同 fbDrag.ts / convoAutoFollow.ts）以便在 node 单测池里测，不拉 React/Tauri。
 */
import { workspacePathsEqual } from '../../shared/workspacePath';

/** 悬浮球可绑定的工作区项目（设置面板选择器用）。 */
export interface FbProject {
    path: string;
    name: string;
}

/**
 * 解析悬浮球当前应绑定的工作区。
 * 优先级：① 显式覆盖（钉死，存在即用）→ ② 跟随主端默认工作区 → ③ /mino 后缀
 * 兜底 → ④ 第一个项目。override 指向的工作区已不存在时落回默认链（不卡死）。
 */
export function resolveBoundWorkspace<T extends { path: string }>(
    override: string | null | undefined,
    defaultWorkspacePath: string | undefined,
    projects: T[],
): T | undefined {
    if (override) {
        const pinned = projects.find((p) => workspacePathsEqual(p.path, override));
        if (pinned) return pinned;
        // override 指向的工作区已不存在 → 落回默认链（不要卡死在失效绑定上）。
    }
    if (defaultWorkspacePath) {
        const def = projects.find((p) => workspacePathsEqual(p.path, defaultWorkspacePath));
        if (def) return def;
    }
    return projects.find((p) => p.path.replace(/\\/g, '/').endsWith('/mino')) ?? projects[0];
}
