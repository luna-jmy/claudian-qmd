import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import type { ClaudianSettings } from '@/core/types';
import {
  buildQmdAgentInstructions,
  buildQmdEnvironmentText,
  buildQmdEnvironmentVariables,
  buildQmdMcpServer,
  QmdKnowledgeBaseService,
  resolveQmdPaths,
} from '@/features/qmd/QmdKnowledgeBase';

function slashPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function createSettings(overrides: Partial<ClaudianSettings['qmdKnowledgeBase']> = {}): ClaudianSettings {
  return {
    ...DEFAULT_CLAUDIAN_SETTINGS,
    qmdKnowledgeBase: {
      ...DEFAULT_CLAUDIAN_SETTINGS.qmdKnowledgeBase,
      enabled: true,
      ...overrides,
    },
  };
}

describe('QmdKnowledgeBase', () => {
  it('resolves vault-relative QMD paths', () => {
    const settings = createSettings({
      storeDir: 'QMD',
      indexName: 'notes',
    });

    const paths = resolveQmdPaths(settings.qmdKnowledgeBase, 'D:\\ThinkDoKit-Luna');

    expect(slashPath(paths.indexPath)).toBe('D:/ThinkDoKit-Luna/QMD/notes.sqlite');
    expect(slashPath(paths.configPath)).toBe('D:/ThinkDoKit-Luna/QMD/config/notes.yml');
  });

  it('builds local embedding runtime environment', () => {
    const settings = createSettings({
      localEmbedModel: 'hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf',
    });

    const env = buildQmdEnvironmentVariables(settings.qmdKnowledgeBase, 'D:\\vault');

    expect(slashPath(env.INDEX_PATH)).toBe('D:/vault/QMD/index.sqlite');
    expect(slashPath(env.QMD_CONFIG_DIR)).toBe('D:/vault/QMD/config');
    expect(env.QMD_EMBED_MODEL).toBe('hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf');
    expect(env.QMD_COLLECTION_NAME).toBe('vault');
  });

  it('builds API embedding runtime environment without setting provider API keys', () => {
    const settings = createSettings({
      embeddingBackend: 'api',
      apiBaseUrl: 'http://localhost:11434/v1',
      apiKey: 'secret',
      apiKeyEnvVar: 'QMD_REMOTE_KEY',
      apiModel: 'bge-m3',
      apiDimensions: '1024',
    });

    const env = buildQmdEnvironmentVariables(settings.qmdKnowledgeBase, '/vault');

    expect(env.QMD_EMBED_PROVIDER).toBe('openai');
    expect(env.QMD_EMBED_API_URL).toBe('http://localhost:11434/v1');
    expect(env.QMD_EMBED_BASE_URL).toBe('http://localhost:11434/v1');
    expect(env.QMD_EMBED_MODEL).toBe('bge-m3');
    expect(env.QMD_EMBED_DIMENSIONS).toBe('1024');
    expect(env.QMD_REMOTE_KEY).toBe('secret');
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('returns empty env and instructions when disabled', () => {
    const settings = createSettings({ enabled: false });

    expect(buildQmdEnvironmentVariables(settings.qmdKnowledgeBase, '/vault')).toEqual({});
    expect(buildQmdEnvironmentText(settings, '/vault')).toBe('');
    expect(buildQmdAgentInstructions(settings, '/vault')).toBe('');
  });

  it('skips runtime injection when old settings do not include QMD settings', () => {
    const settings = { ...DEFAULT_CLAUDIAN_SETTINGS };
    delete (settings as Partial<ClaudianSettings>).qmdKnowledgeBase;

    expect(buildQmdEnvironmentText(settings as ClaudianSettings, '/vault')).toBe('');
    expect(buildQmdAgentInstructions(settings as ClaudianSettings, '/vault')).toBe('');
  });

  it('builds stdio MCP config with vault-scoped env', () => {
    const settings = createSettings({
      qmdCommand: 'qmd',
    });

    const server = buildQmdMcpServer(settings.qmdKnowledgeBase, '/vault');

    expect(server.name).toBe('qmd');
    expect(server.enabled).toBe(true);
    expect(server.contextSaving).toBe(true);
    expect(server.config).toEqual(expect.objectContaining({
      command: 'qmd',
      args: ['mcp'],
      env: expect.objectContaining({
        INDEX_PATH: expect.stringContaining('index.sqlite'),
        QMD_CONFIG_DIR: expect.stringContaining('config'),
      }),
    }));
  });

  it('migrates detected legacy QMD files into vault storage before linking back', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-qmd-'));

    try {
      const vaultPath = path.join(root, 'vault');
      const legacyCacheDir = path.join(vaultPath, '_qmd-cache');
      const legacyConfigDir = path.join(vaultPath, '_qmd-config');
      fs.mkdirSync(legacyCacheDir, { recursive: true });
      fs.mkdirSync(legacyConfigDir, { recursive: true });
      fs.writeFileSync(path.join(legacyCacheDir, 'index.sqlite'), 'legacy index', 'utf-8');
      fs.writeFileSync(path.join(legacyConfigDir, 'index.yml'), 'legacy: true\n', 'utf-8');

      const settings = createSettings({
        createDefaultLinks: false,
        legacyCacheDir: '',
        legacyConfigDir: '',
      });
      const result = new QmdKnowledgeBaseService(settings.qmdKnowledgeBase, vaultPath).prepareStorage();

      expect(fs.readFileSync(result.configPath, 'utf-8')).toBe('legacy: true\n');
      expect(fs.readFileSync(result.indexPath, 'utf-8')).toBe('legacy index');
      expect(result.linkMessages.join('\n')).toContain('Moved');
      expect(result.linkMessages.join('\n')).toContain('Kept existing QMD config');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
