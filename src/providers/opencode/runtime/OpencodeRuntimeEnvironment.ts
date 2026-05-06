import {
  getRuntimeEnvironmentText,
  joinEnvironmentTexts,
} from '../../../core/providers/providerEnvironment';
import type { ClaudianSettings } from '../../../core/types';
import { buildQmdEnvironmentText } from '../../../features/qmd/QmdKnowledgeBase';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';

export function buildOpencodeRuntimeEnv(
  settings: Record<string, unknown>,
  cliPath: string,
  databasePathOverride?: string | null,
  vaultPath?: string | null,
): NodeJS.ProcessEnv {
  const envText = joinEnvironmentTexts(
    getRuntimeEnvironmentText(settings, 'opencode'),
    buildQmdEnvironmentText(settings as unknown as ClaudianSettings, vaultPath ?? null),
  );
  const envVars = parseEnvironmentVariables(envText);
  return {
    ...process.env,
    ...envVars,
    OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: 'true',
    ...(databasePathOverride ? { OPENCODE_DB: databasePathOverride } : {}),
    PATH: getEnhancedPath(envVars.PATH, cliPath || undefined),
  };
}
