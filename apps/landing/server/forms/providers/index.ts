import { providerDefinition } from '../../providers/registry';
import { createPendingProvider, type FormsProviders } from '../provider';
import { createGoogleFormsProvider, type GoogleFormsProviderDeps } from './google/adapter';

/**
 * The provider slots. Google creates real forms. Microsoft is connected but has no adapter because
 * Microsoft publishes no supported Forms API; its slot refuses explicitly and makes no request.
 *
 * To add Microsoft later: implement FormsProvider in ./microsoft/, replace the pending slot here, and
 * flip `formsApi` in server/providers/registry.ts. Nothing in the engine or routes changes.
 */
export function createFormsProviders(options: { env: NodeJS.ProcessEnv; google?: GoogleFormsProviderDeps }): FormsProviders {
  const microsoft = providerDefinition('microsoft', options.env);
  return {
    google: createGoogleFormsProvider(options.google),
    microsoft: createPendingProvider('microsoft', `Microsoft Forms creation is not available yet. ${microsoft.formsNote}`),
  };
}
