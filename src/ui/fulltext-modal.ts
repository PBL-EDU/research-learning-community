import { App, Modal } from "obsidian";

/**
 * 找全文的合规兜底：不碰影子图书馆，只把合法入口摆出来。
 *
 * 开放获取版本、出版商页面、预印本、手动放置——四条路都写清楚。
 */
export class FulltextHelpModal extends Modal {
  constructor(
    app: App,
    private readonly item: { title: string; doi?: string; url?: string },
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "找全文" });
    contentEl.createEl("p", {
      text: `《${this.item.title}》没有找到可直接下载的开放获取 PDF。可以从下面这些合法入口找：`,
      cls: "rlc-hint",
    });

    const list = contentEl.createDiv({ cls: "rlc-cands" });

    const addLink = (label: string, url: string, note?: string): void => {
      const row = list.createDiv({ cls: "rlc-cand" });
      const main = row.createDiv({ cls: "rlc-cand-main" });
      const link = main.createEl("a", {
        text: label,
        href: url,
        attr: { target: "_blank", rel: "noopener noreferrer" },
      });
      link.style.fontWeight = "600";
      if (note) main.createEl("div", { text: note, cls: "rlc-cand-status" });
    };

    if (this.item.doi) {
      addLink("出版商页面（DOI）", `https://doi.org/${this.item.doi}`, "机构订阅可直接下载");
    }
    addLink(
      "Semantic Scholar 搜索",
      `https://www.semanticscholar.org/search?q=${encodeURIComponent(this.item.title)}`,
      "常能找到免费 PDF 版本",
    );
    addLink(
      "arXiv 搜索",
      `https://arxiv.org/search/?query=${encodeURIComponent(this.item.title)}&searchtype=all`,
      "预印本，作者自存版本",
    );
    addLink(
      "Google 学术",
      `https://scholar.google.com/scholar?q=${encodeURIComponent(this.item.title)}`,
      "右侧 [PDF] 链接通常是合法开放版本",
    );

    contentEl.createEl("p", {
      text: "下载后把 PDF 放进这篇文献的文件夹即可（文件名随意，插件会自动识别）；然后点「2 整理」提取全文。",
      cls: "rlc-hint",
    });

    const actions = contentEl.createDiv({ cls: "rlc-actions" });
    const close = actions.createEl("button", { text: "关闭" });
    close.addEventListener("click", () => this.close());
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
