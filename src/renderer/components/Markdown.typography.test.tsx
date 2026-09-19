import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import Markdown from "./Markdown";

const markdownStyles = readFileSync(
  resolve(process.cwd(), "src/renderer/components/Markdown.css"),
  "utf8",
);
const codeBlockSource = readFileSync(
  resolve(process.cwd(), "src/renderer/components/markdown/CodeBlock.tsx"),
  "utf8",
);

describe("Markdown typography contract", () => {
  it("contributes content widths for short IDs, line breaks and long Chinese cells", () => {
    const { container } = render(<Markdown raw>{"| 编号 | 成员 | 描述 |\n| --- | --- | --- |\n| 01 | 张明<br>产品经理 | 完成需求分析并整理用户反馈和功能优先级 |"}</Markdown>);
    const cells = container.querySelectorAll("tbody td");
    expect([...cells].map(cell => cell.getAttribute("data-table-sizing"))).toEqual([
      "01", "张明\n产品经理", "完成需求分析并整理用户反馈和功能优先级",
    ]);
    expect(cells[0].textContent).toBe("01");
    expect(cells[1].querySelectorAll("br")).toHaveLength(1);
  });
  it("uses one default rhythm for normal chat and document rendering", () => {
    const { container } = render(
      <Markdown raw>
        {[
          "# Release notes",
          "",
          "A paragraph with **important context**.",
          "",
          "- First item",
          "- Second item",
          "  - Nested item",
          "",
          "> Quoted guidance",
          "",
          "| Name | State |",
          "| --- | --- |",
          "| Renderer | Ready |",
        ].join("\n")}
      </Markdown>,
    );

    const root = container.querySelector(".markdown-content");
    expect(root).toBeInTheDocument();
    expect(root).toHaveClass("min-w-0", "max-w-full");
    expect(root).not.toHaveClass("markdown-content--compact");
    expect(root?.querySelector("h1")).toHaveClass(
      "markdown-heading",
      "markdown-h1",
    );
    expect(root?.querySelector("p")).toHaveClass("markdown-paragraph");
    expect(root?.querySelector("strong")).toHaveClass("markdown-strong");
    expect(root?.querySelector("ul")).toHaveClass(
      "markdown-list",
      "markdown-list-unordered",
    );
    expect(root?.querySelector("li")).toHaveClass("markdown-list-item");
    expect(root?.querySelector("blockquote")).toHaveClass(
      "markdown-blockquote",
    );
    expect(root?.querySelector("table")?.closest(".markdown-table")).toHaveClass(
      "markdown-table",
      "max-w-full",
    );
  });

  it("keeps wide code content inside the host width", () => {
    expect(codeBlockSource).toContain(
      "w-full min-w-0 max-w-full overflow-hidden",
    );
    expect(codeBlockSource).toContain('className="overflow-x-auto"');
  });

  it("makes compact a whole-system density variant", () => {
    const { container } = render(
      <Markdown compact raw>
        {"## Compact heading\n\nCompact paragraph.\n\n1. First\n2. Second"}
      </Markdown>,
    );

    expect(container.querySelector(".markdown-content")).toHaveClass(
      "markdown-content--compact",
    );
    expect(markdownStyles).toMatch(
      /\.markdown-content--compact\s*\{[\s\S]*?--markdown-font-size:\s*var\(--text-sm\)/,
    );
    expect(markdownStyles).toMatch(
      /\.markdown-content--compact\s*\{[\s\S]*?--markdown-line-height:\s*1\.55/,
    );
    expect(markdownStyles).toMatch(
      /\.markdown-content--compact\s*\{[\s\S]*?--markdown-list-item-gap:\s*var\(--space-1\)/,
    );
    expect(markdownStyles).toMatch(
      /\.markdown-content--compact\s*\{[\s\S]*?--markdown-list-indent:\s*var\(--space-6\)/,
    );
  });

  it("pins the default readable-but-clustered rhythm", () => {
    expect(markdownStyles).toMatch(
      /\.markdown-content\s*\{[\s\S]*?--markdown-line-height:\s*1\.625/,
    );
    expect(markdownStyles).toMatch(
      /\.markdown-content\s*\{[\s\S]*?--markdown-flow-gap:\s*var\(--space-3\)/,
    );
    expect(markdownStyles).toMatch(
      /\.markdown-content\s*\{[\s\S]*?--markdown-list-block-gap:\s*var\(--space-2\)/,
    );
    expect(markdownStyles).toMatch(
      /\.markdown-content\s*\{[\s\S]*?--markdown-list-item-gap:\s*var\(--space-1\)/,
    );
    expect(markdownStyles).toMatch(
      /\.markdown-content\s*\{[\s\S]*?--markdown-list-indent:\s*var\(--space-6\)/,
    );
    expect(markdownStyles).toMatch(
      /\.markdown-list\s*\{[\s\S]*?margin-inline-start:\s*var\(--markdown-list-indent\)/,
    );
    expect(markdownStyles).toMatch(
      /\.markdown-strong\s*\{[\s\S]*?font-weight:\s*var\(--font-weight-emphasis\)/,
    );
  });

  it("preserves GFM column alignment on both headers and cells", () => {
    const { container } = render(<Markdown raw>{"| Name | State | Value |\n| :--- | :---: | ---: |\n| OpenAI | Ready | 100 |"}</Markdown>);
    for (const tag of ["th", "td"]) {
      const cells = container.querySelectorAll(tag);
      expect(cells[0]).toHaveStyle({ textAlign: "left" });
      expect(cells[1]).toHaveStyle({ textAlign: "center" });
      expect(cells[2]).toHaveStyle({ textAlign: "right" });
    }
  });

  it("preserves sanitized footnote headings and safe content-extension semantics", () => {
    const { container } = render(<Markdown raw>{[
      "Text with a footnote[^one].", "", "[^one]: Readable footnote.", "",
      '<details open><summary>More information</summary><p><mark>Highlight</mark> <kbd>Ctrl</kbd></p></details>',
      '', '<mark style="position:fixed" onclick="alert(1)">Safe highlight</mark>',
    ].join("\n")}</Markdown>);
    const footnotes = container.querySelector("[data-footnotes]");
    const label = footnotes?.querySelector("h2");
    expect(label).toHaveClass("sr-only");
    expect(label?.id).toBe("user-content-footnote-label");
    expect(container.querySelector("[data-footnote-ref]")).toHaveAttribute("aria-describedby", label?.id);
    expect(container.querySelector("details")).toHaveAttribute("open");
    expect(container.querySelector("summary")).toHaveTextContent("More information");
    expect(container.querySelector("kbd")).toHaveTextContent("Ctrl");
    for (const mark of container.querySelectorAll("mark")) {
      expect(mark).not.toHaveAttribute("style");
      expect(mark).not.toHaveAttribute("onclick");
    }
  });

  it("preserves GFM task-list classes so checkboxes replace list markers", () => {
    const { container } = render(
      <Markdown raw>
        {"- [x] Typography reviewed\n- [ ] Visual QA pending"}
      </Markdown>,
    );

    const list = container.querySelector("ul");
    const items = container.querySelectorAll("li");
    expect(list).toHaveClass("markdown-list", "contains-task-list");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveClass("markdown-list-item", "task-list-item");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(
      2,
    );
  });
});
