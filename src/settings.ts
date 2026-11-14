import { App, PluginSettingTab, Setting, requestUrl } from "obsidian";
import type RlcPlugin from "./main";

export interface RlcSettings {
  /** 对外展示名（公开页只用 handle，真名只在班内可见）。 */
  authorName: string;
  authorHandle: string;
  /** OpenAI 兼容端点，学生自带 Key。 */
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  aiTemperature: number;
  /** 服务端地址；留空时发布只进本地 outbox。 */
  serverUrl: string;
  deviceToken: string;
  /** 邀请码绑定后回写的身份，避免每次发布前手填。 */
  bindHandle: string;
  bindName: string;
  bindOrg: string;
  bindOrgName: string;
  lastDomain: string;
  lastTheme: string;
  /** 侧栏折叠状态：领域名列表 + 文献展开状态（key = 文献笔记路径）。 */
  collapsedDomains: string[];
  literatureOpen: Record<string, "open" | "closed">;
  /** 文献整理：英文文献是否逐段附中文译文。 */
  organizeBilingual: boolean;
  /** 是否已同意把 PDF 上传到 AI 服务商做 OCR。 */
  organizeConsent: boolean;
  /** 学生自己定义的读者画像；科普版按画像各生成一版。 */
  audienceProfiles: AudienceProfile[];
  /** 海报配图：火山方舟 seedream。 */
  imageBaseUrl: string;
  imageApiKey: string;
  imageModel: string;
  /** 新文献入库时自动翻译中文标题。 */
  autoTranslateTitle: boolean;
}

export interface AudienceProfile {
  id: string;
  name: string;
  description: string;
}

export const DEFAULT_SETTINGS: RlcSettings = {
  authorName: "彩虹爷爷",
  authorHandle: "",
  aiBaseUrl: "https://api.deepseek.com/v1",
  aiApiKey: "",
  aiModel: "deepseek-chat",
  aiTemperature: 0.4,
  serverUrl: "",
  deviceToken: "",
  bindHandle: "",
  bindName: "",
  bindOrg: "",
  bindOrgName: "",
  lastDomain: "",
  lastTheme: "",
  collapsedDomains: [],
  literatureOpen: {},
  organizeBilingual: true,
  organizeConsent: false,
  audienceProfiles: [],
  imageBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  imageApiKey: "",
  imageModel: "doubao-seedream-5-0-pro-260628",
  autoTranslateTitle: true,
};

export class RlcSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly rlc: RlcPlugin,
  ) {
    super(app, rlc);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("研究性学习社区").setHeading();
    containerEl.createEl("p", {
      text: "学生的半成品与失败稿不该经过学校服务器：AI 调用全部在你本机完成，只有你点「发布」的卡片才会上传。",
      cls: "setting-item-description",
    });

    new Setting(containerEl).setName("作者身份").setHeading();
    new Setting(containerEl)
      .setName("展示名")
      .setDesc("班内可见的名字。公开页一律使用下面的 handle。")
      .addText((text) =>
        text
          .setPlaceholder("彩虹爷爷")
          .setValue(this.rlc.settings.authorName)
          .onChange(async (value) => {
            this.rlc.settings.authorName = value.trim();
            await this.rlc.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("公开 handle")
      .setDesc("对外路由用，例如 caihong-yeye；留空则发布前必须补上。")
      .addText((text) =>
        text
          .setPlaceholder("caihong-yeye")
          .setValue(this.rlc.settings.authorHandle)
          .onChange(async (value) => {
            this.rlc.settings.authorHandle = value.trim();
            await this.rlc.saveSettings();
          }),
      );

    new Setting(containerEl).setName("学生身份").setHeading();

    const boundHandle = this.rlc.settings.bindHandle;
    containerEl.createEl("p", {
      text: boundHandle
        ? `已绑定：${this.rlc.settings.bindName}（${this.rlc.settings.bindHandle}）· ${this.rlc.settings.bindOrgName || this.rlc.settings.bindOrg}`
        : "用老师发给你的邀请码绑定身份。绑定后，发布的卡片会记在你名下并归入组织。",
      cls: "setting-item-description",
    });

    let inviteCode = "";
    new Setting(containerEl)
      .setName("邀请码")
      .setDesc("一次性短码，形如 RLC-7K3M-9Q2P，7 天内有效。")
      .addText((text) =>
        text.setPlaceholder("RLC-XXXX-XXXX").onChange((value) => {
          inviteCode = value;
        }),
      )
      .addButton((button) =>
        button
          .setButtonText("绑定")
          .setCta()
          .onClick(async () => {
            const base = this.rlc.settings.serverUrl.trim().replace(/\/+$/, "");
            if (base.length === 0) {
              this.rlc.notice("先在下面填写服务端地址，例如 http://127.0.0.1:4000");
              return;
            }
            if (inviteCode.trim().length === 0) {
              this.rlc.notice("先填入邀请码");
              return;
            }

            button.setDisabled(true);
            button.setButtonText("绑定中…");
            try {
              const response = await requestUrl({
                url: `${base}/api/v1/invites/redeem`,
                method: "POST",
                contentType: "application/json",
                body: JSON.stringify({ code: inviteCode.trim() }),
                throw: false,
              });

              if (response.status !== 200) {
                this.rlc.notice(`绑定失败（${response.status}）：${response.text.slice(0, 120)}`);
                return;
              }

              const data = response.json as {
                token: string;
                account: { handle: string; displayName: string };
                org: { slug: string; name: string };
              };

              this.rlc.settings.deviceToken = data.token;
              this.rlc.settings.bindHandle = data.account.handle;
              this.rlc.settings.bindName = data.account.displayName;
              this.rlc.settings.bindOrg = data.org.slug;
              this.rlc.settings.bindOrgName = data.org.name;
              this.rlc.settings.authorName = data.account.displayName;
              this.rlc.settings.authorHandle = data.account.handle;
              await this.rlc.saveSettings();

              this.rlc.notice(`已绑定：${data.account.displayName}（${data.org.name}）`);
              this.display();
            } catch (error) {
              this.rlc.notice(`绑定失败：${(error as Error).message}`);
            } finally {
              button.setDisabled(false);
              button.setButtonText("绑定");
            }
          }),
      );

    new Setting(containerEl).setName("AI（自带 Key）").setHeading();
    containerEl.createEl("p", {
      text: "支持任何 OpenAI 兼容端点。密钥以明文保存在本插件的 data.json 里，只在本机使用。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("接口地址")
      .setDesc("例如 https://api.deepseek.com/v1 或 https://api.openai.com/v1")
      .addText((text) =>
        text
          .setPlaceholder("https://api.deepseek.com/v1")
          .setValue(this.rlc.settings.aiBaseUrl)
          .onChange(async (value) => {
            this.rlc.settings.aiBaseUrl = value.trim();
            await this.rlc.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("API Key")
      .addText((text) => {
        text.inputEl.type = "password";
        return text
          .setPlaceholder("sk-...")
          .setValue(this.rlc.settings.aiApiKey)
          .onChange(async (value) => {
            this.rlc.settings.aiApiKey = value.trim();
            await this.rlc.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("模型")
      .addText((text) =>
        text
          .setPlaceholder("deepseek-chat")
          .setValue(this.rlc.settings.aiModel)
          .onChange(async (value) => {
            this.rlc.settings.aiModel = value.trim();
            await this.rlc.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("温度")
      .setDesc("0 最稳定，1 最发散。精读建议 0.3–0.5。")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.1)
          .setValue(this.rlc.settings.aiTemperature)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.rlc.settings.aiTemperature = value;
            await this.rlc.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("发一条最小请求，确认端点、Key、模型三者都通。")
      .addButton((button) =>
        button.setButtonText("测试").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("测试中…");
          try {
            const reply = await this.rlc.ai.chat([
              { role: "user", content: "只回复两个字：可用" },
            ]);
            button.setButtonText("✅ 可用");
          } catch (error) {
            button.setButtonText("❌ 失败");
            this.rlc.notice(`AI 连接失败：${(error as Error).message}`);
          } finally {
            button.setDisabled(false);
            window.setTimeout(() => button.setButtonText("测试"), 3000);
          }
        }),
      );

    new Setting(containerEl).setName("我的读者（科普版画像）").setHeading();
    containerEl.createEl("p", {
      text: "写科普版前先定义读者：名称 + 自由描述。AI 会按这些描述决定长度、语气和用词。可以有多条。",
      cls: "setting-item-description",
    });

    this.rlc.settings.audienceProfiles.forEach((profile, index) => {
      new Setting(containerEl)
        .setName(`画像 ${index + 1}`)
        .addText((text) =>
          text
            .setPlaceholder("名称，如：初中生")
            .setValue(profile.name)
            .onChange(async (value) => {
              profile.name = value.trim();
              await this.rlc.saveSettings();
            }),
        )
        .addText((text) =>
          text
            .setPlaceholder("描述：年龄、喜好、前置知识、反感什么…")
            .setValue(profile.description)
            .onChange(async (value) => {
              profile.description = value.trim();
              await this.rlc.saveSettings();
            }),
        )
        .addButton((button) =>
          button
            .setButtonText("删除")
            .setWarning()
            .onClick(async () => {
              this.rlc.settings.audienceProfiles = this.rlc.settings.audienceProfiles.filter(
                (item) => item.id !== profile.id,
              );
              await this.rlc.saveSettings();
              this.display();
            }),
        );
    });

    new Setting(containerEl).addButton((button) =>
      button.setButtonText("＋ 添加读者").onClick(async () => {
        this.rlc.settings.audienceProfiles = [
          ...this.rlc.settings.audienceProfiles,
          { id: `aud-${Date.now().toString(36)}`, name: "", description: "" },
        ];
        await this.rlc.saveSettings();
        this.display();
      }),
    );

    new Setting(containerEl)
      .setName("新文献自动翻译标题")
      .setDesc("入库时用 AI 翻一个中文标题，侧栏悬停可看。已有文献可用命令「补全文献中文标题」批量补。")
      .addToggle((toggle) =>
        toggle.setValue(this.rlc.settings.autoTranslateTitle).onChange(async (value) => {
          this.rlc.settings.autoTranslateTitle = value;
          await this.rlc.saveSettings();
        }),
      );

    new Setting(containerEl).setName("海报配图（seedream）").setHeading();
    containerEl.createEl("p", {
      text: "生成海报时用它画插画，再在本地排版成 1080×1440 的成品图。留空则海报按钮只做排版、不画图。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("生图接口地址")
      .setDesc("火山方舟默认 https://ark.cn-beijing.volces.com/api/v3")
      .addText((text) =>
        text.setValue(this.rlc.settings.imageBaseUrl).onChange(async (value) => {
          this.rlc.settings.imageBaseUrl = value.trim();
          await this.rlc.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("生图 API Key")
      .setDesc("Ark API Key；只存本机，不进服务器。")
      .addText((text) => {
        text.inputEl.type = "password";
        return text.setValue(this.rlc.settings.imageApiKey).onChange(async (value) => {
          this.rlc.settings.imageApiKey = value.trim();
          await this.rlc.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("生图模型")
      .setDesc("例如 doubao-seedream-5-0-pro-260628；需在方舟控制台已开通。")
      .addText((text) =>
        text.setValue(this.rlc.settings.imageModel).onChange(async (value) => {
          this.rlc.settings.imageModel = value.trim();
          await this.rlc.saveSettings();
        }),
      );

    new Setting(containerEl).setName("文献整理（PDF → Markdown）").setHeading();
    containerEl.createEl("p", {
      text: "把文献文件夹里的「原文.pdf」上传到 AI 服务商做 OCR，还原成 Markdown，英文文献逐段附中文译文。首次使用会让你确认一次。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("英文文献自动翻译")
      .setDesc("开启后逐段输出中文译文（费用约翻倍）；中文文献不受影响。")
      .addToggle((toggle) =>
        toggle.setValue(this.rlc.settings.organizeBilingual).onChange(async (value) => {
          this.rlc.settings.organizeBilingual = value;
          await this.rlc.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("已同意上传 PDF")
      .setDesc("重新阅读上传说明；关闭后下次整理会再次询问。")
      .addToggle((toggle) =>
        toggle.setValue(this.rlc.settings.organizeConsent).onChange(async (value) => {
          this.rlc.settings.organizeConsent = value;
          await this.rlc.saveSettings();
        }),
      );

    new Setting(containerEl).setName("服务端（可选）").setHeading();
    containerEl.createEl("p", {
      text: "留空时，发布只会写入本地 outbox，不会上传任何内容。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("服务端地址")
      .setDesc("例如 https://api.example.com")
      .addText((text) =>
        text
          .setPlaceholder("https://api.example.com")
          .setValue(this.rlc.settings.serverUrl)
          .onChange(async (value) => {
            this.rlc.settings.serverUrl = value.trim();
            await this.rlc.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("设备令牌（高级）")
      .setDesc("用邀请码绑定后自动写入，一般不需要手填。")
      .addText((text) => {
        text.inputEl.type = "password";
        return text
          .setPlaceholder("可选")
          .setValue(this.rlc.settings.deviceToken)
          .onChange(async (value) => {
            this.rlc.settings.deviceToken = value.trim();
            await this.rlc.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("测试服务端连接")
      .setDesc("发一个健康检查请求，确认地址可达、数据库正常。")
      .addButton((button) =>
        button.setButtonText("测试").onClick(async () => {
          const base = this.rlc.settings.serverUrl.trim().replace(/\/+$/, "");
          if (base.length === 0) {
            this.rlc.notice("先填服务端地址，例如 http://127.0.0.1:4000");
            return;
          }

          button.setDisabled(true);
          button.setButtonText("测试中…");
          try {
            const response = await requestUrl({
              url: `${base}/api/v1/healthz`,
              method: "GET",
              throw: false,
            });
            const ok = response.status === 200 && response.json?.ok === true;
            button.setButtonText(ok ? "✅ 可用" : `❌ HTTP ${response.status}`);
            if (!ok) {
              this.rlc.notice(
                `服务端返回 ${response.status}：${response.text.slice(0, 120)}`,
              );
            }
          } catch (error) {
            button.setButtonText("❌ 不可达");
            this.rlc.notice(`连接失败：${(error as Error).message}`);
          } finally {
            button.setDisabled(false);
            window.setTimeout(() => button.setButtonText("测试"), 4000);
          }
        }),
      );
  }
}
