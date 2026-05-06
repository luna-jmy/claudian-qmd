import { getDefaultHiddenProviderCommands } from '../../core/providers/commands/hiddenCommands';
import { type ClaudianSettings } from '../../core/types/settings';
import { getBuiltInProviderDefaultConfigs } from '../../providers/defaultProviderConfigs';

export const DEFAULT_CLAUDIAN_SETTINGS: ClaudianSettings = {
  userName: '',

  permissionMode: 'yolo',

  model: 'haiku',
  thinkingBudget: 'off',
  effortLevel: 'high',
  serviceTier: 'default',
  enableAutoTitleGeneration: true,
  titleGenerationModel: '',

  excludedTags: [],
  mediaFolder: '',
  systemPrompt: '',
  persistentExternalContextPaths: [],

  sharedEnvironmentVariables: '',
  envSnippets: [],
  customContextLimits: {},
  qmdKnowledgeBase: {
    enabled: false,
    qmdCommand: 'qmd',
    storeDir: 'QMD',
    indexName: 'index',
    collectionName: 'vault',
    collectionPattern: '**/*.md',
    collectionIgnore: [
      '.obsidian/**',
      '.trash/**',
      'QMD/**',
      '.claudian/**',
      '.claude/**',
      '.codex/**',
      '.agents/**',
    ].join('\n'),
    collectionContext: 'Obsidian vault notes and knowledge base.',
    globalContext: '',
    embeddingBackend: 'local',
    localEmbedModel: '',
    apiProvider: 'openai',
    apiBaseUrl: '',
    apiKey: '',
    apiKeyEnvVar: 'QMD_EMBED_API_KEY',
    apiModel: '',
    apiDimensions: '',
    configureClaudeMcp: true,
    mcpTransport: 'stdio',
    mcpHttpUrl: 'http://localhost:8181/mcp',
    createDefaultLinks: true,
    defaultCacheDir: '',
    defaultConfigDir: '',
    legacyCacheDir: '',
    legacyConfigDir: '',
  },

  keyboardNavigation: {
    scrollUpKey: 'w',
    scrollDownKey: 's',
    focusInputKey: 'i',
  },

  locale: 'en',

  providerConfigs: getBuiltInProviderDefaultConfigs(),

  settingsProvider: 'claude',
  savedProviderModel: {},
  savedProviderEffort: {},
  savedProviderServiceTier: {},
  savedProviderThinkingBudget: {},
  savedProviderPermissionMode: {},

  lastCustomModel: '',

  maxTabs: 3,
  tabBarPosition: 'input',
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  chatViewPlacement: 'right-sidebar',

  hiddenProviderCommands: getDefaultHiddenProviderCommands(),
};
