import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createLifeCycleModel } from '@tiangong-lca/tidas-sdk';
import { supabase_base_url, supabase_publishable_key } from '../_shared/config.js';
import type { SupabaseSessionLike } from '../_shared/supabase_session.js';
import { resolveSupabaseAccessToken } from '../_shared/supabase_session.js';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = Record<string, any>;

const MAX_VALIDATION_ERROR_LENGTH = 4_000;
const NODE_WIDTH = 350;
const NODE_MIN_HEIGHT = 100;
const NODE_Y = 160;
const NODE_BASE_X = -150;
const NODE_STEP_X = 430;
const NODE_STEP_Y = 220;
const CHAIN_SECOND_ROW_Y = 380;
const PORT_START_Y = 65;
const PORT_STEP_Y = 20;
const PAIRED_INPUT_START_Y = 58;
const PAIRED_OUTPUT_START_Y = 78;
const PAIRED_PORT_STEP_Y = 40;
const PRIMARY_COLOR = '#5c246a';
const BACKGROUND_COLOR = '#ffffff';
const MUTED_TEXT_COLOR = 'rgba(0,0,0,0.45)';
const BODY_TEXT_COLOR = '#000';

type LifecycleModelPayload = {
  jsonOrdered: JsonRecord;
  providedJsonTg?: JsonRecord;
  sourceFormat: 'native' | 'platform_bundle' | 'raw_record' | 'direct_fields';
};

type ModelEdge = {
  srcInternalId: string;
  dstInternalId: string;
  flowUuid: string;
};

type PortSpec = {
  side: 'INPUT' | 'OUTPUT';
  flowUuid: string;
  flowVersion: string;
  textLang: Array<Record<string, string>>;
  displayText: string;
  quantitativeReference: boolean;
  allocations?: JsonValue;
};

type ProcessLookup = {
  processId: string;
  version: string;
  shortDescription: Array<Record<string, string>>;
  label: JsonRecord;
  shortSummary: Array<Record<string, string>>;
  referenceExchange?: JsonRecord;
  exchangeByDirectionAndFlow: Map<string, JsonRecord>;
};

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function toJsonRecord(value: unknown, message: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as JsonRecord;
}

function parsePayload(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }
  return value;
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    const serialized = JSON.stringify(error);
    if (!serialized) {
      return String(error);
    }

    return serialized.length > MAX_VALIDATION_ERROR_LENGTH
      ? `${serialized.slice(0, MAX_VALIDATION_ERROR_LENGTH)}...`
      : serialized;
  } catch {
    return String(error);
  }
}

function normalizeLifecycleModelPayload(rawPayload: unknown): LifecycleModelPayload {
  const parsed = parsePayload(rawPayload);
  const singlePayload = Array.isArray(parsed) ? parsed[0] : parsed;

  if (Array.isArray(parsed) && parsed.length !== 1) {
    throw new Error(
      'Lifecycle model file import currently supports exactly one lifecycle model object per request.',
    );
  }

  const payload = asRecord(singlePayload);
  if (payload.json_ordered) {
    return {
      jsonOrdered: toJsonRecord(payload.json_ordered, 'payload.json_ordered must be an object.'),
      providedJsonTg: payload.json_tg
        ? toJsonRecord(payload.json_tg, 'payload.json_tg must be an object.')
        : undefined,
      sourceFormat: 'raw_record',
    };
  }

  if (payload.jsonOrdered) {
    return {
      jsonOrdered: toJsonRecord(payload.jsonOrdered, 'payload.jsonOrdered must be an object.'),
      providedJsonTg: payload.jsonTg
        ? toJsonRecord(payload.jsonTg, 'payload.jsonTg must be an object.')
        : undefined,
      sourceFormat: 'direct_fields',
    };
  }

  if (payload.lifeCycleModelDataSet) {
    const { json_tg, ...jsonOrdered } = payload;
    return {
      jsonOrdered: toJsonRecord(
        jsonOrdered,
        'payload must contain a lifeCycleModelDataSet object.',
      ),
      providedJsonTg: json_tg
        ? toJsonRecord(json_tg, 'payload.json_tg must be an object.')
        : undefined,
      sourceFormat: json_tg ? 'platform_bundle' : 'native',
    };
  }

  throw new Error(
    'Unsupported lifecycle model payload. Provide { lifeCycleModelDataSet }, { lifeCycleModelDataSet, json_tg }, { json_ordered, json_tg }, or an array containing exactly one of those objects.',
  );
}

function getModelDataSet(jsonOrdered: JsonRecord): JsonRecord {
  const dataSet = jsonOrdered.lifeCycleModelDataSet;
  if (!dataSet || typeof dataSet !== 'object' || Array.isArray(dataSet)) {
    throw new Error('jsonOrdered.lifeCycleModelDataSet is required.');
  }
  return dataSet as JsonRecord;
}

function getModelUuid(jsonOrdered: JsonRecord): string {
  const dataSet = getModelDataSet(jsonOrdered);
  const uuid = asRecord(asRecord(asRecord(dataSet.lifeCycleModelInformation).dataSetInformation))[
    'common:UUID'
  ];
  if (typeof uuid !== 'string' || uuid.length === 0) {
    throw new Error(
      'lifeCycleModelInformation.dataSetInformation.common:UUID is required in the lifecycle model.',
    );
  }
  return uuid;
}

function getModelVersion(jsonOrdered: JsonRecord): string {
  const dataSet = getModelDataSet(jsonOrdered);
  const version = asRecord(asRecord(dataSet.administrativeInformation).publicationAndOwnership)[
    'common:dataSetVersion'
  ];
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(
      'administrativeInformation.publicationAndOwnership.common:dataSetVersion is required in the lifecycle model.',
    );
  }
  return version;
}

function validateLifecycleModelStrict(jsonOrdered: JsonRecord): void {
  const validationResult = createLifeCycleModel(jsonOrdered, { mode: 'strict' }).validate();
  if (!validationResult.success) {
    const errorDetails = summarizeError(validationResult.error);
    throw new Error(`Lifecycle model validation failed: ${errorDetails}`);
  }
}

function langEntries(value: unknown): Array<Record<string, string>> {
  const entries = ensureArray(
    value as Record<string, string> | Array<Record<string, string>>,
  ).filter((item) => item && typeof item === 'object') as Array<Record<string, string>>;

  if (entries.length > 0) {
    return cloneJson(entries);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return [{ '@xml:lang': 'en', '#text': value.trim() }];
  }

  return [];
}

function preferredText(value: unknown): string {
  const entries = langEntries(value);
  const preferredOrder = ['zh', 'zh-cn', 'zh-hans', 'en'];
  for (const lang of preferredOrder) {
    const match = entries.find((item) => (item['@xml:lang'] || '').toLowerCase() === lang);
    if (match?.['#text']) {
      return match['#text'];
    }
  }
  return entries[0]?.['#text'] ?? '';
}

function buildSyntheticName(shortDescription: unknown): JsonRecord {
  return {
    baseName: langEntries(shortDescription),
    treatmentStandardsRoutes: [],
    mixAndLocationTypes: [],
    functionalUnitFlowProperties: [],
  };
}

function buildNameSummary(name: unknown): Array<Record<string, string>> {
  const nameRecord = asRecord(name);
  const partMap = new Map<string, string[]>();
  const keys = [
    'baseName',
    'treatmentStandardsRoutes',
    'mixAndLocationTypes',
    'functionalUnitFlowProperties',
  ];

  for (const key of keys) {
    for (const item of langEntries(nameRecord[key])) {
      const lang = (item['@xml:lang'] || 'en').toLowerCase();
      const text = item['#text'] || '';
      if (!text) {
        continue;
      }
      if (!partMap.has(lang)) {
        partMap.set(lang, []);
      }
      partMap.get(lang)!.push(text);
    }
  }

  return Array.from(partMap.entries())
    .map(([lang, parts]) => ({
      '@xml:lang': lang,
      '#text': parts.filter(Boolean).join('; '),
    }))
    .filter((item) => item['#text'].length > 0);
}

function extractInternalId(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  const candidate = asRecord(value)['@id'];
  return typeof candidate === 'string' ? candidate : '';
}

function processInstancesFromModel(jsonOrdered: JsonRecord): Array<JsonRecord> {
  const dataSet = getModelDataSet(jsonOrdered);
  return ensureArray(
    asRecord(asRecord(asRecord(asRecord(dataSet.lifeCycleModelInformation).technology).processes))
      .processInstance as JsonRecord | JsonRecord[] | undefined,
  ).map((item) => asRecord(item));
}

function referenceProcessInternalIdFromModel(jsonOrdered: JsonRecord): string {
  const dataSet = getModelDataSet(jsonOrdered);
  const quantitativeReference = asRecord(
    asRecord(dataSet.lifeCycleModelInformation).quantitativeReference,
  );
  return extractInternalId(quantitativeReference.referenceToReferenceProcess);
}

function modelEdgesFromConnections(processInstances: Array<JsonRecord>): ModelEdge[] {
  const seen = new Set<string>();
  const edges: ModelEdge[] = [];

  for (const instance of processInstances) {
    const srcInternalId = String(instance['@dataSetInternalID'] ?? '').trim();
    if (!srcInternalId) {
      continue;
    }

    const outputExchanges = ensureArray(
      asRecord(instance.connections).outputExchange as JsonRecord | JsonRecord[] | undefined,
    );
    for (const outputExchange of outputExchanges.map((item) => asRecord(item))) {
      const flowUuid = String(outputExchange['@flowUUID'] ?? '').trim();
      if (!flowUuid) {
        continue;
      }

      const downstreamProcesses = ensureArray(
        asRecord(outputExchange).downstreamProcess as JsonRecord | JsonRecord[] | undefined,
      ).map((item) => asRecord(item));

      for (const downstreamProcess of downstreamProcesses) {
        const dstInternalId = String(downstreamProcess['@id'] ?? '').trim();
        if (!dstInternalId) {
          continue;
        }

        const key = `${srcInternalId}|${dstInternalId}|${flowUuid}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        edges.push({ srcInternalId, dstInternalId, flowUuid });
      }
    }
  }

  return edges;
}

async function createSupabaseClient(
  bearerKey?: string | SupabaseSessionLike,
): Promise<{ supabase: SupabaseClient }> {
  const { session: normalizedSession, accessToken: bearerToken } =
    resolveSupabaseAccessToken(bearerKey);

  const supabase = createClient(supabase_base_url, supabase_publishable_key, {
    auth: {
      persistSession: false,
      autoRefreshToken: Boolean(normalizedSession?.refresh_token),
    },
    ...(bearerToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${bearerToken}`,
            },
          },
        }
      : {}),
  });

  if (normalizedSession?.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: normalizedSession.access_token,
      refresh_token: normalizedSession.refresh_token,
    });

    if (error) {
      console.warn('Failed to set Supabase session for lifecycle model file tools:', error.message);
    }
  }

  return { supabase };
}

async function fetchProcessLookups(
  supabase: SupabaseClient,
  processInstances: Array<JsonRecord>,
): Promise<Map<string, ProcessLookup>> {
  const lookups = new Map<string, ProcessLookup>();

  const fetches = processInstances.map(async (instance) => {
    const referenceToProcess = asRecord(instance.referenceToProcess);
    const processId = String(referenceToProcess['@refObjectId'] ?? '').trim();
    const version = String(referenceToProcess['@version'] ?? '').trim();
    const internalId = String(instance['@dataSetInternalID'] ?? '').trim();
    const fallbackShortDescription = langEntries(referenceToProcess['common:shortDescription']);
    const fallbackLabel = buildSyntheticName(fallbackShortDescription);

    if (!processId || !internalId) {
      lookups.set(internalId, {
        processId,
        version,
        shortDescription: buildNameSummary(fallbackLabel),
        label: fallbackLabel,
        shortSummary: buildNameSummary(fallbackLabel),
        exchangeByDirectionAndFlow: new Map<string, JsonRecord>(),
      });
      return;
    }

    let processDataSet: JsonRecord | undefined;
    if (version) {
      const { data, error } = await supabase
        .from('processes')
        .select('json_ordered')
        .eq('id', processId)
        .eq('version', version)
        .limit(1);
      if (error) {
        throw new Error(
          `Failed to load referenced process ${processId} version ${version}: ${error.message}`,
        );
      }
      const firstRow = data?.[0] as Record<string, any> | undefined;
      processDataSet = asRecord(asRecord(firstRow?.json_ordered).processDataSet);
    } else {
      const { data, error } = await supabase
        .from('processes')
        .select('json_ordered')
        .eq('id', processId)
        .limit(1);
      if (error) {
        throw new Error(`Failed to load referenced process ${processId}: ${error.message}`);
      }
      const firstRow = data?.[0] as Record<string, any> | undefined;
      processDataSet = asRecord(asRecord(firstRow?.json_ordered).processDataSet);
    }

    const info = asRecord(asRecord(asRecord(processDataSet).processInformation).dataSetInformation);
    const label =
      Object.keys(asRecord(info.name)).length > 0 ? cloneJson(asRecord(info.name)) : fallbackLabel;
    const shortSummary = buildNameSummary(label);
    const exchangeByDirectionAndFlow = new Map<string, JsonRecord>();
    let referenceExchange: JsonRecord | undefined;

    const refExchangeInternalId = String(
      asRecord(asRecord(asRecord(processDataSet).processInformation).quantitativeReference)
        .referenceToReferenceFlow ?? '',
    ).trim();

    for (const exchange of ensureArray(
      asRecord(processDataSet).exchanges?.exchange as JsonRecord | JsonRecord[] | undefined,
    ).map((item) => asRecord(item))) {
      const flowRef = asRecord(exchange.referenceToFlowDataSet);
      const flowId = String(flowRef['@refObjectId'] ?? '').trim();
      const direction = String(exchange.exchangeDirection ?? '').trim();
      if (flowId && direction) {
        exchangeByDirectionAndFlow.set(`${direction}:${flowId}`, exchange);
      }
      if (
        (!referenceExchange && exchange.quantitativeReference === true) ||
        (refExchangeInternalId &&
          String(exchange['@dataSetInternalID'] ?? '').trim() === refExchangeInternalId)
      ) {
        referenceExchange = exchange;
      }
    }

    lookups.set(internalId, {
      processId,
      version,
      shortDescription:
        shortSummary.length > 0
          ? shortSummary
          : langEntries(referenceToProcess['common:shortDescription']),
      label,
      shortSummary:
        shortSummary.length > 0
          ? shortSummary
          : langEntries(referenceToProcess['common:shortDescription']),
      referenceExchange,
      exchangeByDirectionAndFlow,
    });
  });

  await Promise.all(fetches);
  return lookups;
}

function flowPortFallback(flowUuid: string): Array<Record<string, string>> {
  return [{ '@xml:lang': 'en', '#text': flowUuid }];
}

function exchangeAmount(exchange?: JsonRecord): string {
  if (!exchange) {
    return '';
  }
  const candidate = exchange.meanAmount ?? exchange.resultingAmount ?? exchange.meanValue;
  return candidate === undefined || candidate === null ? '' : String(candidate);
}

function topologicalLayout(
  processInstances: Array<JsonRecord>,
  edges: ModelEdge[],
): Map<string, { x: number; y: number }> {
  const orderedIds = processInstances
    .map((instance) => String(instance['@dataSetInternalID'] ?? '').trim())
    .filter(Boolean);
  const orderIndex = new Map(orderedIds.map((id, index) => [id, index]));
  const outgoing = new Map<string, string[]>();
  const incomingDegree = new Map<string, number>();

  for (const id of orderedIds) {
    outgoing.set(id, []);
    incomingDegree.set(id, 0);
  }

  for (const edge of edges) {
    if (!outgoing.has(edge.srcInternalId) || !incomingDegree.has(edge.dstInternalId)) {
      continue;
    }
    outgoing.get(edge.srcInternalId)!.push(edge.dstInternalId);
    incomingDegree.set(edge.dstInternalId, (incomingDegree.get(edge.dstInternalId) ?? 0) + 1);
  }

  const remainingIncomingCount = new Map(incomingDegree);

  const queue = orderedIds
    .filter((id) => (remainingIncomingCount.get(id) ?? 0) === 0)
    .sort((left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0));
  const topoOrder: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    topoOrder.push(current);
    for (const next of outgoing.get(current) ?? []) {
      const nextCount = (remainingIncomingCount.get(next) ?? 0) - 1;
      remainingIncomingCount.set(next, nextCount);
      if (nextCount === 0) {
        queue.push(next);
        queue.sort((left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0));
      }
    }
  }

  for (const id of orderedIds) {
    if (!topoOrder.includes(id)) {
      topoOrder.push(id);
    }
  }

  const levels = new Map<string, number>();
  for (const id of topoOrder) {
    let level = 0;
    for (const edge of edges) {
      if (edge.dstInternalId === id) {
        level = Math.max(level, (levels.get(edge.srcInternalId) ?? 0) + 1);
      }
    }
    levels.set(id, level);
  }

  const byLevel = new Map<number, string[]>();
  for (const id of topoOrder) {
    const level = levels.get(id) ?? 0;
    if (!byLevel.has(level)) {
      byLevel.set(level, []);
    }
    byLevel.get(level)!.push(id);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, ids] of Array.from(byLevel.entries()).sort(
    (left, right) => left[0] - right[0],
  )) {
    ids.sort((left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0));
    ids.forEach((id, index) => {
      positions.set(id, {
        x: NODE_BASE_X + level * NODE_STEP_X,
        y: NODE_Y + index * NODE_STEP_Y,
      });
    });
  }

  const isLinearChain =
    topoOrder.length > 5 &&
    edges.length === topoOrder.length - 1 &&
    topoOrder.every(
      (id) => (incomingDegree.get(id) ?? 0) <= 1 && (outgoing.get(id)?.length ?? 0) <= 1,
    ) &&
    topoOrder.filter((id) => (incomingDegree.get(id) ?? 0) === 0).length === 1 &&
    topoOrder.filter((id) => (outgoing.get(id)?.length ?? 0) === 0).length === 1;

  if (isLinearChain) {
    topoOrder.slice(5).forEach((id, index) => {
      positions.set(id, {
        x: NODE_BASE_X + (3 + index) * NODE_STEP_X,
        y: CHAIN_SECOND_ROW_Y,
      });
    });
  }

  return positions;
}

function buildPortItem(spec: PortSpec, y: number): JsonRecord {
  return {
    id: `${spec.side}:${spec.flowUuid}`,
    group: spec.side === 'INPUT' ? 'groupInput' : 'groupOutput',
    args: {
      x: spec.side === 'INPUT' ? 0 : '100%',
      y,
    },
    attrs: {
      text: {
        text: spec.displayText,
        title: spec.displayText,
        cursor: 'pointer',
        fill: spec.quantitativeReference ? PRIMARY_COLOR : MUTED_TEXT_COLOR,
        'font-weight': spec.quantitativeReference ? 'bold' : 'normal',
      },
    },
    data: {
      textLang: spec.textLang,
      flowId: spec.flowUuid,
      flowVersion: spec.flowVersion,
      quantitativeReference: spec.quantitativeReference,
      allocations: spec.allocations,
    },
    tools: [{ id: 'portTool' }],
  };
}

function buildPortSpec(
  side: 'INPUT' | 'OUTPUT',
  flowUuid: string,
  exchange?: JsonRecord,
  overrideQuantitativeReference = false,
): PortSpec {
  const flowRef = asRecord(exchange?.referenceToFlowDataSet);
  const textLang = langEntries(flowRef['common:shortDescription']).length
    ? langEntries(flowRef['common:shortDescription'])
    : flowPortFallback(flowUuid);
  return {
    side,
    flowUuid,
    flowVersion: String(flowRef['@version'] ?? '').trim(),
    textLang,
    displayText: preferredText(textLang) || flowUuid,
    quantitativeReference:
      overrideQuantitativeReference || exchange?.quantitativeReference === true,
    allocations: exchange?.allocations as JsonValue | undefined,
  };
}

function mergeJsonTg(
  generated: JsonRecord,
  provided: JsonRecord | undefined,
  preferProvidedJsonTg: boolean,
): { jsonTg: JsonRecord; source: 'generated' | 'provided' | 'merged' } {
  if (!provided || !preferProvidedJsonTg) {
    return { jsonTg: generated, source: 'generated' };
  }

  const providedXflow = asRecord(provided.xflow);
  const providedSubmodels = ensureArray(
    provided.submodels as JsonRecord | JsonRecord[] | undefined,
  );

  const jsonTg: JsonRecord = {
    ...cloneJson(generated),
    ...cloneJson(provided),
    xflow:
      Object.keys(providedXflow).length > 0
        ? cloneJson(providedXflow)
        : cloneJson(asRecord(generated.xflow)),
    submodels:
      providedSubmodels.length > 0
        ? cloneJson(providedSubmodels)
        : cloneJson(ensureArray(generated.submodels as JsonRecord | JsonRecord[] | undefined)),
  };

  return { jsonTg, source: 'merged' };
}

function generateJsonTg(
  jsonOrdered: JsonRecord,
  processLookups: Map<string, ProcessLookup>,
): JsonRecord {
  const processInstances = processInstancesFromModel(jsonOrdered);
  const referenceProcessInternalId = referenceProcessInternalIdFromModel(jsonOrdered);
  const fallbackReferenceProcessInstance = processInstances[processInstances.length - 1];
  const resolvedReferenceProcessInternalId =
    referenceProcessInternalId ||
    String(fallbackReferenceProcessInstance?.['@dataSetInternalID'] ?? '').trim();
  const edges = modelEdgesFromConnections(processInstances);
  const positions = topologicalLayout(processInstances, edges);

  const outgoingEdges = new Map<string, ModelEdge[]>();
  const incomingEdges = new Map<string, ModelEdge[]>();
  for (const edge of edges) {
    if (!outgoingEdges.has(edge.srcInternalId)) {
      outgoingEdges.set(edge.srcInternalId, []);
    }
    outgoingEdges.get(edge.srcInternalId)!.push(edge);
    if (!incomingEdges.has(edge.dstInternalId)) {
      incomingEdges.set(edge.dstInternalId, []);
    }
    incomingEdges.get(edge.dstInternalId)!.push(edge);
  }

  const nodes = processInstances.map((instance) => {
    const internalId = String(instance['@dataSetInternalID'] ?? '').trim();
    const multiplicationFactor = String(instance['@multiplicationFactor'] ?? '1');
    const referenceToProcess = asRecord(instance.referenceToProcess);
    const lookup = processLookups.get(internalId);
    const label =
      lookup?.label ?? buildSyntheticName(referenceToProcess['common:shortDescription']);
    const shortSummary = lookup?.shortSummary.length
      ? lookup.shortSummary
      : buildNameSummary(label);
    const processId = lookup?.processId || String(referenceToProcess['@refObjectId'] ?? '').trim();
    const processVersion = lookup?.version || String(referenceToProcess['@version'] ?? '').trim();

    const portMap = new Map<string, PortSpec>();
    const registerPort = (spec: PortSpec) => {
      const key = `${spec.side}:${spec.flowUuid}`;
      if (!portMap.has(key)) {
        portMap.set(key, spec);
      }
    };

    if (lookup?.referenceExchange) {
      const direction = String(lookup.referenceExchange.exchangeDirection ?? '').toUpperCase();
      const flowId = String(
        asRecord(lookup.referenceExchange.referenceToFlowDataSet)['@refObjectId'] ?? '',
      ).trim();
      if (flowId && (direction === 'INPUT' || direction === 'OUTPUT')) {
        registerPort(
          buildPortSpec(
            direction as 'INPUT' | 'OUTPUT',
            flowId,
            lookup.referenceExchange,
            internalId === resolvedReferenceProcessInternalId,
          ),
        );
      }
    }

    for (const edge of incomingEdges.get(internalId) ?? []) {
      registerPort(
        buildPortSpec(
          'INPUT',
          edge.flowUuid,
          lookup?.exchangeByDirectionAndFlow.get(`Input:${edge.flowUuid}`),
        ),
      );
    }

    for (const edge of outgoingEdges.get(internalId) ?? []) {
      registerPort(
        buildPortSpec(
          'OUTPUT',
          edge.flowUuid,
          lookup?.exchangeByDirectionAndFlow.get(`Output:${edge.flowUuid}`),
        ),
      );
    }

    const inputPorts = Array.from(portMap.values()).filter((item) => item.side === 'INPUT');
    const outputPorts = Array.from(portMap.values()).filter((item) => item.side === 'OUTPUT');
    const position = positions.get(internalId) ?? { x: NODE_BASE_X, y: NODE_Y };
    const hasInputs = inputPorts.length > 0;
    const hasOutputs = outputPorts.length > 0;
    const bothSides = hasInputs && hasOutputs;
    const pairCount = Math.max(inputPorts.length, outputPorts.length);
    const portY = (side: 'INPUT' | 'OUTPUT', index: number) => {
      if (bothSides) {
        return side === 'INPUT'
          ? PAIRED_INPUT_START_Y + index * PAIRED_PORT_STEP_Y
          : PAIRED_OUTPUT_START_Y + index * PAIRED_PORT_STEP_Y;
      }
      return PORT_START_Y + index * PORT_STEP_Y;
    };
    const height = bothSides
      ? Math.max(NODE_MIN_HEIGHT + 10, 110 + Math.max(pairCount - 1, 0) * PAIRED_PORT_STEP_Y)
      : Math.max(inputPorts.length, outputPorts.length, 2) * PORT_STEP_Y + 60;

    return {
      id: internalId,
      shape: 'rect',
      position,
      size: {
        width: NODE_WIDTH,
        height: Math.max(NODE_MIN_HEIGHT, height),
      },
      attrs: {
        body: {
          stroke: PRIMARY_COLOR,
          strokeWidth: 1,
          fill: BACKGROUND_COLOR,
          rx: 6,
          ry: 6,
        },
        label: {
          fill: BODY_TEXT_COLOR,
          refX: 0.5,
          refY: 8,
          textAnchor: 'middle',
          textVerticalAnchor: 'top',
        },
        text: {
          text: preferredText(shortSummary),
        },
      },
      isMyProcess: true,
      data: {
        id: processId,
        version: processVersion,
        index: internalId,
        label,
        shortDescription: shortSummary,
        quantitativeReference: internalId === resolvedReferenceProcessInternalId ? '1' : '0',
        targetAmount: internalId === resolvedReferenceProcessInternalId ? '1' : '',
        multiplicationFactor,
      },
      ports: {
        groups: {
          groupInput: {
            position: { name: 'absolute' },
            label: { position: { name: 'right' } },
            attrs: {
              circle: {
                stroke: PRIMARY_COLOR,
                fill: BACKGROUND_COLOR,
                strokeWidth: 1,
                r: 4,
                magnet: true,
              },
              text: { fill: MUTED_TEXT_COLOR, fontSize: 14 },
            },
          },
          groupOutput: {
            position: { name: 'absolute' },
            label: { position: { name: 'left' } },
            attrs: {
              circle: {
                stroke: PRIMARY_COLOR,
                fill: BACKGROUND_COLOR,
                strokeWidth: 1,
                r: 4,
                magnet: true,
              },
              text: { fill: MUTED_TEXT_COLOR, fontSize: 14 },
            },
          },
        },
        items: [
          ...inputPorts.map((item, index) => buildPortItem(item, portY('INPUT', index))),
          ...outputPorts.map((item, index) => buildPortItem(item, portY('OUTPUT', index))),
        ],
      },
      tools: { name: null, items: [] },
      visible: true,
      zIndex: 1,
    };
  });

  const instanceMap = new Map(
    processInstances.map((instance) => [
      String(instance['@dataSetInternalID'] ?? '').trim(),
      asRecord(instance),
    ]),
  );

  const xflowEdges = edges.map((edge) => {
    const sourceLookup = processLookups.get(edge.srcInternalId);
    const targetLookup = processLookups.get(edge.dstInternalId);
    const targetExchange = targetLookup?.exchangeByDirectionAndFlow.get(`Input:${edge.flowUuid}`);
    return {
      id: crypto.randomUUID(),
      shape: 'edge',
      source: { cell: edge.srcInternalId, port: `OUTPUT:${edge.flowUuid}` },
      target: { cell: edge.dstInternalId, port: `INPUT:${edge.flowUuid}` },
      labels: [],
      attrs: {
        line: {
          stroke: PRIMARY_COLOR,
        },
      },
      data: {
        connection: {
          outputExchange: {
            '@flowUUID': edge.flowUuid,
            downstreamProcess: {
              '@id': edge.dstInternalId,
              '@flowUUID': edge.flowUuid,
            },
          },
          isBalanced: true,
          unbalancedAmount: 0,
          exchangeAmount: exchangeAmount(targetExchange),
        },
        node: {
          sourceNodeID: edge.srcInternalId,
          sourceProcessId:
            processLookups.get(edge.srcInternalId)?.processId ??
            String(
              asRecord(instanceMap.get(edge.srcInternalId)?.referenceToProcess)['@refObjectId'] ??
                '',
            ),
          sourceProcessVersion:
            processLookups.get(edge.srcInternalId)?.version ??
            String(
              asRecord(instanceMap.get(edge.srcInternalId)?.referenceToProcess)['@version'] ?? '',
            ),
          targetNodeID: edge.dstInternalId,
          targetProcessId:
            processLookups.get(edge.dstInternalId)?.processId ??
            String(
              asRecord(instanceMap.get(edge.dstInternalId)?.referenceToProcess)['@refObjectId'] ??
                '',
            ),
          targetProcessVersion:
            processLookups.get(edge.dstInternalId)?.version ??
            String(
              asRecord(instanceMap.get(edge.dstInternalId)?.referenceToProcess)['@version'] ?? '',
            ),
        },
      },
      zIndex: 4,
    };
  });

  const modelDataSet = getModelDataSet(jsonOrdered);
  const dataSetInformation = asRecord(
    asRecord(modelDataSet.lifeCycleModelInformation).dataSetInformation,
  );
  const referenceToResultingProcess = asRecord(dataSetInformation.referenceToResultingProcess);
  const referenceProcessInstance =
    processInstances.find(
      (instance) =>
        String(instance['@dataSetInternalID'] ?? '').trim() === resolvedReferenceProcessInternalId,
    ) ?? fallbackReferenceProcessInstance;
  const referenceProcessRef = asRecord(referenceProcessInstance?.referenceToProcess);
  const referenceProcessLookup = processLookups.get(resolvedReferenceProcessInternalId);
  const referenceExchange = referenceProcessLookup?.referenceExchange;
  const fallbackEdge = (outgoingEdges.get(resolvedReferenceProcessInternalId) ?? [])[0];
  const finalId: JsonRecord = {
    nodeId: resolvedReferenceProcessInternalId,
    processId: String(referenceProcessRef['@refObjectId'] ?? ''),
  };

  if (referenceExchange) {
    finalId.referenceToFlowDataSet = {
      '@refObjectId': String(
        asRecord(referenceExchange.referenceToFlowDataSet)['@refObjectId'] ?? '',
      ),
      '@exchangeDirection': String(referenceExchange.exchangeDirection ?? ''),
    };
  } else if (fallbackEdge) {
    finalId.referenceToFlowDataSet = {
      '@refObjectId': fallbackEdge.flowUuid,
      '@exchangeDirection': 'Output',
    };
  }

  const submodels = [
    {
      id: String(referenceToResultingProcess['@refObjectId'] ?? getModelUuid(jsonOrdered)),
      type: 'primary',
      finalId,
    },
  ];

  return {
    xflow: {
      nodes,
      edges: xflowEdges,
    },
    submodels,
  };
}

function deriveRuleVerification(jsonOrdered: JsonRecord): {
  ruleVerification: boolean;
  issueCount: number;
  filteredIssues: unknown[];
} {
  const validator = createLifeCycleModel(jsonOrdered, { mode: 'strict' });
  const enhanced = validator.validateEnhanced();
  if (enhanced.success) {
    return { ruleVerification: true, issueCount: 0, filteredIssues: [] };
  }

  const issues = ensureArray(asRecord(enhanced.error).issues as unknown[] | undefined);
  const filteredIssues = issues.filter((issue) => {
    const path = ensureArray(asRecord(issue).path as string[] | undefined).map((part) =>
      String(part),
    );
    return !path.includes('validation') && !path.includes('compliance');
  });

  return {
    ruleVerification: filteredIssues.length === 0,
    issueCount: filteredIssues.length,
    filteredIssues,
  };
}

export type PreparedLifecycleModelFile = {
  sourceFormat: LifecycleModelPayload['sourceFormat'];
  lifecycleModelId: string;
  lifecycleModelVersion: string;
  jsonTgSource: 'generated' | 'provided' | 'merged';
  processCount: number;
  nodeCount: number;
  edgeCount: number;
  submodelCount: number;
  ruleVerification: boolean;
  validationIssueCount: number;
  validationIssues: unknown[];
  jsonOrdered: JsonRecord;
  jsonTg: JsonRecord;
};

type PrepareLifecycleModelFileInput = {
  payload: unknown;
  id?: string;
  version?: string;
  preferProvidedJsonTg?: boolean;
};

export async function prepareLifecycleModelFile(
  input: PrepareLifecycleModelFileInput,
  bearerKey?: string | SupabaseSessionLike,
): Promise<PreparedLifecycleModelFile> {
  const preferProvidedJsonTg = input.preferProvidedJsonTg ?? true;
  const normalized = normalizeLifecycleModelPayload(input.payload);
  const jsonOrdered = normalized.jsonOrdered;
  const modelId = input.id ?? getModelUuid(jsonOrdered);
  const modelVersion = input.version ?? getModelVersion(jsonOrdered);
  validateLifecycleModelStrict(jsonOrdered);
  const { supabase } = await createSupabaseClient(bearerKey);
  const processLookups = await fetchProcessLookups(
    supabase,
    processInstancesFromModel(jsonOrdered),
  );
  const generatedJsonTg = generateJsonTg(jsonOrdered, processLookups);
  const merged = mergeJsonTg(generatedJsonTg, normalized.providedJsonTg, preferProvidedJsonTg);
  const validation = deriveRuleVerification(jsonOrdered);

  return {
    sourceFormat: normalized.sourceFormat,
    lifecycleModelId: modelId,
    lifecycleModelVersion: modelVersion,
    jsonTgSource: merged.source,
    processCount: ensureArray(
      asRecord(
        asRecord(asRecord(getModelDataSet(jsonOrdered).lifeCycleModelInformation).technology)
          .processes,
      ).processInstance as JsonRecord | JsonRecord[] | undefined,
    ).length,
    nodeCount: ensureArray(asRecord(merged.jsonTg.xflow).nodes as JsonValue[] | undefined).length,
    edgeCount: ensureArray(asRecord(merged.jsonTg.xflow).edges as JsonValue[] | undefined).length,
    submodelCount: ensureArray(merged.jsonTg.submodels as JsonValue[] | undefined).length,
    ruleVerification: validation.ruleVerification,
    validationIssueCount: validation.issueCount,
    validationIssues: validation.filteredIssues,
    jsonOrdered,
    jsonTg: merged.jsonTg,
  };
}
