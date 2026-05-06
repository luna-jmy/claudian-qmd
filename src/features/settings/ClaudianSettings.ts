import type { App } from 'obsidian';
import { Notice, PluginSettingTab, Setting } from 'obsidian';

import {
  getHiddenProviderCommands,
  normalizeHiddenCommandList,
} from '../../core/providers/commands/hiddenCommands';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderId } from '../../core/providers/types';
import type { ChatViewPlacement } from '../../core/types/settings';
import { getAvailableLocales, getLocaleDisplayName, setLocale, t } from '../../i18n/i18n';
import type { Locale, TranslationKey } from '../../i18n/types';
import type ClaudianPlugin from '../../main';
import { formatContextLimit, parseContextLimit, parseEnvironmentVariables } from '../../utils/env';
import { getVaultPath } from '../../utils/path';
import { buildQmdEnvironmentText } from '../qmd/QmdKnowledgeBase';
import { buildNavMappingText, parseNavMappings } from './keyboardNavigation';
import { renderEnvironmentSettingsSection } from './ui/EnvironmentSettingsSection';

type SettingsTabId = 'general' | ProviderId;

function formatHotkey(hotkey: { modifiers: string[]; key: string }): string {
  const isMac = navigator.platform.includes('Mac');
  const modMap: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };

  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;

  return isMac ? [...mods, key].join('') : [...mods, key].join('+');
}

function openHotkeySettings(app: App): void {
  const setting = (app as any).setting;
  setting.open();
  setting.openTabById('hotkeys');
  setTimeout(() => {
    const tab = setting.activeTab;
    if (!tab) {
      return;
    }

    const searchEl = tab.searchInputEl ?? tab.searchComponent?.inputEl;
    if (!searchEl) {
      return;
    }

    searchEl.value = 'Claudian';
    tab.updateHotkeyVisibility?.();
  }, 100);
}

function getHotkeyForCommand(app: App, commandId: string): string | null {
  const hotkeyManager = (app as any).hotkeyManager;
  if (!hotkeyManager) return null;

  const customHotkeys = hotkeyManager.customKeys?.[commandId];
  const defaultHotkeys = hotkeyManager.defaultKeys?.[commandId];
  const hotkeys = customHotkeys?.length > 0 ? customHotkeys : defaultHotkeys;

  if (!hotkeys || hotkeys.length === 0) return null;

  return hotkeys.map(formatHotkey).join(', ');
}

function addHotkeySettingRow(
  containerEl: HTMLElement,
  app: App,
  commandId: string,
  translationPrefix: string,
): void {
  const hotkey = getHotkeyForCommand(app, commandId);
  const item = containerEl.createDiv({ cls: 'claudian-hotkey-item' });
  item.createSpan({
    cls: 'claudian-hotkey-name',
    text: t(`${translationPrefix}.name` as TranslationKey),
  });
  if (hotkey) {
    item.createSpan({ cls: 'claudian-hotkey-badge', text: hotkey });
  }
  item.addEventListener('click', () => openHotkeySettings(app));
}

export class ClaudianSettingTab extends PluginSettingTab {
  plugin: ClaudianPlugin;
  private activeTab: SettingsTabId = 'general';

  constructor(app: App, plugin: ClaudianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('claudian-settings');

    setLocale(this.plugin.settings.locale as Locale);

    const providerTabs = ProviderRegistry.getRegisteredProviderIds();
    const tabIds: SettingsTabId[] = ['general', ...providerTabs];
    if (!tabIds.includes(this.activeTab)) {
      this.activeTab = 'general';
    }

    const tabBar = containerEl.createDiv({ cls: 'claudian-settings-tabs' });
    const tabButtons = new Map<SettingsTabId, HTMLButtonElement>();
    const tabContents = new Map<SettingsTabId, HTMLDivElement>();

    for (const id of tabIds) {
      const label = id === 'general'
        ? t('settings.tabs.general' as TranslationKey)
        : ProviderRegistry.getProviderDisplayName(id);
      const button = tabBar.createEl('button', {
        cls: `claudian-settings-tab${id === this.activeTab ? ' claudian-settings-tab--active' : ''}`,
        text: label,
      });
      button.addEventListener('click', () => {
        this.activeTab = id;
        for (const tabId of tabIds) {
          tabButtons.get(tabId)?.toggleClass('claudian-settings-tab--active', tabId === id);
          tabContents.get(tabId)?.toggleClass('claudian-settings-tab-content--active', tabId === id);
        }
      });
      tabButtons.set(id, button);
    }

    for (const id of tabIds) {
      const content = containerEl.createDiv({
        cls: `claudian-settings-tab-content${id === this.activeTab ? ' claudian-settings-tab-content--active' : ''}`,
      });
      tabContents.set(id, content);
    }

    this.renderGeneralTab(tabContents.get('general')!);

    for (const providerId of providerTabs) {
      const content = tabContents.get(providerId);
      if (!content) {
        continue;
      }

      ProviderWorkspaceRegistry.getSettingsTabRenderer(providerId)?.render(content, {
        plugin: this.plugin,
        renderHiddenProviderCommandSetting: (
          target,
          targetProviderId,
          copy,
        ) => this.renderHiddenProviderCommandSetting(target, targetProviderId, copy),
        refreshModelSelectors: () => {
          for (const view of this.plugin.getAllViews()) {
            view.refreshModelSelector();
          }
        },
        renderCustomContextLimits: (target, providerId) => this.renderCustomContextLimits(target, providerId),
      });
    }
  }

  private renderGeneralTab(container: HTMLElement): void {
    new Setting(container)
      .setName(t('settings.language.name'))
      .setDesc(t('settings.language.desc'))
      .addDropdown((dropdown) => {
        const locales = getAvailableLocales();
        for (const locale of locales) {
          dropdown.addOption(locale, getLocaleDisplayName(locale));
        }
        dropdown
          .setValue(this.plugin.settings.locale)
          .onChange(async (value) => {
            const locale = value as Locale;
            if (!setLocale(locale)) {
              dropdown.setValue(this.plugin.settings.locale);
              return;
            }
            this.plugin.settings.locale = locale;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    // --- Display ---

    new Setting(container).setName(t('settings.display')).setHeading();

    new Setting(container)
      .setName(t('settings.tabBarPosition.name'))
      .setDesc(t('settings.tabBarPosition.desc'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('input', t('settings.tabBarPosition.input'))
          .addOption('header', t('settings.tabBarPosition.header'))
          .setValue(this.plugin.settings.tabBarPosition ?? 'input')
          .onChange(async (value) => {
            this.plugin.settings.tabBarPosition = value as 'input' | 'header';
            await this.plugin.saveSettings();

            for (const view of this.plugin.getAllViews()) {
              view.updateLayoutForPosition();
            }
          });
      });

    const maxTabsSetting = new Setting(container)
      .setName(t('settings.maxTabs.name'))
      .setDesc(t('settings.maxTabs.desc'));

    const maxTabsWarningEl = container.createDiv({ cls: 'claudian-max-tabs-warning' });
    maxTabsWarningEl.style.color = 'var(--text-warning)';
    maxTabsWarningEl.style.fontSize = '0.85em';
    maxTabsWarningEl.style.marginTop = '-0.5em';
    maxTabsWarningEl.style.marginBottom = '0.5em';
    maxTabsWarningEl.style.display = 'none';
    maxTabsWarningEl.setText(t('settings.maxTabs.warning'));

    const updateMaxTabsWarning = (value: number): void => {
      maxTabsWarningEl.style.display = value > 5 ? 'block' : 'none';
    };

    maxTabsSetting.addSlider((slider) => {
      slider
        .setLimits(3, 10, 1)
        .setValue(this.plugin.settings.maxTabs ?? 3)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxTabs = value;
          await this.plugin.saveSettings();
          updateMaxTabsWarning(value);
        });
      updateMaxTabsWarning(this.plugin.settings.maxTabs ?? 3);
    });

    new Setting(container)
      .setName(t('settings.chatViewPlacement.name'))
      .setDesc(t('settings.chatViewPlacement.desc'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('right-sidebar', t('settings.chatViewPlacement.rightSidebar'))
          .addOption('left-sidebar', t('settings.chatViewPlacement.leftSidebar'))
          .addOption('main-tab', t('settings.chatViewPlacement.mainTab'))
          .setValue(this.plugin.settings.chatViewPlacement)
          .onChange(async (value) => {
            this.plugin.settings.chatViewPlacement = value as ChatViewPlacement;
            await this.plugin.saveSettings();
          });
      });

    new Setting(container)
      .setName(t('settings.enableAutoScroll.name'))
      .setDesc(t('settings.enableAutoScroll.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoScroll ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoScroll = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName(t('settings.deferMathRenderingDuringStreaming.name'))
      .setDesc(t('settings.deferMathRenderingDuringStreaming.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deferMathRenderingDuringStreaming ?? true)
          .onChange(async (value) => {
            this.plugin.settings.deferMathRenderingDuringStreaming = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Conversations ---

    new Setting(container).setName(t('settings.conversations')).setHeading();

    new Setting(container)
      .setName(t('settings.autoTitle.name'))
      .setDesc(t('settings.autoTitle.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoTitleGeneration)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoTitleGeneration = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.enableAutoTitleGeneration) {
      new Setting(container)
        .setName(t('settings.titleModel.name'))
        .setDesc(t('settings.titleModel.desc'))
        .addDropdown((dropdown) => {
          dropdown.addOption('', t('settings.titleModel.auto'));

          const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
          const seenValues = new Set<string>();
          for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
            const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
            for (const model of uiConfig.getModelOptions(settingsBag)) {
              if (!seenValues.has(model.value)) {
                seenValues.add(model.value);
                dropdown.addOption(model.value, model.label);
              }
            }
          }

          dropdown
            .setValue(this.plugin.settings.titleGenerationModel || '')
            .onChange(async (value) => {
              this.plugin.settings.titleGenerationModel = value;
              await this.plugin.saveSettings();
            });
        });
    }

    // --- Content ---

    new Setting(container).setName(t('settings.content')).setHeading();

    new Setting(container)
      .setName(t('settings.userName.name'))
      .setDesc(t('settings.userName.desc'))
      .addText((text) => {
        text
          .setPlaceholder(t('settings.userName.name'))
          .setValue(this.plugin.settings.userName)
          .onChange(async (value) => {
            this.plugin.settings.userName = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener('blur', () => this.restartServiceForPromptChange());
      });

    new Setting(container)
      .setName(t('settings.systemPrompt.name'))
      .setDesc(t('settings.systemPrompt.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder(t('settings.systemPrompt.name'))
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
        text.inputEl.addEventListener('blur', () => this.restartServiceForPromptChange());
      });

    new Setting(container)
      .setName(t('settings.excludedTags.name'))
      .setDesc(t('settings.excludedTags.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder('system\nprivate\ndraft')
          .setValue(this.plugin.settings.excludedTags.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.excludedTags = value
              .split(/\r?\n/)
              .map((entry) => entry.trim().replace(/^#/, ''))
              .filter((entry) => entry.length > 0);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });

    new Setting(container)
      .setName(t('settings.mediaFolder.name'))
      .setDesc(t('settings.mediaFolder.desc'))
      .addText((text) => {
        text
          .setPlaceholder('attachments')
          .setValue(this.plugin.settings.mediaFolder)
          .onChange(async (value) => {
            this.plugin.settings.mediaFolder = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.addClass('claudian-settings-media-input');
        text.inputEl.addEventListener('blur', () => this.restartServiceForPromptChange());
      });

    // --- Input ---

    new Setting(container).setName(t('settings.input')).setHeading();

    new Setting(container)
      .setName(t('settings.navMappings.name'))
      .setDesc(t('settings.navMappings.desc'))
      .addTextArea((text) => {
        let pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
        let saveTimeout: number | null = null;

        const commitValue = async (showError: boolean): Promise<void> => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
            saveTimeout = null;
          }

          const result = parseNavMappings(pendingValue);
          if (!result.settings) {
            if (showError) {
              new Notice(`${t('common.error')}: ${result.error}`);
              pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
              text.setValue(pendingValue);
            }
            return;
          }

          this.plugin.settings.keyboardNavigation.scrollUpKey = result.settings.scrollUp;
          this.plugin.settings.keyboardNavigation.scrollDownKey = result.settings.scrollDown;
          this.plugin.settings.keyboardNavigation.focusInputKey = result.settings.focusInput;
          await this.plugin.saveSettings();
          pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
          text.setValue(pendingValue);
        };

        const scheduleSave = (): void => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
          }
          saveTimeout = window.setTimeout(() => {
            void commitValue(false);
          }, 500);
        };

        text
          .setPlaceholder('map w scrollUp\nmap s scrollDown\nmap i focusInput')
          .setValue(pendingValue)
          .onChange((value) => {
            pendingValue = value;
            scheduleSave();
          });

        text.inputEl.rows = 3;
        text.inputEl.addEventListener('blur', async () => {
          await commitValue(true);
        });
      });

    // --- Hotkeys ---

    new Setting(container).setName(t('settings.hotkeys')).setHeading();

    const hotkeyGrid = container.createDiv({ cls: 'claudian-hotkey-grid' });
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:inline-edit', 'settings.inlineEditHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:open-view', 'settings.openChatHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:new-session', 'settings.newSessionHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:new-tab', 'settings.newTabHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:close-current-tab', 'settings.closeTabHotkey');

    // --- QMD Knowledge Base ---

    this.renderQmdSettings(container);

    // --- Environment ---

    renderEnvironmentSettingsSection({
      container,
      plugin: this.plugin,
      scope: 'shared',
      heading: t('settings.environment'),
      name: 'Shared environment',
      desc: 'Provider-neutral runtime variables shared across all providers. Use this for PATH, proxy, cert, and temp variables.',
      placeholder: 'PATH=/opt/homebrew/bin:/usr/local/bin\nHTTPS_PROXY=http://proxy.example.com:8080\nSSL_CERT_FILE=/path/to/cert.pem',
      renderCustomContextLimits: (target) => this.renderCustomContextLimits(target),
    });
  }

  private renderQmdSettings(container: HTMLElement): void {
    const qmd = this.plugin.settings.qmdKnowledgeBase;
    const saveQmdSettings = async (refresh = false): Promise<void> => {
      await this.plugin.saveSettings();
      if (refresh) {
        await this.plugin.refreshKnowledgeBaseRuntimeEnvironment();
      }
    };
    const scheduleRuntimeRefresh = (): void => {
      void this.plugin.refreshKnowledgeBaseRuntimeEnvironment();
    };
    const addTextSetting = (
      name: string,
      desc: string,
      value: string,
      placeholder: string,
      onValue: (value: string) => void,
      options: { rows?: number; password?: boolean; refreshOnBlur?: boolean } = {},
    ): void => {
      const setting = new Setting(container)
        .setName(name)
        .setDesc(desc);

      if (options.rows && options.rows > 1) {
        setting.addTextArea((text) => {
          text
            .setPlaceholder(placeholder)
            .setValue(value)
            .onChange(async (nextValue) => {
              onValue(nextValue);
              await saveQmdSettings(false);
            });
          text.inputEl.rows = options.rows ?? 4;
          text.inputEl.cols = 50;
          if (options.refreshOnBlur) {
            text.inputEl.addEventListener('blur', scheduleRuntimeRefresh);
          }
        });
        return;
      }

      setting.addText((text) => {
        text
          .setPlaceholder(placeholder)
          .setValue(value)
          .onChange(async (nextValue) => {
            onValue(nextValue);
            await saveQmdSettings(false);
          });
        text.inputEl.style.width = '100%';
        if (options.password) {
          text.inputEl.type = 'password';
        }
        if (options.refreshOnBlur) {
          text.inputEl.addEventListener('blur', scheduleRuntimeRefresh);
        }
      });
    };

    new Setting(container).setName('Knowledge Base (QMD)').setHeading();

    new Setting(container)
      .setName('Enable QMD knowledge base')
      .setDesc('Generate vault-scoped QMD environment variables and agent instructions.')
      .addToggle((toggle) =>
        toggle
          .setValue(qmd.enabled)
          .onChange(async (value) => {
            qmd.enabled = value;
            await saveQmdSettings(true);
            this.display();
          })
      );

    addTextSetting(
      'QMD command',
      'Command or executable used to run qmd.',
      qmd.qmdCommand,
      'qmd',
      (value) => { qmd.qmdCommand = value.trim() || 'qmd'; },
      { refreshOnBlur: true },
    );

    addTextSetting(
      'Vault QMD folder',
      'Relative paths are resolved from the vault root. Only config and database files are written here; GGUF models stay in the global QMD cache.',
      qmd.storeDir,
      'QMD',
      (value) => { qmd.storeDir = value.trim() || 'QMD'; },
      { refreshOnBlur: true },
    );

    addTextSetting(
      'Index name',
      'QMD index name. The database becomes <index>.sqlite.',
      qmd.indexName,
      'index',
      (value) => { qmd.indexName = value.trim() || 'index'; },
      { refreshOnBlur: true },
    );

    addTextSetting(
      'Collection name',
      'Collection name used by qmd query -c.',
      qmd.collectionName,
      'vault',
      (value) => { qmd.collectionName = value.trim() || 'vault'; },
      { refreshOnBlur: true },
    );

    addTextSetting(
      'Collection pattern',
      'Glob pattern for files that should be indexed.',
      qmd.collectionPattern,
      '**/*.md',
      (value) => { qmd.collectionPattern = value.trim() || '**/*.md'; },
    );

    addTextSetting(
      'Ignore patterns',
      'One glob per line. Keep QMD and agent metadata out of the index unless you intentionally want them searchable.',
      qmd.collectionIgnore,
      '.obsidian/**\nQMD/**\n.claudian/**',
      (value) => { qmd.collectionIgnore = value; },
      { rows: 5 },
    );

    addTextSetting(
      'Collection context',
      'Context attached to qmd://<collection>/ results.',
      qmd.collectionContext,
      'Obsidian vault notes and knowledge base.',
      (value) => { qmd.collectionContext = value; },
      { rows: 3 },
    );

    addTextSetting(
      'Global context',
      'Optional context applied to all QMD collections in this config.',
      qmd.globalContext,
      'Long-term personal knowledge base.',
      (value) => { qmd.globalContext = value; },
      { rows: 3 },
    );

    new Setting(container)
      .setName('Embedding backend')
      .setDesc('Local uses QMD GGUF models. API emits OpenAI-compatible QMD_* embedding variables for a patched or compatible qmd build.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('local', 'Local GGUF')
          .addOption('api', 'API')
          .setValue(qmd.embeddingBackend)
          .onChange(async (value) => {
            qmd.embeddingBackend = value === 'api' ? 'api' : 'local';
            await saveQmdSettings(true);
            this.display();
          });
      });

    if (qmd.embeddingBackend === 'local') {
      addTextSetting(
        'Local embedding model',
        'Optional QMD_EMBED_MODEL override. Leave empty to use qmd default.',
        qmd.localEmbedModel,
        'hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf',
        (value) => { qmd.localEmbedModel = value.trim(); },
        { refreshOnBlur: true },
      );
    } else {
      addTextSetting(
        'API provider',
        'Provider label written to QMD_EMBED_PROVIDER.',
        qmd.apiProvider,
        'openai',
        (value) => { qmd.apiProvider = value.trim() || 'openai'; },
        { refreshOnBlur: true },
      );
      addTextSetting(
        'API base URL',
        'OpenAI-compatible embeddings endpoint base URL.',
        qmd.apiBaseUrl,
        'https://api.openai.com/v1',
        (value) => { qmd.apiBaseUrl = value.trim(); },
        { refreshOnBlur: true },
      );
      addTextSetting(
        'API model',
        'Embedding model name written to QMD_EMBED_MODEL.',
        qmd.apiModel,
        'text-embedding-3-small',
        (value) => { qmd.apiModel = value.trim(); },
        { refreshOnBlur: true },
      );
      addTextSetting(
        'API dimensions',
        'Optional vector dimension count, if your qmd build/provider requires it.',
        qmd.apiDimensions,
        '1536',
        (value) => { qmd.apiDimensions = value.trim(); },
        { refreshOnBlur: true },
      );
      addTextSetting(
        'API key env var',
        'Name of the generated environment variable that receives the API key.',
        qmd.apiKeyEnvVar,
        'QMD_EMBED_API_KEY',
        (value) => { qmd.apiKeyEnvVar = value.trim() || 'QMD_EMBED_API_KEY'; },
        { refreshOnBlur: true },
      );
      addTextSetting(
        'API key',
        'Optional. Stored in plugin settings, which may sync with the vault.',
        qmd.apiKey,
        'sk-...',
        (value) => { qmd.apiKey = value.trim(); },
        { password: true, refreshOnBlur: true },
      );
    }

    new Setting(container)
      .setName('Configure Claude MCP')
      .setDesc('Adds or updates a qmd MCP server in .claude/mcp.json for Claude sessions.')
      .addToggle((toggle) =>
        toggle
          .setValue(qmd.configureClaudeMcp)
          .onChange(async (value) => {
            qmd.configureClaudeMcp = value;
            await saveQmdSettings(false);
          })
      );

    new Setting(container)
      .setName('MCP transport')
      .setDesc('stdio launches qmd per client. http expects qmd mcp --http to be running.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('stdio', 'stdio')
          .addOption('http', 'http')
          .setValue(qmd.mcpTransport)
          .onChange(async (value) => {
            qmd.mcpTransport = value === 'http' ? 'http' : 'stdio';
            await saveQmdSettings(false);
            this.display();
          });
      });

    if (qmd.mcpTransport === 'http') {
      addTextSetting(
        'QMD MCP URL',
        'Streamable HTTP MCP endpoint.',
        qmd.mcpHttpUrl,
        'http://localhost:8181/mcp',
        (value) => { qmd.mcpHttpUrl = value.trim() || 'http://localhost:8181/mcp'; },
      );
    }

    new Setting(container)
      .setName('Create links for global qmd')
      .setDesc('Best-effort symlinks from default qmd config/cache files to the vault QMD files. Useful for terminal qmd without generated env vars.')
      .addToggle((toggle) =>
        toggle
          .setValue(qmd.createDefaultLinks)
          .onChange(async (value) => {
            qmd.createDefaultLinks = value;
            await saveQmdSettings(false);
          })
      );

    addTextSetting(
      'Default qmd cache dir',
      'Optional override for the default qmd cache folder that receives index.sqlite links. Leave empty for platform default.',
      qmd.defaultCacheDir,
      '~/.cache/qmd',
      (value) => { qmd.defaultCacheDir = value.trim(); },
    );

    addTextSetting(
      'Default qmd config dir',
      'Optional override for the default qmd config folder that receives index.yml links. Leave empty for platform default.',
      qmd.defaultConfigDir,
      '~/.config/qmd',
      (value) => { qmd.defaultConfigDir = value.trim(); },
    );

    addTextSetting(
      'Legacy cache dir',
      'Optional old cache directory to migrate/link, for example D:\\ThinkDoKit-Luna\\_qmd-cache.',
      qmd.legacyCacheDir,
      'D:\\ThinkDoKit-Luna\\_qmd-cache',
      (value) => { qmd.legacyCacheDir = value.trim(); },
    );

    addTextSetting(
      'Legacy config dir',
      'Optional old config directory to migrate/link, for example D:\\ThinkDoKit-Luna\\_qmd-config.',
      qmd.legacyConfigDir,
      'D:\\ThinkDoKit-Luna\\_qmd-config',
      (value) => { qmd.legacyConfigDir = value.trim(); },
    );

    new Setting(container)
      .setName('Prepare QMD')
      .setDesc('Writes QMD config into the vault folder, creates requested links, and configures Claude MCP.')
      .addButton((button) => {
        button
          .setButtonText('Prepare')
          .setCta()
          .onClick(async () => {
            await this.plugin.prepareQmdKnowledgeBase();
          });
      });

    const envPreview = buildQmdEnvironmentText(this.plugin.settings, getVaultPath(this.app));
    if (envPreview) {
      addTextSetting(
        'Generated QMD env',
        'Read-only preview of variables injected into agent runtimes.',
        envPreview,
        '',
        () => {},
        { rows: 6 },
      );
    }
  }

  private renderHiddenProviderCommandSetting(
    container: HTMLElement,
    providerId: ProviderId,
    copy: { name: string; desc: string; placeholder: string },
  ): void {
    new Setting(container)
      .setName(copy.name)
      .setDesc(copy.desc)
      .addTextArea((text) => {
        text
          .setPlaceholder(copy.placeholder)
          .setValue(getHiddenProviderCommands(this.plugin.settings, providerId).join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.hiddenProviderCommands = {
              ...this.plugin.settings.hiddenProviderCommands,
              [providerId]: normalizeHiddenCommandList(value.split(/\r?\n/)),
            };
            await this.plugin.saveSettings();
            this.plugin.getView()?.updateHiddenProviderCommands();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });
  }

  private renderCustomContextLimits(container: HTMLElement, providerId?: ProviderId): void {
    container.empty();

    const uniqueModelIds = new Set<string>();
    const providerIds = providerId
      ? [providerId]
      : ProviderRegistry.getRegisteredProviderIds();

    for (const targetProviderId of providerIds) {
      const envVars = parseEnvironmentVariables(
        this.plugin.getActiveEnvironmentVariables(targetProviderId),
      );
      for (const modelId of ProviderRegistry.getChatUIConfig(targetProviderId).getCustomModelIds(envVars)) {
        uniqueModelIds.add(modelId);
      }
    }

    if (uniqueModelIds.size === 0) {
      return;
    }

    const headerEl = container.createDiv({ cls: 'claudian-context-limits-header' });
    headerEl.createSpan({
      text: t('settings.customContextLimits.name'),
      cls: 'claudian-context-limits-label',
    });

    const descEl = container.createDiv({ cls: 'claudian-context-limits-desc' });
    descEl.setText(t('settings.customContextLimits.desc'));

    const listEl = container.createDiv({ cls: 'claudian-context-limits-list' });

    for (const modelId of uniqueModelIds) {
      const currentValue = this.plugin.settings.customContextLimits?.[modelId];

      const itemEl = listEl.createDiv({ cls: 'claudian-context-limits-item' });
      const nameEl = itemEl.createDiv({ cls: 'claudian-context-limits-model' });
      nameEl.setText(modelId);

      const inputWrapper = itemEl.createDiv({ cls: 'claudian-context-limits-input-wrapper' });
      const inputEl = inputWrapper.createEl('input', {
        type: 'text',
        placeholder: '200k',
        cls: 'claudian-context-limits-input',
        value: currentValue ? formatContextLimit(currentValue) : '',
      });

      const validationEl = inputWrapper.createDiv({ cls: 'claudian-context-limit-validation' });

      inputEl.addEventListener('input', async () => {
        const trimmed = inputEl.value.trim();

        if (!this.plugin.settings.customContextLimits) {
          this.plugin.settings.customContextLimits = {};
        }

        if (!trimmed) {
          delete this.plugin.settings.customContextLimits[modelId];
          validationEl.style.display = 'none';
          inputEl.classList.remove('claudian-input-error');
        } else {
          const parsed = parseContextLimit(trimmed);
          if (parsed === null) {
            validationEl.setText(t('settings.customContextLimits.invalid'));
            validationEl.style.display = 'block';
            inputEl.classList.add('claudian-input-error');
            return;
          }

          this.plugin.settings.customContextLimits[modelId] = parsed;
          validationEl.style.display = 'none';
          inputEl.classList.remove('claudian-input-error');
        }

        await this.plugin.saveSettings();
      });
    }
  }

  private async restartServiceForPromptChange(): Promise<void> {
    const view = this.plugin.getView();
    const tabManager = view?.getTabManager();
    if (!tabManager) return;

    try {
      await tabManager.broadcastToAllTabs(
        async (service) => { await service.ensureReady({ force: true }); }
      );
    } catch {
      // Changes will apply on the next conversation if the restart fails.
    }
  }
}
