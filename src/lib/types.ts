export interface Restaurant {
  id: string;
  group: string;
  name: string;
  shortName: string;
  color: string;
  quotaGroup: string | null;
  // Live restaurants keep dining's identifiers; sample ones have none.
  restId?: string;
  personGroupId?: string;
}

export interface Choice {
  id: string;
  restaurantId: string;
  week: string;
  date: string;
  mealId: string;
  name: string;
  priceRials: number;
  locked: boolean;
  lockReason: string;
  unitPriceRials?: number;
  reserved?: boolean;
  serverKey?: string;
  count?: number | null;
  previousCount?: number | null;
}

export interface Menu {
  restaurantId: string;
  week: string;
  choices: Choice[];
  reservedIds: string[];
  published: boolean | null;
  balanceRials?: number | null;
  dates?: string[];
  rawChoiceCount?: number;
}

export interface Draft {
  choice: Choice;
  desired: boolean;
  revision: number;
}

export interface CapturedChange extends Draft {
  expectedReserved: boolean;
  expectedPriceRials: number;
  expectedPreviousCount: number | null | undefined;
}

export interface LoadState {
  restaurantId: string;
  week: string;
  state: 'queued' | 'loading' | 'ready' | 'error';
  message?: string;
  code?: string;
}

export interface SaveState {
  state: 'queued' | 'saving' | 'saved' | 'error';
  message?: string;
  code?: string;
}

export interface SaveResult {
  balanceRials: number;
  menu?: Menu;
  appliedIds?: string[];
  attempted?: boolean;
  complete?: boolean;
  message?: string;
}

export interface PlannerService {
  mode?: string;
  writable?: boolean;
  writeReason?: string;
  readMenu(restaurantId: string, week: string): Promise<Menu>;
  save(restaurantId: string, week: string, changes: CapturedChange[]): Promise<SaveResult>;
}

export interface Diagnostic {
  operation?: string;
  path?: string;
  method?: string;
  status?: number | null;
  elapsedMs?: number;
}

export interface PublicError {
  code: string;
  message: string;
  diagnostic: Diagnostic;
}

export type Reply<T> = ({ ok: true; error?: undefined } & T) | { ok: false; error: PublicError };

export interface MessageSender {
  id?: string;
  url?: string;
}

export type MessageListener = (message: any, sender: MessageSender, reply: (response: unknown) => void) => boolean;

type Runtime = ExtensionApi['runtime'];
// Callers that need only part of the runtime say which part.
export type RuntimeApi<K extends keyof Runtime> = { runtime: Pick<Runtime, K> };

// The part of the Firefox `browser` / Chrome `chrome` namespace that Loghmeh uses.
export interface ExtensionApi {
  runtime: {
    id: string;
    getURL(path: string): string;
    getManifest?(): { version: string };
    sendMessage(message: any): Promise<any>;
    onMessage?: { addListener(listener: MessageListener): void };
    getContexts?(filter: { contextTypes: string[]; documentUrls: string[] }): Promise<unknown[]>;
  };
  permissions: {
    contains(permissions: { origins: string[] }): Promise<boolean>;
    request(permissions: { origins: string[] }): Promise<boolean>;
  };
  tabs: { create(properties: { url: string }): Promise<unknown> };
  action?: { onClicked: { addListener(listener: () => void): void } };
  offscreen?: { createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void> };
}

declare global {
  var browser: ExtensionApi | undefined;
  var chrome: ExtensionApi | undefined;
}
